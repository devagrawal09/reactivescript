// The slice-6 oracle harness (docs/RESULTS.md, "Slice 6: inferred server components"). One leg run is: a leg server
// (Solid's server in its own process, frames/leg-server.ts, or rust-solid's `frames-server`), a harness HTTP server in
// front of it, and Chromium.
//
// The harness server serves the page's static modules itself (Solid's client dist files through an import map, no
// bundler, as slice 5 does; the program's client modules; `/favicon.ico`, answered 204 so no 404 reaches the console)
// and is a **holding proxy** for the leg server: the document is passed through at mount; every `/_server/...` request
// is forwarded to the leg server at once, in the page's issue order (the page prelude numbers each fetch with an
// `x-frames-seq` header, which the proxy removes before forwarding), and its response is held until a `deliver` step
// releases it. A held request is named by its **site** (the question memo or the action await that issued it, from the
// leg's wire-id map) and its call number per site, counting the calls the document render made (one-based).
//
// After each step the harness waits until nothing is in transit to the leg server and the page is quiet (the frame,
// the frames seen and the request count unchanged over five 20 ms page turns). Each run writes, per step:
//   (a) the frame: `#app`'s text, script and template contents excluded (slice 5's definition), and every distinct
//       frame a MutationObserver saw during the step;
//   (b) the client request log: site, call, wire id, args, outcome (`ok` or `error`: the response's
//       X-Server-Function-Error), in issue order;
//   (c) the server host log: step, host, args, value or error, each call attributed to the step during which the leg
//       server made it (the document render's calls to the mount step);
//   (d) `#app`'s serialization.
// and, for the whole run, the leg server's wire records (frames/leg-server.ts), the JS modules Chromium fetched with
// their text (G4), and every console error or warning, page error and hydration problem (each fails the run).
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileModule, type Compiled } from './compile.ts';
// @ts-ignore: a plain .mjs helper shared with the leg servers
import { hostModule } from './host-table.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PACKAGES = fileURLToPath(new URL('../../solid-next/packages/', import.meta.url));
const PNPM = fileURLToPath(new URL('../../solid-next/node_modules/.pnpm/', import.meta.url));
const OUT = fileURLToPath(new URL('../.out/frames/build/', import.meta.url));

export type HostSpec = { table: Record<string, unknown>[]; hosts: ({ name: string; kind: string } & Record<string, unknown>)[] };
/** A frames program: its modules (paths under `src/`, TSX source), the module whose default export is the app, and
 *  its server host table (the `./db` module's implementation). */
export type FramesProgram = { modules: Record<string, string>; entry: string; hosts: HostSpec };
export type Built = {
  dir: string; serverEntry: string;
  /** Client module path (`/src/<file>.js`) -> code. */
  client: Map<string, string>;
  server: Map<string, Compiled>;
  clientCompiled: Map<string, Compiled>;
  /** Every `"use server"` function: wire id -> { name, file }. */
  functions: Map<string, { name: string; file: string }>;
};

const js = (file: string) => file.replace(/\.tsx$/, '');
/** Compiles a program for both sides and writes the server half under .out/frames/build/<hash>/. */
export function buildProgram(p: FramesProgram): Built {
  const key = createHash('sha256').update(JSON.stringify(p)).digest('hex').slice(0, 16);
  const dir = join(OUT, key);
  mkdirSync(dir, { recursive: true });
  const client = new Map<string, string>(), server = new Map<string, Compiled>(), clientCompiled = new Map<string, Compiled>();
  const functions = new Map<string, { name: string; file: string }>();
  for (const [file, source] of Object.entries(p.modules)) {
    const s = compileModule(source, file, 'server');
    server.set(file, s);
    writeFileSync(join(dir, js(file) + '.mjs'), s.code);
    for (const f of s.functions) functions.set(f.id, { name: f.name, file });
    const c = compileModule(source, file, 'client');
    clientCompiled.set(file, c);
    client.set('/src/' + js(file) + '.js', c.code);
  }
  writeFileSync(join(dir, 'db.mjs'), hostModule(p.hosts, join(HERE, 'host-table.mjs')));
  return { dir, serverEntry: js(p.entry) + '.mjs', client, server, clientCompiled, functions };
}

