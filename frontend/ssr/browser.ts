// The hydration oracle (docs/RESULTS.md, "Slice 5"): server HTML loaded in Chromium (Playwright), hydrated by Solid's
// client build of the same TSX ({ generate: "dom", hydratable: true }), then driven through a scenario. The page is
// `<!doctype html>`, an import map onto the read-only solid-next builds (production by default, dev on request: the dev
// builds report key misses, tag and structure mismatches and unclaimed nodes on the console), the hydration script,
// and `<div id="app">` holding the server HTML byte for byte. No bundler: the client modules are Solid's dist files and
// the compiled TSX with its types stripped (node:module stripTypeScriptTypes).
//
// A run fails, with every problem listed, when: the page reports an error or a console error/warning; hydration
// creates an element the server did not send, drops one it did, or leaves a server key unclaimed; hydration changes
// the container's HTML in any way but removing the server's `<!--!$-->` text separators (which Solid's client strips by
// design, web/src/client.ts `stripTextSeparators`/`claimChildNodes`); the text before or after hydration is not the mount frame; or a step's target, settlement or
// frame differs from the scenario. Steps follow slices/run-js.ts: a click is a DOM click on the target (the elements
// handling click in document order, by text and parent text), a settlement resolves or rejects the named request with
// exactly its arguments, and three turns (a task, then flush()) follow each step; every request must be settled.
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { transform } from '@solidjs/compiler';
import type { ScenarioStep } from '../plan/fuzz/host.ts';

const SOLID = fileURLToPath(new URL('../../solid-next/packages/', import.meta.url));
export type Build = 'prod' | 'dev';
const IMPORTS: Record<Build, Record<string, string>> = {
  prod: {
    'solid-js': '/pkg/solid/dist/solid.js',
    'solid-js/internal': '/pkg/solid/dist/internal.js',
    '@solidjs/signals': '/pkg/signals/dist/prod/index.js',
    '@solidjs/web': '/pkg/web/dist/web.js',
  },
  dev: {
    'solid-js': '/pkg/solid/dist/solid.dev.js',
    'solid-js/internal': '/pkg/solid/dist/internal.js',
    'solid-js/attribution': '/pkg/solid/dist/attribution.js',
    '@solidjs/signals': '/pkg/signals/dist/dev.js',
    '@solidjs/signals/attribution': '/pkg/signals/dist/dev.attribution.js',
    '@solidjs/web': '/pkg/web/dist/web.dev.js',
  },
};

/** The stream page's prelude (in `<head>`, before any chunk): the chunk sentinel's log; the frame (the text of
 *  `#app`, script and template contents excluded); live clickables and pending requests, and a step's application, for
 *  the continuation; and the fresh-element marks: every element the page creates through `createElement`,
 *  `cloneNode` or `importNode` (the client's templates) is marked, so an element in `#app` after hydration that is
 *  marked was created by the client instead of claimed. Elements the parser creates are never marked. */
