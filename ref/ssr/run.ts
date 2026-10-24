// 10-server: renders every scenario's mount on the server and streams it to a real browser. For each table, the rows
// up to the first handler are the mount and its landings (the instants a server can stream); the server renders the
// compiled program with solid-js 2.0's server build (ref/compile/rt-server.ts), the runner lands each flight as the rows
// say, and the browser's visible text after each chunk is a server frame. SV-1: the server frames, deduplicated, are the
// client's frames in order — the first is the mount's, and a landing may be coalesced with the next — with a panic's
// message redacted (SV-5).
// node --experimental-strip-types ssr/run.ts [filter]      (default conditions: solid-js resolves to its server build)
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { parseScenario, moduleSet, type Scenario } from "../src/scenario.ts";
import { parseStmts } from "../src/parse.ts";
import { checkModules } from "../src/check.ts";
import { compileModules, compileDynamicExpr, CompileError } from "../compile/emit.ts";
import { createApp, generateHydrationScript } from "../compile/rt-server.ts";

process.on("unhandledRejection", () => {});
const { chromium } = createRequire(import.meta.url)("playwright");
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const outDir = fileURLToPath(new URL("./.out/", import.meta.url)); mkdirSync(outDir, { recursive: true });
export const REDACTED = "Internal Server Error";   // what Solid sends for an error not marked safe

// One live response at a time: the runner holds it open and writes what the server render streams.
let pending: ((res: import("node:http").ServerResponse) => void) | null = null;
const http = createServer((req, res) => { if (req.url === "/favicon.ico") { res.statusCode = 404; res.end(); return; } res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); const p = pending; pending = null; if (p) p(res); else res.end("no render"); });
await new Promise<void>(r => http.listen(0, "127.0.0.1", () => r()));
const port = (http.address() as { port: number }).port;
const browser = await chromium.launch();
const page = await browser.newPage();
const textOf = () => page.evaluate(() => {
  const root = document.getElementById("app"); if (!root) return "";
  let s = ""; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => { for (let p = n.parentElement; p && p !== root; p = p.parentElement) if (p.tagName === "SCRIPT" || p.tagName === "TEMPLATE" || p.tagName === "STYLE") return NodeFilter.FILTER_REJECT; return NodeFilter.FILTER_ACCEPT; } });
  for (let n = w.nextNode(); n; n = w.nextNode()) s += n.nodeValue; return s;
});

let seq = 0;
const dedupe = (xs: string[]) => xs.filter((x, i) => i === 0 || x !== xs[i - 1]);

type Row = Scenario["tables"][number]["rows"][number];
type Served = { got: string[]; ended: boolean; file: string };

/** Serve `src` once (a request: a fresh app, so fresh module state — SV-4) and land `rows[1..]` in order; the browser's text
 *  after the shell and after each landing. Undefined when the program is not served (refused, not compiled — noted). */