export type WireRecord = { method: string; path: string; body: string; status: number; headers: [string, string][]; chunks: string[] };
export type HostEntry = { host: string; args: unknown[]; value?: unknown; error?: string };
export type IncomingRecord = { method: string; target: string; headers: [string, string][]; body: string };
/** `incoming`: the Node leg's requests behind its wire records, one for one (rust's log has none). */
export type LegLog = { hosts: HostEntry[]; document: { id: string; args: unknown[] }[]; wire: WireRecord[]; incoming?: IncomingRecord[] };
export type LegServer = { port: number; log(): Promise<LegLog>; close(): Promise<void>; stderr(): string };

async function spawnServer(cmd: string, args: string[], cwd: string): Promise<LegServer> {
  const child: ChildProcess = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr!.on('data', d => { err += d; });
  const port = await new Promise<number>((ok, fail) => {
    let out = '';
    const onData = (d: Buffer) => {
      out += d;
      const line = out.split('\n')[0];
      if (out.includes('\n')) { child.stdout!.off('data', onData); try { ok(JSON.parse(line).port); } catch { fail(new Error('leg server: ' + line + err)); } }
    };
    child.stdout!.on('data', onData);
    child.on('exit', code => fail(new Error('leg server exited ' + code + ': ' + err)));
  });
  return {
    port,
    stderr: () => err,
    async log() { return JSON.parse(await (await fetch('http://127.0.0.1:' + port + '/__log')).text()); },
    async close() { child.kill(); await new Promise(r => child.once('exit', r)); },
  };
}
/** Solid's server for a built program (frames/leg-server.ts, production server builds). */
export function startNodeLeg(b: Built): Promise<LegServer> {
  return spawnServer(process.execPath, ['--experimental-strip-types', '--no-warnings', join(HERE, 'leg-server.ts'), b.dir, b.serverEntry], join(HERE, '..'));
}
/** rust-solid's frames server for a plan v2.2 (`frames-server PLAN ANSWERS`). */
export function startRustLeg(binary: string, plan: string, answers: string): Promise<LegServer> {
  return spawnServer(binary, [plan, answers], join(HERE, '..'));
}

export type Build = 'prod' | 'dev';
const PNPM_SEROVAL = 'seroval@1.7.0/node_modules/seroval/dist/';
const PNPM_PLUGINS = 'seroval-plugins@1.7.0_seroval@1.7.0/node_modules/seroval-plugins/dist/';
const IMPORTS: Record<Build, Record<string, string>> = {
  prod: {
    'solid-js': '/pkg/solid/dist/solid.js',
    'solid-js/internal': '/pkg/solid/dist/internal.js',
    'solid-js/internal/container-trace': '/pkg/solid/dist/container-trace.js',
    '@solidjs/signals': '/pkg/signals/dist/prod/index.js',
    '@solidjs/web': '/pkg/web/dist/web.js',
    '@solidjs/web/frames': '/pkg/web/frames/dist/client.js',
    '@solidjs/web/frames/wire': '/pkg/web/frames/dist/wire.js',
    '@solidjs/web/frames/regions': '/pkg/web/frames/dist/regions.js',
    '@solidjs/web/frames/assets': '/pkg/web/frames/dist/assets.js',
    '@solidjs/web/frames/trace': '/pkg/web/frames/dist/trace.js',
    '@solidjs/web/server-functions': '/pkg/web/server-functions/dist/client.js',
    '@solidjs/web/server-functions/client': '/pkg/web/server-functions/dist/client.js',
    '@solidjs/web/server-functions/rich-args': '/pkg/web/server-functions/dist/rich-args.js',
    '@solidjs/web/serialization': '/pkg/web/serialization/dist/serialization.js',
    '@solidjs/web/serialization/decode': '/pkg/web/serialization/dist/decode.js',
    'seroval': '/pnpm/' + PNPM_SEROVAL + 'index.js',
    'seroval-plugins/web': '/pnpm/' + PNPM_PLUGINS + 'web.js',
  },
  dev: {} as Record<string, string>,
};
IMPORTS.dev = {
  ...IMPORTS.prod,
  'solid-js': '/pkg/solid/dist/solid.dev.js',
  'solid-js/attribution': '/pkg/solid/dist/attribution.js',
  '@solidjs/signals': '/pkg/signals/dist/dev.js',
  '@solidjs/signals/attribution': '/pkg/signals/dist/dev.attribution.js',
  '@solidjs/web': '/pkg/web/dist/web.dev.js',
  '@solidjs/web/frames': '/pkg/web/frames/dist/client.dev.js',
  '@solidjs/web/server-functions': '/pkg/web/server-functions/dist/client.dev.js',
  '@solidjs/web/server-functions/client': '/pkg/web/server-functions/dist/client.dev.js',
  'seroval': '/pnpm/' + PNPM_SEROVAL + 'dev/index.js',
  'seroval-plugins/web': '/pnpm/' + PNPM_PLUGINS + 'dev/web.js',
};