const PAGE_PRELUDE = `window.__ssrSeen=[];window.__ssrFed=k=>window.__ssrSeen.push(k);
window.__ssrConsole=[];for(const level of ['error','warn']){const f=console[level];console[level]=function(...a){window.__ssrConsole.push(level+': '+a.map(x=>x instanceof Error?x.name+': '+x.message:typeof x==='string'?x:String(x)).join(' '));return f.apply(this,a)}}
(()=>{const mark=n=>{if(n&&n.nodeType===1){n.__ssrFresh=1;for(const c of n.querySelectorAll('*'))c.__ssrFresh=1}else if(n&&n.nodeType===11)for(const c of n.querySelectorAll('*'))c.__ssrFresh=1;return n};
const ce=Document.prototype.createElement;Document.prototype.createElement=function(...a){return mark(ce.apply(this,a))};
const cn=Node.prototype.cloneNode;Node.prototype.cloneNode=function(...a){return mark(cn.apply(this,a))};
const im=Document.prototype.importNode;Document.prototype.importNode=function(...a){return mark(im.apply(this,a))}})();
window.__ssrFrame=()=>{const w=n=>n.nodeType===3?n.nodeValue:n.nodeType===1&&(n.localName==='script'||n.localName==='template')?'':[...n.childNodes].map(w).join('');return w(document.getElementById('app'))};
window.__ssrText=n=>n.textContent;
window.__ssrClickables=()=>{const root=document.getElementById('app');return [...root.querySelectorAll('*')].filter(e=>typeof e._$$click==='function')};
window.__ssrLive=()=>{const root=document.getElementById('app');const cs=window.__ssrClickables();const t=e=>window.__ssrFrameOf(e);
const info=cs.map(e=>({e,text:t(e),parent:e.parentElement&&e.parentElement!==root?t(e.parentElement):undefined}));
return {clickables:info.map(c=>({target:Object.assign({text:c.text},c.parent===undefined?{}:{parent:c.parent},{index:info.filter(d=>d.text===c.text&&(c.parent===undefined||d.parent===c.parent)).indexOf(c)})})),
pending:Object.entries((window.__ssrHost||{calls:{}}).calls).flatMap(([h,cs])=>cs.map((c,k)=>({host:h,call:k+1,args:c.args,done:c.done}))).filter(x=>!x.done).map(({host,call,args})=>({host,call,args}))}};
window.__ssrFrameOf=n=>{const w=n=>n.nodeType===3?n.nodeValue:n.nodeType===1&&(n.localName==='script'||n.localName==='template')?'':[...n.childNodes].map(w).join('');return w(n)};
window.__ssrApply=step=>{const root=document.getElementById('app');const H=window.__ssrHost||{calls:{}};
if(step.type==='click'){const cs=window.__ssrClickables();const t=step.target;const f=window.__ssrFrameOf;
const el=cs.filter(e=>f(e)===t.text&&(t.parent===undefined||(e.parentElement&&e.parentElement!==root&&f(e.parentElement)===t.parent)))[t.index];
if(!el)return 'no clickable '+JSON.stringify(t);el.click();return null}
if(step.type==='mount')return 'a second mount';
const c=(H.calls[step.host]||[])[step.call-1];if(!c||c.done)return step.host+'#'+step.call+' is not a pending request';
if(step.args!==undefined&&JSON.stringify(c.args)!==JSON.stringify(step.args))return 'arguments '+JSON.stringify(c.args);
c.done=true;if(step.type==='resolve')c.resolve(step.value);else c.reject(new Error(step.error));return null};`;

/** The client module of a TSX program: Solid's hydratable DOM output, types stripped, `./api` served beside it. */
export function clientModule(tsx: string): string {
  const code = transform(tsx, { filename: 'App.tsx', generate: 'dom', hydratable: true }).code;
  return stripTypeScriptTypes(code).replaceAll('"./api"', '"./api.js"');
}

/** The host stub the client imports: every call is a new pending request, settled by the scenario. */
export function apiModule(hosts: string[]): string {
  return 'const H = (window.__ssrHost ??= { calls: {} });\n' + hosts.map(h =>
    'export const ' + h + ' = (...args) => new Promise((resolve, reject) => { (H.calls[' + JSON.stringify(h) + '] ??= []).push({ args, resolve, reject, done: false }); });').join('\n') + '\n';
}

export type Page = { html: string; script: string; client: string; api: string; steps: ScenarioStep[]; build?: Build };
/** Slice 5, async data: a server stream fed to the page chunk by chunk (a renderToString HTML is one chunk). `when`:
 *  hydrate after the first chunk (the shell) and feed the rest after, or after the last. `offsets`: the requests per host
 *  the server made and serialized; the client's numbering continues after them. `steps`: a continuation to replay (its
 *  frames checked); else `chooser` (a gen-async case) records one. `fromMount`: `steps[0]` is a mount step whose frame
 *  is checked after hydration (renderToString: the client asks for its data itself). */