async function serve(sc: Scenario, src: string, rows: Row[], title: string, lines: string[], other?: { chunks: string[] }): Promise<Served | undefined | false> {
  let out: ReturnType<typeof compileModules>;
  try { const set = moduleSet(sc, src); if (checkModules(set).diags.length) { lines.push(`  ~ ${title}: refused by the checker`); return undefined; } out = compileModules(set, {}); }
  catch (e) { if (e instanceof CompileError) { lines.push(`  ~ ${title}: not compiled — ${e.message}`); return undefined; } lines.push(`  ✗ ${title}: ${(e as Error).message}`); return false; }
  const dir = `${outDir}${sc.name}.${++seq}/`; mkdirSync(dir, { recursive: true });
  for (const [name, js] of out.files) writeFileSync(dir + name, js);
  const main = (await import(pathToFileURL(dir + out.entry).href)).default;
  const app = createApp();
  const got: string[] = []; let ended = false; let chunks = 0; let renderError: unknown = null;
  const doc: string[] = [];
  const served$ = new Promise<void>(resolve => {
    pending = res => {
      res.on("error", () => {});
      res.write(`<!doctype html><html><head>${generateHydrationScript()}</head><body><div id="app">`);
      try { app.stream(main(app), { write: (c: string) => { chunks++; doc.push(c); if (!res.writableEnded) res.write(c); }, end: () => { ended = true; if (!res.writableEnded) res.end("</div></body></html>"); } }); }
      catch (e) { renderError = e; res.end(); }
      resolve();
    };
  });
  // SV-4: another request for the same page, in flight at the same time — its own app, its own module state
  if (other) { const b = createApp(); b.stream(main(b), { write: (c: string) => { other.chunks.push(c); }, end: () => {} }); }
  const nav = page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "commit" }).catch(() => {});
  await served$; await nav;
  for (let i = 0; i < 40 && chunks === 0 && !ended && !renderError; i++) await wait(10);
  await wait(40);
  if (renderError) { lines.push(`  ✗ ${title}: server render threw: ${(renderError as Error).message}`); return false; }
  got.push(norm(await textOf()));
  for (const r of rows.slice(1)) {
    const m = /^(resolve|reject)\s+(\S+)\s+([\s\S]*)$/.exec(r.action);
    if (!m) { lines.push(`  ✗ ${title} instant ${r.instant}: a server table has mount, resolve and reject rows only`); return false; }
    const key = /^".*"$/.test(m[2]) ? m[2].slice(1, -1) : app.lastKey.get(m[2]);
    const f = key === undefined ? undefined : app.flights.get(key);
    if (!f) { if (ended) break; lines.push(`  ✗ ${title} instant ${r.instant}: the server has no flight for ${m[2]}`); return false; }
    const v = parseStmts(m[3])[0];
    const value = v.k === "expr" ? new Function("__rt", "__B", `return ${compileDynamicExpr(v.e)};`)(app, app.B) : undefined;
    if (m[1] === "reject") f.reject(value instanceof Error ? value : new Error(String(value))); else f.resolve(value);
    await wait(60);
    got.push(norm(await textOf()));
  }
  writeFileSync(dir + "stream.html", doc.join("\n<!-- chunk -->\n"));
  return { got, ended, file: dir + "stream.html" };
}

/** SV-1 over a client table: its mount and landings, served; the server's frames, deduplicated, must be the client's in order. */
async function runTable(sc: Scenario, t: Scenario["tables"][number], base: Scenario["tables"][number] | undefined, lines: string[]): Promise<boolean> {
  const src = t.program ?? sc.program;
  let rows = t.rows; let own = 0;   // own: rows before this index are the base's, replayed to drive state
  if (t !== base && base && rows.length && rows[0].instant > 0) { const pre = base.rows.filter(r => r.instant < rows[0].instant); own = pre.length; rows = [...pre, ...rows]; }
  const chains: Row[][] = []; for (const r of rows) { if (r.action === "(effect)" && chains.length) chains[chains.length - 1].push(r); else chains.push([r]); }
  const upTo = chains.findIndex(c => !(c[0].action === "mount" || /^(resolve|reject)\s/.test(c[0].action)));
  const served = upTo < 0 ? chains : chains.slice(0, upTo);
  if (!served.length || served[0][0].action !== "mount") return true;
  // A variant with its own program has no frames for the base's rows: they only drive state, and its own rows are checked.
  const from = t.program ? served.findIndex(c => rows.indexOf(c[0]) >= own) : 0;
  if (from < 0) { lines.push(`  ~ ${t.title}: a variant program whose own rows begin after a handler`); return true; }
  // the client's frames for these instants: the spec's, or the oracle's where a divergence is recorded — every row of a
  // chain, since the server runs no effect (SV-2) and shows the frame before an effect's chain lands
  // (a `server` divergence: what Solid's server render shows there instead — DV-9)
  const frameOf = (r: Row) => { const sv = !scope && sc.divergences.find(d => d.runner === "server" && d.table === t.title && d.instant === r.instant); if (sv) return norm(sv.frame); const div = sc.divergences.find(d => d.runner === "oracle" && d.table === t.title && d.instant === r.instant); return norm(div ? div.frame : r.frame); };
  const want = served.slice(from).flatMap(c => c.map(frameOf));
  const res = await serve(sc, src, served.map(c => c[0]), t.title, lines);
  if (!res) return res !== false;
  const g = dedupe(res.got.slice(from)); const w = dedupe(want);
  let j = 0;
  for (const [i, s] of g.entries()) {
    const k = w.findIndex((x, n) => n >= j && (x === s || redactedMatch(x, s)));
    if (k < 0 || (i === 0 && from === 0 && k !== 0)) { lines.push(`  ✗ ${t.title}: server frame '${s}' is not ${i === 0 && from === 0 ? "the mount's" : "a later client frame"} (client: ${w.map(x => `'${x}'`).join(" → ")})  (${res.file})`); return false; }
    j = k + 1;
  }
  lines.push(`  ✓ ${t.title}: ${g.map(x => `'${x}'`).join(" → ")}${res.ended ? "" : "  (stream open)"}`);
  return true;
}