/** The page prelude, first in `<head>`: console capture, the fetch sequence header, the fresh-element marks (slice 5:
 *  every element the client creates through createElement/cloneNode/importNode is marked; parsed ones never are), the
 *  frame, the frames-seen observer, and the clickables. */
const PRELUDE = `window.__framesConsole=[];for(const level of ['error','warn']){const f=console[level];console[level]=function(...a){window.__framesConsole.push(level+': '+a.map(x=>x instanceof Error?x.name+': '+x.message:typeof x==='string'?x:String(x)).join(' '));return f.apply(this,a)}}
(()=>{const f=window.fetch;let n=0;window.fetch=function(input,init){init=Object.assign({},init);const h=new Headers(init.headers||(input instanceof Request?input.headers:undefined));h.set('x-frames-seq',String(++n));init.headers=h;return f.call(this,input,init)}})();
(()=>{const mark=n=>{if(n&&n.nodeType===1){n.__fresh=1;for(const c of n.querySelectorAll('*'))c.__fresh=1}else if(n&&n.nodeType===11)for(const c of n.querySelectorAll('*'))c.__fresh=1;return n};
const ce=Document.prototype.createElement;Document.prototype.createElement=function(...a){return mark(ce.apply(this,a))};
const cn=Node.prototype.cloneNode;Node.prototype.cloneNode=function(...a){return mark(cn.apply(this,a))};
const im=Document.prototype.importNode;Document.prototype.importNode=function(...a){return mark(im.apply(this,a))}})();
window.__framesText=n=>{const w=n=>n.nodeType===3?n.nodeValue:n.nodeType===1&&(n.localName==='script'||n.localName==='template')?'':[...n.childNodes].map(w).join('');return w(n)};
window.__framesFrame=()=>window.__framesText(document.getElementById('app'));
window.__framesWatch=()=>{const app=document.getElementById('app');window.__framesSeen=[window.__framesFrame()];if(!window.__framesObserver){window.__framesObserver=new MutationObserver(()=>{const f=window.__framesFrame();if(f!==window.__framesSeen.at(-1))window.__framesSeen.push(f)});window.__framesObserver.observe(app,{subtree:true,childList:true,characterData:true,attributes:true})}};
window.__framesClickables=()=>{const root=document.getElementById('app');return [...root.querySelectorAll('*')].filter(e=>e._$$click!=null)};
window.__framesTargets=()=>{const root=document.getElementById('app');const t=window.__framesText;const info=window.__framesClickables().map(e=>({text:t(e),parent:e.parentElement&&e.parentElement!==root?t(e.parentElement):undefined}));
return info.map(c=>Object.assign({text:c.text},c.parent===undefined?{}:{parent:c.parent},{index:info.filter(d=>d.text===c.text&&d.parent===c.parent).indexOf(c)}))};
window.__framesClick=t=>{const root=document.getElementById('app');const f=window.__framesText;const el=window.__framesClickables().filter(e=>f(e)===t.text&&(t.parent===undefined||(e.parentElement&&e.parentElement!==root&&f(e.parentElement)===t.parent)))[t.index];if(!el)return 'no clickable '+JSON.stringify(t);el.click();return null};`;