export type StreamPage = {
  chunks: string[]; when: 'shell' | 'end'; script: string; client: string; api: string; build?: Build;
  offsets: Record<string, number>; steps?: ScenarioStep[]; chooser?: unknown; fromMount?: boolean;
};
export type StreamHydration = {
  ok: boolean; problems: string[];
  /** The frame after hydration, and after each later chunk ('shell'); the frame after hydration ('end'). */
  streamFrames: string[];
  /** The continuation's frames, one per step. */
  frames: string[]; steps: ScenarioStep[];
  /** `#app`'s HTML once hydrated and every chunk was fed, before the continuation, `<!--!$-->` removed. */
  settledHtml: string;
  fresh: string[]; unclaimed: string[];
  /** Page errors (uncaught exceptions): each is a problem. */
  messages: string[];
  /** Every `console.error`/`console.warn` the page made, its arguments as text (an Error as `name: message`): Solid's
   *  dev builds report hydration mismatches there, and log errors its boundaries caught. Compared with the control's. */
  console: string[];
};
export type Hydration = {
  ok: boolean; problems: string[]; frames: string[];
  fresh: string[]; dropped: string[]; unclaimed: number; htmlChanged: boolean; separators: number; messages: string[];
};

export async function openBrowser() {
  const { chromium } = await import('playwright');
  const executablePath = process.env.CHROMIUM ?? execSync('command -v chromium', { encoding: 'utf8' }).trim();
  if (!executablePath) throw new Error('no Chromium: set CHROMIUM or put chromium on PATH');
  const browser = await chromium.launch({ executablePath });
  const pages = new Map<string, Page>();
  const streams = new Map<string, { page: StreamPage; res?: import('node:http').ServerResponse; waiting?: () => void }>();
  let seq = 0;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    // The page's implicit favicon request: answered empty, so that no 404 reaches the console.
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const send = (type: string, body: string | Buffer) => { res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    if (url.pathname.startsWith('/pkg/')) {
      const rel = url.pathname.slice(5);
      if (rel.includes('..') || !/^(solid|signals|web)\/dist\//.test(rel)) { res.writeHead(404); res.end(); return; }
      try { send('text/javascript', readFileSync(SOLID + rel)); } catch { res.writeHead(404); res.end(); }
      return;
    }
    const sm = /^\/stream\/(\d+)\/(index\.html|app\.js|api\.js|entry\.js)$/.exec(url.pathname);
    const st = sm && streams.get(sm[1]);
    if (sm && st) {
      if (sm[2] === 'index.html') {
        // The document stays open: the harness writes each chunk (stream-feed below), then ends it.
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.write('<!doctype html><html><head><script type="importmap">' + JSON.stringify({ imports: IMPORTS[st.page.build ?? 'prod'] }) + '</script>' + st.page.script +
          '<script>' + PAGE_PRELUDE + '</script></head><body><div id="app">');
        st.res = res;
        st.waiting?.();
      } else if (sm[2] === 'app.js') send('text/javascript', st.page.client);
      else if (sm[2] === 'api.js') send('text/javascript', st.page.api);
      else send('text/javascript', 'export { default as App } from "./app.js";\nexport { hydrate } from "@solidjs/web";\nexport { flush, sharedConfig } from "solid-js";\n');
      return;
    }
    const m = /^\/app\/(\d+)\/(index\.html|app\.js|api\.js|entry\.js)$/.exec(url.pathname);
    const p = m && pages.get(m[1]);
    if (!m || !p) { res.writeHead(404); res.end(); return; }
    if (m[2] === 'index.html') {
      const map = JSON.stringify({ imports: IMPORTS[p.build ?? 'prod'] });
      send('text/html; charset=utf-8', '<!doctype html><html><head><script type="importmap">' + map + '</script>' + p.script +
        '</head><body><div id="app">' + p.html + '</div></body></html>');
    } else if (m[2] === 'app.js') send('text/javascript', p.client);
    else if (m[2] === 'api.js') send('text/javascript', p.api);
    else send('text/javascript', 'export { default as App } from "./app.js";\nexport { hydrate } from "@solidjs/web";\nexport { flush, sharedConfig } from "solid-js";\n');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;

  async function hydrate(p: Page): Promise<Hydration> {
    const id = String(++seq);
    pages.set(id, p);
    const page = await browser.newPage();
    const messages: string[] = [];
    page.on('pageerror', (e: Error) => messages.push('pageerror: ' + e.message));
    page.on('console', (m: { type(): string; text(): string; location(): { url: string } }) => { if (m.type() === 'error' || m.type() === 'warning') messages.push(m.type() + ': ' + m.text() + (m.location()?.url ? ' (' + m.location().url + ')' : '')); });
    try {
      await page.goto('http://127.0.0.1:' + port + '/app/' + id + '/index.html', { waitUntil: 'load' });
      const r = await page.evaluate(async ({ steps, entry }) => {
        const root = document.getElementById('app')!;
        const problems: string[] = [];
        const frames: string[] = [];
        const before = root.innerHTML;
        if (root.textContent !== steps[0].frame) problems.push('server text ' + JSON.stringify(root.textContent) + ' is not the mount frame ' + JSON.stringify(steps[0].frame));
        const served = [...root.querySelectorAll('*')];
        for (const e of served) (e as any).__srv = 1;
        const m = await import(entry);
        const turns = async () => { for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 0)); m.flush(); } };
        try { m.hydrate(() => m.App(), root); } catch (e) { problems.push('hydrate threw: ' + String((e as Error)?.message ?? e)); return { problems, frames, fresh: [], dropped: [], unclaimed: -1, htmlChanged: true, separators: 0 }; }
        // Read at once: the client clears its key registry in a task after hydration ends (solid.js
        // drainHydrationCallbacks). A key left there is a server element no getNextElement claimed; independently, every
        // keyed server element must be in `_$HY.completed`, where getNextElement records each claim.
        const unclaimed = m.sharedConfig.registry ? m.sharedConfig.registry.size : -1;
        if (unclaimed < 0) problems.push('the client has no hydration registry');
        const done = (window as any)._$HY?.completed as WeakSet<Element> | undefined;
        const unadopted = served.filter(e => e.hasAttribute('_hk') && !done?.has(e)).map(e => e.getAttribute('_hk'));
        if (unadopted.length) problems.push('keyed server elements not adopted: ' + unadopted.join(' '));
        await turns();
        const fresh = [...root.querySelectorAll('*')].filter(e => !(e as any).__srv).map(e => e.localName);
        const dropped = served.filter(e => !e.isConnected).map(e => e.localName);
        // Solid's client removes the `<!--!$-->` separators it claims past; nothing else may change.
        const separators = before.split('<!--!$-->').length - 1;
        const htmlChanged = root.innerHTML !== before.split('<!--!$-->').join('');
        if (fresh.length) problems.push('hydration created ' + fresh.join(' '));
        if (dropped.length) problems.push('hydration dropped ' + dropped.join(' '));
        if (unclaimed) problems.push(unclaimed + ' server key(s) never claimed');
        if (htmlChanged) problems.push('hydration changed the HTML: ' + JSON.stringify(root.innerHTML));
        frames.push(root.textContent ?? '');
        const H = (window as any).__ssrHost ?? { calls: {} };
        for (const [i, step] of steps.entries()) {
          if (i === 0) continue;
          if (step.type === 'click') {
            const clickables = [...root.querySelectorAll('*')].filter(e => typeof (e as any)._$$click === 'function');
            let el: Element | undefined;
            if ('element' in step) el = clickables[step.element];
            else {
              const t = step.target;
              el = clickables.filter(e => e.textContent === t.text && (t.parent === undefined || e.parentElement?.textContent === t.parent))[t.index];
            }
            if (!el) { problems.push('step ' + i + ': no clickable ' + JSON.stringify('element' in step ? step.element : step.target)); break; }
            (el as HTMLElement).click();
          } else if (step.type === 'mount') { problems.push('step ' + i + ': a second mount'); break; } else {
            const c = (H.calls[step.host] ?? [])[step.call - 1];
            if (!c || c.done) { problems.push('step ' + i + ': ' + step.host + '#' + step.call + ' is not a pending request'); break; }
            if (step.args !== undefined && JSON.stringify(c.args) !== JSON.stringify(step.args)) { problems.push('step ' + i + ': arguments ' + JSON.stringify(c.args)); break; }
            c.done = true;
            if (step.type === 'resolve') c.resolve(step.value); else c.reject(new Error(step.error));
          }
          await turns();
          frames.push(root.textContent ?? '');
          if (frames[i] !== step.frame) { problems.push('step ' + i + ': frame ' + JSON.stringify(frames[i]) + ', expected ' + JSON.stringify(step.frame)); break; }
        }
        if (!problems.length) {
          const open = Object.entries(H.calls as Record<string, { done: boolean }[]>).flatMap(([h, cs]) => cs.map((c, k) => [h, k + 1, c.done] as const)).filter(x => !x[2]);
          if (open.length) problems.push('requests left pending: ' + open.map(x => x[0] + '#' + x[1]).join(', '));
        }
        return { problems, frames, fresh, dropped, unclaimed, htmlChanged, separators };
      }, { steps: p.steps, entry: '/app/' + id + '/entry.js' });
      const problems = [...r.problems, ...messages];
      if (r.frames[0] !== p.steps[0].frame && !problems.some(x => x.startsWith('hydrate threw'))) problems.push('mount frame after hydration ' + JSON.stringify(r.frames[0]));
      return { ok: problems.length === 0, ...r, problems, messages };
    } catch (e) {
      return { ok: false, problems: ['browser: ' + String((e as Error)?.message ?? e), ...messages], frames: [], fresh: [], dropped: [], unclaimed: -1, htmlChanged: true, separators: 0, messages };
    } finally {
      pages.delete(id);
      await page.close();
    }
  }
  async function hydrateStream(p: StreamPage): Promise<StreamHydration> {
    const id = String(++seq);
    const entry: { page: StreamPage; res?: import('node:http').ServerResponse; waiting?: () => void } = { page: p };
    streams.set(id, entry);
    const page = await browser.newPage();
    const messages: string[] = [];
    page.on('pageerror', (e: Error) => messages.push('pageerror: ' + e.message));
    const empty = (problems: string[]): StreamHydration => ({ ok: false, problems: [...problems, ...messages], streamFrames: [], frames: [], steps: [], settledHtml: '', fresh: [], unclaimed: [], messages, console: [] });
    try {
      const opened = new Promise<void>(r => { entry.waiting = r; });
      await page.goto('http://127.0.0.1:' + port + '/stream/' + id + '/index.html', { waitUntil: 'commit' });
      await opened;
      // Each chunk is followed by a script that removes itself and records that every node and script before it was
      // parsed and run: the DOM is as if it were not there; the chunk's bytes are untouched.
      const feed = async (k: number) => {
        entry.res!.write(p.chunks[k] + '<script>document.currentScript.remove();__ssrFed(' + k + ')</script>');
        await page.waitForFunction((k: number) => (window as any).__ssrSeen.includes(k), k);
      };
      const end = () => entry.res!.end('</div></body></html>');
      const turns = () => page.evaluate(async () => { const m = await import((window as any).__ssrEntry); for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 0)); m.flush(); } });
      const frame = () => page.evaluate(() => (window as any).__ssrFrame());
      const problems: string[] = [];
      const streamFrames: string[] = [];
      const hydrate = async () => {
        const r = await page.evaluate(async ({ offsets, entry }) => {
          (window as any).__ssrEntry = entry;
          const H = ((window as any).__ssrHost ??= { calls: {} });
          for (const [h, n] of Object.entries(offsets as Record<string, number>)) for (let i = 0; i < n; i++) (H.calls[h] ??= []).push({ args: null, done: true, server: true });
          const m = await import(entry);
          // The client records each claim in `_$HY.completed` and drops the set once hydration is done: keep it.
          (window as any).__ssrCompleted = (window as any)._$HY?.completed;
          try { m.hydrate(() => m.App(), document.getElementById('app')); } catch (e) { return 'hydrate threw: ' + String((e as Error)?.message ?? e); }
          return null;
        }, { offsets: p.offsets, entry: '/stream/' + id + '/entry.js' });
        if (r) problems.push(r);
      };
      if (p.when === 'shell') {
        await feed(0);
        await hydrate();
        await turns();
        streamFrames.push(await frame());
        for (let k = 1; k < p.chunks.length; k++) { await feed(k); await turns(); streamFrames.push(await frame()); }
        end();
        await turns();
      } else {
        for (let k = 0; k < p.chunks.length; k++) await feed(k);
        end();
        await hydrate();
        await turns();
        streamFrames.push(await frame());
      }
      if (problems.length) return empty(problems);
      // Hydration's checks: no element the client created, every served keyed element still in the document claimed
      // (`_$HY.completed`, where getNextElement records each claim).
      const check = await page.evaluate(() => {
        const root = document.getElementById('app')!;
        const done = (window as any).__ssrCompleted as WeakSet<Element> | undefined;
        const els = [...root.querySelectorAll('*')].filter(e => e.localName !== 'script' && e.localName !== 'template');
        return {
          fresh: els.filter(e => (e as any).__ssrFresh).map(e => e.localName),
          unclaimed: els.filter(e => e.hasAttribute('_hk') && !done?.has(e)).map(e => e.getAttribute('_hk')!),
          settledHtml: root.innerHTML.split('<!--!$-->').join(''),
        };
      });
      // `fresh` and `unclaimed` are observations, compared with the control's: Solid's client renders a streamed
      // failure's fallback fresh by design (#4287, server.ts `sink.fragment`).
      // The continuation.
      const frames: string[] = [];
      const steps: ScenarioStep[] = [];
      const chooser = p.chooser ? (await import('../plan/fuzz/gen-async.ts')).chooserFor(p.chooser as never) : undefined;
      let index = 0;
      if (p.fromMount) {
        const want = p.steps![0];
        if (streamFrames[0] !== want.frame) problems.push('the hydrated frame ' + JSON.stringify(streamFrames[0]) + ' is not the mount frame ' + JSON.stringify(want.frame));
        frames.push(streamFrames[0]); steps.push(want);
        index = 1;
      }
      for (; !problems.length; index++) {
        let step: Record<string, unknown> | null;
        if (chooser) {
          if (index > 200) { problems.push('the chooser did not stop'); break; }
          const live = await page.evaluate(() => (window as any).__ssrLive());
          step = chooser(live) as never;
          if (!step) break;
        } else {
          if (index >= p.steps!.length) break;
          step = p.steps![index] as never;
        }
        const applied = await page.evaluate((step) => (window as any).__ssrApply(step), step);
        if (applied) { problems.push('step ' + index + ': ' + applied); break; }
        await turns();
        const f = await frame();
        frames.push(f);
        steps.push({ ...(step as object), frame: f } as never);
        if (!chooser && f !== (step as { frame: string }).frame) { problems.push('step ' + index + ': frame ' + JSON.stringify(f) + ', expected ' + JSON.stringify((step as { frame: string }).frame)); break; }
      }
      if (!problems.length) {
        const open = await page.evaluate(() => Object.entries(((window as any).__ssrHost ?? { calls: {} }).calls as Record<string, { done: boolean }[]>)
          .flatMap(([h, cs]) => cs.map((c, k) => [h, k + 1, c.done] as const)).filter(x => !x[2]).map(x => x[0] + '#' + x[1]));
        if (open.length) problems.push('requests left pending: ' + open.join(', '));
      }
      const all = [...problems, ...messages];
      const consoleLog = await page.evaluate(() => (window as any).__ssrConsole as string[]);
      return { ok: all.length === 0, problems: all, streamFrames, frames, steps, settledHtml: check.settledHtml, fresh: check.fresh, unclaimed: check.unclaimed, messages, console: consoleLog };
    } catch (e) {
      return empty(['browser: ' + String((e as Error)?.message ?? e)]);
    } finally {
      streams.delete(id);
      try { entry.res?.end(); } catch { /* already ended */ }
      await page.close();
    }
  }
  return {
    hydrate,
    hydrateStream,
    async close() { await browser.close(); server.close(); },
  };
}
export type Browser = Awaited<ReturnType<typeof openBrowser>>;