/** `## Server frames`: exactly what the browser shows from the stream, row by row (a `server` divergence where Solid differs). */
async function runServerTable(sc: Scenario, lines: string[]): Promise<boolean> {
  const title = "Server frames";
  const other = { chunks: [] as string[] };
  const res = await serve(sc, sc.program, sc.server, title, lines, other);
  if (!res) return res !== false;
  let ok = true;
  // SV-4: the landings were the first request's; the second, sharing every module, still shows its shell
  if (other.chunks.length !== 1) { ok = false; lines.push(`  ✗ ${title}: a concurrent request received ${other.chunks.length} chunks — module state leaked across requests`); }
  else lines.push(`  ✓ ${title}: a concurrent request kept its own shell (SV-4)`);
  sc.server.forEach((r, i) => {
    const div = sc.divergences.find(d => d.runner === "server" && d.table === title && d.instant === r.instant);
    const want = norm(div && !scope ? div.frame : r.frame); const got = res.got[i];
    if (got === want) lines.push(`  ${div && !scope ? "≠" : "✓"} ${title} instant ${r.instant}: ${got}`);
    else { ok = false; lines.push(`  ✗ ${title} instant ${r.instant}: expected '${want}', got '${got ?? "(no frame)"}'  (${res.file})`); }
  });
  return ok;
}
const scope = !!process.env.SV_SCOPE;   // probe: render inside Solid's server-component scope, where a failure after the shell streams its fallback (DV-9)
/** A client frame that shows a panic's message, shown by the server as Solid's generic message. */
function redactedMatch(client: string, server: string): boolean {
  if (!server.includes(REDACTED)) return false;
  const [pre, post] = server.split(REDACTED);
  return client.startsWith(pre) && client.endsWith(post) && client.length > pre.length + post.length - 1;
}

const filter = process.argv[2];
const dir = new URL("../../scenarios/", import.meta.url);
let pass = 0, fail = 0, skip = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith(".md") && f !== "TEMPLATE.md" && !f.startsWith("OPEN-") && (!filter || f.includes(filter))).sort()) {
  const sc = parseScenario(f.replace(/\.md$/, ""), readFileSync(new URL(f, dir), "utf8"), fileURLToPath(dir));
  const lines: string[] = []; let ok = true;
  const base = sc.tables.find(t => t.title === "Frames");
  for (const t of sc.tables) { try { ok = (await runTable(sc, t, base, lines)) && ok; } catch (e) { ok = false; lines.push(`  ✗ ${t.title}: ${(e as Error).stack}`); } }
  if (sc.server.length) { try { ok = (await runServerTable(sc, lines)) && ok; } catch (e) { ok = false; lines.push(`  ✗ Server frames: ${(e as Error).stack}`); } }
  const skipped = lines.some(l => l.includes("~ ")) && !lines.some(l => l.includes("✗"));
  console.log(`${ok ? (skipped ? "SKIP" : "PASS") : "FAIL"} ${sc.name}`); for (const l of lines) console.log(l);
  if (!ok) fail++; else if (skipped) skip++; else pass++;
}
console.log(`\n${pass} pass, ${fail} fail, ${skip} skip (server render → solid-js 2.0.0-rc.16, streamed to Chromium)`);
await browser.close(); http.close();
process.exit(fail ? 1 : 0);