function entryModule(entry: string): string {
  // `onHydrationEnd` (solid-js) fires when hydration is complete page-wide, which for an adopted server component
  // includes its deferred slot occurrences (frames client.ts `deferDone` → `releaseDeferHolds`): they mount in idle
  // slices after first paint, so the scenario starts, and adoption is checked, only after that.
  return 'import { hydrate } from "@solidjs/web";\nimport { createComponent, onHydrationEnd, sharedConfig } from "solid-js";\nimport { installServerComponents } from "@solidjs/web/frames";\n' +
    'import App from "./src/' + js(entry) + '.js";\ninstallServerComponents();\n' +
    'window.__framesCompleted = window._$HY && window._$HY.completed;\n' +
    'hydrate(() => createComponent(App, {}), document.getElementById("app"));\n' +
    'window.__framesUnclaimed = sharedConfig.registry ? sharedConfig.registry.size : -1;\nwindow.__framesHydrated = true;\n' +
    'onHydrationEnd(() => { window.__framesHydrationEnded = true; });\n';
}

export type Target = { text: string; parent?: string; index: number };
export type Step =
  | { type: 'mount'; frame?: string }
  | { type: 'click'; target: Target; frame?: string }
  | { type: 'deliver'; site: string; call: number; frame?: string };
export type RequestRow = { step: number; site: string; call: number; id: string; args: unknown[]; outcome: 'ok' | 'error' | 'held' };
export type HostRow = { step: number; host: string; args: unknown[]; value?: unknown; error?: string };
export type Trace = {
  ok: boolean; problems: string[];
  steps: Step[]; frames: string[]; seen: string[][]; requests: RequestRow[]; hosts: HostRow[]; dom: string[];
  wire: WireRecord[]; modules: { url: string; text: string }[]; console: string[];
};
/** The harness's view of the program: the site of each wire id, and the client build. `chooser`: record a scenario
 *  (frames/fuzz) instead of replaying `steps`. */
export type RunOptions = {
  sites: Record<string, string>; build?: Build;
  steps?: Step[]; chooser?: (live: { targets: Target[]; held: { site: string; call: number }[] }, index: number) => Step | null;
  /** Fail when a replayed step's frame differs from the step's `frame` (default true when replaying). */
  check?: boolean;
};

let chromium: Promise<any> | undefined;
export async function browser() {
  chromium ??= (async () => {
    const { chromium: c } = await import('playwright');
    const executablePath = process.env.CHROMIUM ?? execSync('command -v chromium', { encoding: 'utf8' }).trim();
    return c.launch({ executablePath });
  })();
  return chromium;
}
export async function closeBrowser() { if (chromium) { const b = await chromium; chromium = undefined; await b.close(); } }

type Held = { seq: number; step: number; url: string; releasedAt: number; site: string; call: number; id: string; args: unknown[]; status: number; headers: [string, string][]; body: Buffer; res: ServerResponse; released: boolean; error: boolean };

function decodeArgs(headers: Record<string, string | string[] | undefined>, body: Buffer): unknown[] {
  const format = headers['x-server-function-format'];
  if (format === '1') return [body.toString('utf8')];
  if (format === '8') return JSON.parse(body.toString('utf8'));
  if (format === undefined && body.length === 0) return [];
  throw new Error('request body format ' + JSON.stringify(format) + ' is outside the frames subset (formats 1 and 8)');
}

/** Runs one leg: the page against `leg`, the client build `b`, and the scenario (or the chooser). */
export async function runLeg(leg: LegServer, b: Built, entry: string, opts: RunOptions): Promise<Trace> {
  const build = opts.build ?? 'prod';
  const problems: string[] = [];
  const held: Held[] = [];
  const counts = new Map<string, number>();
  const modules: { url: string; text: string }[] = [];
  let transit = 0, arrived = 0, nextSeq = 1, currentStep = 0;
  // Requests by sequence number, forwarded one at a time in issue order: each is answered in full by the leg server
  // before the next is sent, so the server host log's order is the page's issue order on every leg.
  const queued = new Map<number, () => Promise<void>>();
  let pumping = false;
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (queued.has(nextSeq)) { const run = queued.get(nextSeq)!; queued.delete(nextSeq); nextSeq++; await run(); }
    } finally { pumping = false; }
  };
  const forward = (req: IncomingMessage, res: ServerResponse) => {
    const seq = Number(req.headers['x-frames-seq']);
    const step = currentStep;
    const chunks: Buffer[] = [];
    transit++;
    req.on('data', d => chunks.push(d));
    req.on('end', () => {
      const run = async () => {
        try {
          arrived++;
          const body = Buffer.concat(chunks);
          const headers: Record<string, string | string[]> = {};
          for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() !== 'x-frames-seq') {
            const k = req.rawHeaders[i];
            headers[k] = headers[k] === undefined ? req.rawHeaders[i + 1] : [...[headers[k]].flat(), req.rawHeaders[i + 1]];
          }
          const id = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname.replace(/^\/_server\/(data\/)?/, ''));
          const site = opts.sites[id];
          if (site === undefined) throw new Error('a server request to ' + id + ', which no site of this leg calls');
          const args = decodeArgs(req.headers, body);
          const call = (counts.get(site) ?? 0) + 1;
          counts.set(site, call);
          const answer = await new Promise<{ status: number; headers: [string, string][]; body: Buffer }>((ok, fail) => {
            const out = httpRequest({ host: '127.0.0.1', port: leg.port, method: req.method, path: req.url, headers }, r => {
              const parts: Buffer[] = [];
              r.on('data', d => parts.push(d));
              r.on('end', () => {
                const hs: [string, string][] = [];
                for (let i = 0; i < r.rawHeaders.length; i += 2) hs.push([r.rawHeaders[i], r.rawHeaders[i + 1]]);
                ok({ status: r.statusCode ?? 0, headers: hs, body: Buffer.concat(parts) });
              });
              r.on('error', fail);
            });
            out.on('error', fail);
            out.end(body);
          });
          const error = answer.headers.some(([k]) => k.toLowerCase() === 'x-server-function-error');
          held.push({ seq, step, url: req.url ?? '', releasedAt: 0, site, call, id, args, ...answer, res, released: false, error });
        } catch (e) {
          problems.push('proxy: ' + String((e as Error)?.message ?? e));
          res.writeHead(502); res.end();
        } finally { transit--; }
      };
      if (!Number.isInteger(seq) || seq < nextSeq || queued.has(seq)) {
        problems.push('proxy: a server request without a fresh sequence number: ' + req.url);
        transit--; res.writeHead(400); res.end(); return;
      }
      queued.set(seq, run);
      void pump();
    });
  };
  let releases = 0;
  const release = (h: Held) => {
    h.released = true;
    h.releasedAt = ++releases;
    // Transport headers (framing, connection) are the proxy's own; the leg's handler headers pass through.
    const hs = h.headers.filter(([k]) => !/^(connection|keep-alive|transfer-encoding|content-length)$/i.test(k)).flat();
    h.res.writeHead(h.status, hs);
    h.res.end(h.body);
  };
  let document: string | undefined;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (type: string, body: string | Buffer) => {
      if (type === 'text/javascript') modules.push({ url: url.pathname, text: body.toString() });
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body);
    };
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (url.pathname === '/') {
      httpRequest({ host: '127.0.0.1', port: leg.port, method: 'GET', path: '/', headers: { ...req.headers } }, r => {
        const parts: Buffer[] = [];
        r.on('data', d => parts.push(d));
        r.on('end', () => {
          document = Buffer.concat(parts).toString('utf8');
          if (r.statusCode !== 200 || !document.startsWith('<!doctype html><html><head>')) { problems.push('document: ' + r.statusCode + ' ' + document.slice(0, 300)); res.writeHead(500); res.end(); return; }
          const head = '<script type="importmap">' + JSON.stringify({ imports: IMPORTS[build] }) + '</script><script>' + PRELUDE + '</script><script type="module" src="/entry.js"></script>';
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          res.end('<!doctype html><html><head>' + head + document.slice('<!doctype html><html><head>'.length));
        });
      }).end();
      return;
    }
    if (url.pathname === '/entry.js') { send('text/javascript', entryModule(entry)); return; }
    if (url.pathname.startsWith('/_server/')) { forward(req, res); return; }
    const code = b.client.get(url.pathname);
    if (code !== undefined) { send('text/javascript', code); return; }
    for (const [prefix, root] of [['/pkg/', PACKAGES], ['/pnpm/', PNPM]] as const) {
      if (!url.pathname.startsWith(prefix)) continue;
      const rel = url.pathname.slice(prefix.length);
      if (rel.includes('..')) break;
      try { send('text/javascript', readFileSync(root + rel)); } catch { problems.push('module not found: ' + url.pathname); res.writeHead(404); res.end(); }
      return;
    }
    problems.push('unexpected request ' + req.method + ' ' + url.pathname);
    res.writeHead(404); res.end();
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const b0 = await browser();
  const context = await b0.newContext();
  const page = await context.newPage();
  // FRAMES_CPU_THROTTLE=N slows the page's CPU N times (a load test of the harness's waits; never set by the gate).
  const throttle = Number(process.env.FRAMES_CPU_THROTTLE ?? 0);
  if (throttle > 1) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const messages: string[] = [];
  page.on('pageerror', (e: Error) => messages.push('pageerror: ' + e.message));
  // Chromium logs every 4xx/5xx response of a fetch ("Failed to load resource"). A failed server function is a real
  // 500 by Solid's protocol (server.ts respondThrown), so each such log is accounted for, not dropped: it must name a
  // released response with that status, one log per response, in order (checked at the end).
  const network: { url: string; text: string }[] = [];
  page.on('console', (m: { type(): string; text(): string; location(): { url: string } }) => {
    if (m.type() === 'error' && m.text().startsWith('Failed to load resource:')) network.push({ url: new URL(m.location()?.url ?? '', 'http://x').pathname, text: m.text() });
    else if (m.type() === 'error' || m.type() === 'warning') messages.push(m.type() + ': ' + m.text());
  });
  const steps: Step[] = [], frames: string[] = [], seen: string[][] = [], dom: string[] = [], hosts: HostRow[] = [];
  let hostsSeen = 0;
  const frame = (): Promise<string> => page.evaluate(() => (window as any).__framesFrame());
  const settle = async () => {
    let last = '', stable = 0;
    for (let i = 0; i < 500 && stable < 5; i++) {
      await page.evaluate(() => new Promise(r => setTimeout(r, 20)));
      const now = JSON.stringify([transit, arrived, await page.evaluate(() => (window as any).__framesSeen)]);
      stable = transit === 0 && now === last ? stable + 1 : 0;
      last = now;
    }
    if (stable < 5) problems.push('the page did not settle');
  };
  const record = async (index: number, step: Step) => {
    const f = await frame();
    frames.push(f);
    seen.push(await page.evaluate(() => (window as any).__framesSeen));
    dom.push(await page.evaluate(() => document.getElementById('app')!.innerHTML));
    const log = await leg.log();
    for (const h of log.hosts.slice(hostsSeen)) hosts.push({ step: index, ...h });
    hostsSeen = log.hosts.length;
    steps.push({ ...step, frame: f });
    if (opts.steps && opts.check !== false && step.frame !== undefined && f !== step.frame)
      problems.push('step ' + index + ': frame ' + JSON.stringify(f) + ', expected ' + JSON.stringify(step.frame));
  };
  try {
    // Step 0: mount. The document's server-function calls are the first calls of their sites.
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => (window as any).__framesHydrated === true, null, { timeout: 15000 });
    await page.waitForFunction(() => (window as any).__framesHydrationEnded === true, null, { timeout: 15000 });
    const log0 = await leg.log();
    for (const c of log0.document) {
      const site = opts.sites[c.id];
      if (site === undefined) { problems.push('the document called ' + c.id + ', which no site of this leg calls'); continue; }
      counts.set(site, (counts.get(site) ?? 0) + 1);
    }
    const hydration = await page.evaluate(() => {
      const root = document.getElementById('app')!;
      const done = (window as any).__framesCompleted as WeakSet<Element> | undefined;
      const els = [...root.querySelectorAll('*')].filter(e => e.localName !== 'script' && e.localName !== 'template');
      return {
        unclaimed: (window as any).__framesUnclaimed as number,
        fresh: els.filter(e => (e as any).__fresh).map(e => e.localName),
        unadopted: els.filter(e => e.hasAttribute('_hk') && !done?.has(e)).map(e => e.getAttribute('_hk')!),
      };
    });
    if (hydration.unclaimed !== 0) problems.push('hydration left ' + hydration.unclaimed + ' server key(s) unclaimed');
    if (hydration.fresh.length) problems.push('hydration created ' + hydration.fresh.join(' '));
    if (hydration.unadopted.length) problems.push('keyed server elements not adopted: ' + hydration.unadopted.join(' '));
    await page.evaluate(() => (window as any).__framesWatch());
    await settle();
    await record(0, opts.steps?.[0] ?? { type: 'mount' });
    for (let index = 1; !problems.length; index++) {
      let step: Step | null;
      if (opts.chooser) {
        if (index > 200) { problems.push('the chooser did not stop'); break; }
        const targets = await page.evaluate(() => (window as any).__framesTargets());
        step = opts.chooser({ targets, held: held.filter(h => !h.released).map(h => ({ site: h.site, call: h.call })) }, index);
        if (!step) break;
      } else {
        if (!opts.steps || index >= opts.steps.length) break;
        step = opts.steps[index];
      }
      await page.evaluate(() => (window as any).__framesWatch());
      currentStep = index;
      if (step.type === 'click') {
        const r = await page.evaluate((t: Target) => (window as any).__framesClick(t), step.target);
        if (r) { problems.push('step ' + index + ': ' + r); break; }
      } else if (step.type === 'deliver') {
        const h = held.find(h => h.site === step!.site && h.call === (step as { call: number }).call && !h.released);
        if (!h) { problems.push('step ' + index + ': ' + step.site + '#' + step.call + ' is not a held request'); break; }
        release(h);
      } else { problems.push('step ' + index + ': a second mount'); break; }
      await settle();
      await record(index, step);
    }
    if (!problems.length) {
      const open = held.filter(h => !h.released);
      if (open.length) problems.push('requests left held: ' + open.map(h => h.site + '#' + h.call).join(', '));
    }
    const failed = held.filter(h => h.released && h.status >= 400).sort((a, b) => a.releasedAt - b.releasedAt)
      .map(h => ({ url: new URL(h.url, 'http://x').pathname, text: 'Failed to load resource: the server responded with a status of ' + h.status + ' (' + (h.status === 500 ? 'Internal Server Error' : h.status === 403 ? 'Forbidden' : '?') + ')' }));
    if (JSON.stringify(network) !== JSON.stringify(failed)) problems.push('network errors ' + JSON.stringify(network) + ', expected one per failed response ' + JSON.stringify(failed));
    const consoleLog: string[] = await page.evaluate(() => (window as any).__framesConsole ?? []);
    for (const m of consoleLog) if (!messages.includes(m)) messages.push(m);
  } catch (e) {
    problems.push('browser: ' + String((e as Error)?.message ?? e));
  } finally {
    for (const h of held) if (!h.released) { try { release(h); } catch { /* closed */ } }
    await context.close();
    server.close();
  }
  const requests: RequestRow[] = held.sort((a, b) => a.seq - b.seq).map(h => ({ step: h.step, site: h.site, call: h.call, id: h.id, args: h.args, outcome: h.released ? (h.error ? 'error' : 'ok') : 'held' }));
  const wire = (await leg.log()).wire;
  const all = [...problems, ...messages];
  return { ok: all.length === 0, problems: all, steps, frames, seen, requests, hosts, dom, wire, modules, console: messages };
}

/** The frame-stream wire format's messages (shared.ts `createChunk`: `;0x` + 8 hex digits of the UTF-8 byte length +
 *  `;` + the JSON text), in order. Anything else in the body is an error, not skipped. */
export function frameMessages(body: string): string[] {
  const bytes = Buffer.from(body, 'utf8');
  const out: string[] = [];
  let at = 0;
  while (at < bytes.length) {
    const head = bytes.subarray(at, at + 12).toString('latin1');
    const m = /^;0x([0-9a-f]{8});$/.exec(head);
    if (!m) throw new Error('not a frame-stream chunk at byte ' + at + ': ' + JSON.stringify(head));
    const n = parseInt(m[1], 16);
    out.push(bytes.subarray(at + 12, at + 12 + n).toString('utf8'));
    at += 12 + n;
  }
  return out;
}

export const sliceDir = (name: string) => fileURLToPath(new URL('../slices/' + name + '/', import.meta.url));
export const readSlice = (name: string, file: string) => readFileSync(join(sliceDir(name), file), 'utf8');
export const here = (f: string) => join(HERE, f);
export { dirname };
