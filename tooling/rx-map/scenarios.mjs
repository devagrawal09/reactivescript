#!/usr/bin/env node
// RX's own scenario coverage of examples/ (SLICE9-COVERAGE-CONTRACT §2 "Scenario runner", §6).
//
//   node tooling/rx-map/scenarios.mjs [--coverage <out.json>] [--report] [--update] [--quiet] [filter]
//
// Runs every `scenarios/*.md` whose program is a file under `examples/` (`file: ../examples/x.rx`) the way a dev build
// runs it: the Rust compiler's dev output (`rxc lower`, `dev: true`, so Solid nodes are named `rx:<key>` and boundaries
// are `DevLoading`/`DevErrored`; the table's handler rows as `extra`, as `ref/compile/run.ts` does with RX_CRATE=1),
// over `@reactivescript/runtime`'s dev build and Solid's dev dists, with the live bridge (`./live.mjs`) attached, in one
// headless Chromium, one fresh page per table. Rows are driven as the ref runners drive them (mount, handler
// statements, resolve/reject of the fake backend's flights, `(effect)`/`(flush)` chained onto the row before) and the
// frame after each is checked against the table (or a recorded oracle divergence). A failing frame is reported and the
// table goes on (more of the program runs); a row that throws ends its table. Neither ends the run.
//
// Every bridge message of a table goes to one coverage collector (`./coverage.mjs`), `begin("<scenario> / <table>")`
// before it and `end({failed})` after, and the collector's result is the one coverage file `--coverage` writes. Its
// universe is the graphs of every example program the run touched.
//
//   --coverage <file>   write the coverage file (JSON, §3)
//   --report            print the coverage report (`report()` of ./coverage.mjs) after the scenario results
//   --update            write test/fixtures/scenario-coverage.txt (the scenario results and the report)
//   --check             fail if test/fixtures/scenario-coverage.txt is not what this run gives
//   --quiet             only the per-table summary lines
//   filter              run only scenarios whose file name contains it
//   RX_SCENARIO_DUMP=<file>  also write every table's raw bridge messages (for debugging the collector)
//
// Needs: rxc ($RXC, compiler/target/{release,debug}/rxc), the compiler's Node-API binding (compiler/index.js, for the
// graph), runtime/dist/web.dev.js, a Solid dev build with attribution ($SOLID_VIEW: a solid checkout, or
// $SOLID_PACKAGES: its packages dir; default ../solid-view next to the repo), Playwright ($NODE_PATH or resolvable from
// here) and its Chromium ($CHROME to override). Exit 1 when a table fails.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const examples = path.join(repo, "examples") + path.sep;
const fixture = path.join(here, "test/fixtures/scenario-coverage.txt");
const TOOL = "rx-scenarios";

// ---- arguments ------------------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const flag = name => argv.includes(name);
const coverageOut = opt("--coverage");
const filter = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--coverage");
const quiet = flag("--quiet");

// ---- inputs ---------------------------------------------------------------------------------------------------------
const rxc = process.env.RXC ?? [path.join(repo, "compiler/target/release/rxc"), path.join(repo, "compiler/target/debug/rxc")].find(existsSync) ?? "rxc";
const solidPkgs = process.env.SOLID_PACKAGES ?? path.join(process.env.SOLID_VIEW ?? path.resolve(repo, "../solid-view"), "packages");
const runtimeDev = path.join(repo, "runtime/dist/web.dev.js");
for (const [what, f] of [["Solid dev build ($SOLID_VIEW / $SOLID_PACKAGES)", path.join(solidPkgs, "solid/dist/attribution.js")], ["runtime dev build (npm run build in runtime/)", runtimeDev]])
  if (!existsSync(f)) { console.error(`scenarios: no ${what} at ${f}`); process.exit(2); }

// The reference's scenario parser and its handler-statement compiler (TypeScript, stripped by Node). Handler rows are
// compiled the way every scenario runner compiles them (`compileDynamic`: `__rt.dget`/`dset` over the names the program
// registers); the program itself is the crate's.
const ref = p => import(pathToFileURL(path.join(repo, "ref", p)).href);
const [{ parseScenario }, { parseStmts }, { compileDynamic, compileDynamicExpr }, { loadModules }, { withDeclarations }] =
  await Promise.all([ref("src/scenario.ts"), ref("src/parse.ts"), ref("compile/emit.ts"), ref("src/modules.ts"), ref("src/dts-host.ts")]);
const { model } = createRequire(path.join(repo, "compiler/package.json"))("./index.js");
const { buildGraph } = await import("./graph.mjs");

function loadPlaywright() {
  const tries = [() => createRequire(import.meta.url)("playwright"),
    ...(process.env.NODE_PATH ?? "").split(path.delimiter).filter(Boolean).map(d => () => createRequire(path.join(d, "_.js"))("playwright"))];
  for (const t of tries) { try { return t(); } catch {} }
  console.error("scenarios: Playwright not found (set NODE_PATH to a node_modules that has it)");
  process.exit(2);
}

// ---- the scenarios --------------------------------------------------------------------------------------------------
const rel = p => path.relative(repo, p).split(path.sep).join("/");
const norm = s => s.replace(/\s+/g, " ").trim();
const sdir = path.join(repo, "scenarios") + path.sep;
const scenarios = readdirSync(sdir).filter(f => f.endsWith(".md") && f !== "TEMPLATE.md" && !f.startsWith("OPEN-") && (!filter || f.includes(filter))).sort()
  .map(f => parseScenario(f.replace(/\.md$/, ""), readFileSync(sdir + f, "utf8"), sdir))
  .filter(sc => sc.entry.startsWith(examples));
if (!scenarios.length) { console.error(`scenarios: no scenario over examples/${filter ? ` matches '${filter}'` : ""}`); process.exit(2); }

/** A table's work: its rows (a variant replays the base's rows before its first instant), as chains (a row and the
 *  `(effect)`/`(flush)` rows that follow it), each row's code compiled ahead, and its program's files. */
const tables = [];
for (const sc of scenarios) {
  const base = sc.tables.find(t => t.title === "Frames");
  for (const t of sc.tables) {
    const table = { sc, t, name: `${sc.name} / ${t.title}`, entry: rel(sc.entry), lines: [], status: "pass", messages: [] };
    tables.push(table);
    if (t.program) { table.status = "skip"; table.lines.push(`  ~ ${t.title}: a variant with its own program, not the example's code`); continue; }
    let rows = t.rows, own = 0;
    if (t !== base && base && rows.length && rows[0].instant > 0) { const pre = base.rows.filter(r => r.instant < rows[0].instant); own = pre.length; rows = [...pre, ...rows]; }
    const chains = [];
    for (const r of rows) { if ((r.action === "(effect)" || r.action === "(flush)") && chains.length) chains.at(-1).push(r); else chains.push([r]); }
    try {
      table.chains = chains.map(chain => {
        const r = chain[0], last = chain.at(-1);
        const div = sc.divergences.find(d => d.runner === "oracle" && d.table === t.title && d.instant === last.instant);
        const effects = chain.flatMap(c => sc.divergences.find(d => d.runner === "oracle" && d.table === t.title && d.instant === c.instant && d.effects)?.effects ?? c.effects);
        const step = { instant: last.instant, frame: norm(div ? div.frame : last.frame), divergent: !!div, effects, prefixed: rows.indexOf(r) < own };
        if (r.action === "mount") return { ...step, kind: "mount" };
        if (r.action.startsWith("handler")) return { ...step, kind: "handler", code: compileDynamic(parseStmts(r.action.slice(7))) };
        const m = /^(resolve|reject)\s+(\S+)\s+([\s\S]*)$/.exec(r.action);
        if (!m) throw new Error(`instant ${r.instant}: unknown action '${r.action}'`);
        const v = parseStmts(m[3])[0];
        return { ...step, kind: m[1], key: m[2], value: v.k === "expr" ? `return ${compileDynamicExpr(v.e)};` : "return undefined;" };
      });
    } catch (e) { table.status = "skip"; table.lines.push(`  ~ ${t.title}: not compiled — ${e.message}`); continue; }
    table.handlers = rows.filter(r => r.action.startsWith("handler")).map(r => r.action.slice(7));
    const files = {};
    const read0 = withDeclarations(p => p === sc.entry ? sc.program : sc.modules.get(p) ?? (existsSync(p) && statSync(p).isFile() ? readFileSync(p, "utf8") : undefined), sc.modules);
    loadModules(sc.entry, p => { const s = read0(p); if (s !== undefined) files[rel(p)] = s; return s; });
    table.files = files;
  }
}

// ---- compile: one `rxc lower` for every table, dev keys relative to the repo (as the graph's) ----------------------
const todo = tables.filter(t => t.files);
const lowered = todo.length ? JSON.parse(execFileSync(rxc, ["lower"], {
  input: JSON.stringify(todo.map((t, i) => ({ id: String(i), entry: t.entry, files: t.files, extra: t.handlers, dev: true, renderer: "@solidjs/web" }))),
  maxBuffer: 1 << 30,
}).toString()) : [];
const served = new Map();   // "/t/<i>/<module>.mjs" → code
todo.forEach((t, i) => {
  const r = lowered.find(x => x.id === String(i));
  if (r.refused) { t.status = "skip"; t.lines.push(`  ~ ${t.t.title}: refused by the checker`); return; }
  if (r.compileError) { t.status = "skip"; t.lines.push(`  ~ ${t.t.title}: not compiled — ${r.compileError}`); return; }
  if (r.error || r.panic) { t.status = "fail"; t.lines.push(`  ✗ ${t.t.title}: rxc lower: ${r.error ?? r.panic}`); return; }
  for (const [name, ts] of Object.entries(r.files)) {
    if (typeof ts.dom !== "string") { t.status = "fail"; t.lines.push(`  ✗ ${t.t.title}: ${name}: ${ts.dom.error}`); return; }
    served.set(`/t/${i}/${name}`, ts.dom);
  }
  t.module = `/t/${i}/${r.entry}`;
});

// ---- graphs: one per example program, keys relative to the repo ----------------------------------------------------
const graphs = new Map();
for (const t of tables) if (!graphs.has(t.entry)) graphs.set(t.entry, buildGraph(JSON.parse(model([path.join(repo, t.entry)], repo)), { root: repo }));

// ---- the page -------------------------------------------------------------------------------------------------------
const IMPORTS = {
  "solid-js": "/solid/solid/dist/solid.dev.js",
  "solid-js/attribution": "/solid/solid/dist/attribution.js",
  "solid-js/internal": "/solid/solid/dist/internal.js",
  "@solidjs/web": "/solid/web/dist/web.dev.js",
  "@solidjs/signals": "/solid/signals/dist/dev.js",
  "@solidjs/signals/attribution": "/solid/signals/dist/dev.attribution.js",
  "@reactivescript/runtime": "/runtime/web.dev.js",
};
const HARNESS = `<!doctype html><meta charset="utf-8"><title>rx scenarios</title>
<script type="importmap">${JSON.stringify({ imports: IMPORTS })}</script>
<div id="app"></div>
<script type="module">
import { flush } from "solid-js";
import { createApp } from "@reactivescript/runtime";
import { register, attach } from "/rx-map/live.mjs";
const root = document.getElementById("app");
const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { await tick(); flush(); await tick(); flush(); };
const messages = [];
let app, dispose = () => {};
// The frame (scenarios/TEMPLATE.md): the root's text, then its portals' (RG-8), as ref/compile/rt.ts's frame()
const frame = () => {
  let portals = "";
  for (const c of document.body.childNodes) if (c !== root && !["SCRIPT", "TEMPLATE", "STYLE"].includes(c.tagName)) portals += c.textContent ?? "";
  const page = root.textContent ?? "";
  return portals.trim() ? page + " » " + portals : page;
};
const errText = e => (e && e.message) || String(e);
window.__rx = {
  async start(graph, module) {
    register(graph);
    attach(m => messages.push(m));
    const main = (await import(module)).default;
    app = createApp({ root, scenarioFlights: true });
    dispose = app.mount(main(app));
  },
  async step(s) {
    const logBefore = s.kind === "mount" ? 0 : app.log.length;
    try {
      if (s.kind === "mount") { flush(); await settle(); }
      else if (s.kind === "handler") { new Function("__rt", "__B", s.code)(app, app.B); flush(); await settle(); }
      else {
        const value = new Function("__rt", "__B", s.value)(app, app.B);
        const key = /^".*"$/.test(s.key) ? s.key.slice(1, -1) : app.lastKey.get(s.key);
        if (key === undefined) throw new Error(s.key + " has no flight");
        const f = app.flights.get(key);
        if (!f) throw new Error("no flight " + key + " (flights: " + [...app.flights.keys()].join(", ") + ")");
        if (s.kind === "reject") f.reject(value instanceof Error ? value : new Error(String(value))); else f.resolve(value);
        await settle();
      }
    } catch (e) { return { threw: errText(e) }; }
    let asyncError;
    if (app.asyncError) { const e = app.asyncError; app.asyncError = null; if (s.kind !== "reject" && !e.panic) asyncError = errText(e); }
    return { frame: frame(), effects: app.log.slice(logBefore), asyncError };
  },
  async finish() {
    await settle(); await new Promise(r => setTimeout(r, 20));
    try { dispose(); } catch {}
    await tick();
    return messages.splice(0);
  },
};
window.__rxReady = true;
</script>`;

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html" };
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x").pathname;
  const send = (body, type) => res.writeHead(200, { "content-type": type, "cache-control": "no-store" }).end(body);
  if (url === "/" || url === "/h.html") return send(HARNESS, TYPES[".html"]);
  if (served.has(url)) return send(served.get(url), TYPES[".js"]);
  if (url === "/runtime/web.dev.js") return send(readFileSync(runtimeDev), TYPES[".js"]);
  const [root, p] = url.startsWith("/solid/") ? [solidPkgs, url.slice(7)] : url.startsWith("/rx-map/") ? [here, url.slice(8)] : [null, null];
  const file = root && path.resolve(root, p);
  if (!file || !file.startsWith(root + path.sep) || !existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end();
  send(readFileSync(file), TYPES[path.extname(file)] ?? "application/octet-stream");
});

// ---- run ------------------------------------------------------------------------------------------------------------
const runnable = tables.filter(t => t.module);
if (runnable.length) {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = loadPlaywright();
  const launch = async () => {
    try { return await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) }); }
    catch (e) {
      const base = path.join(homedir(), ".cache/ms-playwright");
      const dir = existsSync(base) && readdirSync(base).filter(d => d.startsWith("chromium_headless_shell")).sort().pop();
      if (!dir) throw e;
      return chromium.launch({ headless: true, executablePath: path.join(base, dir, "chrome-headless-shell-linux64/chrome-headless-shell") });
    }
  };
  const browser = await launch();
  try {
    for (const t of runnable) {
      const page = await browser.newPage();
      const pageErrors = [];
      page.on("pageerror", e => pageErrors.push(e.message));
      try {
        await page.goto(`${origin}/h.html`);
        await page.waitForFunction(() => window.__rxReady === true, null, { timeout: 15000 });
        await page.evaluate(([g, m]) => window.__rx.start(g, m), [graphs.get(t.entry), t.module]);
        for (const s of t.chains) {
          const got = await page.evaluate(step => window.__rx.step(step), s);
          if (got.threw) { t.status = "fail"; t.lines.push(`  ✗ ${t.t.title} instant ${s.instant}: ${got.threw}`); break; }
          if (got.asyncError) { t.status = "fail"; t.lines.push(`  ✗ ${t.t.title} instant ${s.instant}: action: ${got.asyncError}`); break; }
          const frame = norm(got.frame);
          const effOk = s.prefixed || got.effects.join("; ") === s.effects.join("; ");
          const eff = got.effects.length ? `  [${got.effects.join("; ")}]` : "";
          if (frame === s.frame && effOk) t.lines.push(`  ${s.divergent ? "≠" : "✓"} ${t.t.title} instant ${s.instant}: ${frame}${eff}`);
          else { t.status = "fail"; t.lines.push(`  ✗ ${t.t.title} instant ${s.instant}: expected '${s.frame}' effects [${s.effects.join("; ")}], got '${frame}' effects [${got.effects.join("; ")}]`); }
        }
        t.messages = await page.evaluate(() => window.__rx.finish());
      } catch (e) {
        t.status = "fail"; t.lines.push(`  ✗ ${t.t.title}: ${e.message.split("\n")[0]}`);
        try { t.messages = await page.evaluate(() => window.__rx?.finish() ?? []); } catch {}
      }
      if (pageErrors.length && t.status === "fail") t.lines.push(`    (page: ${pageErrors.join(" | ")})`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

// ---- results --------------------------------------------------------------------------------------------------------
const out = [];
const bySc = new Map();
for (const t of tables) (bySc.get(t.sc.name) ?? bySc.set(t.sc.name, []).get(t.sc.name)).push(t);
for (const [name, ts] of bySc) {
  const status = ts.some(t => t.status === "fail") ? "FAIL" : ts.every(t => t.status === "skip") ? "SKIP" : "PASS";
  out.push(`${status} ${name}${ts.length > 1 ? ` (${ts.map(t => `${t.t.title}: ${t.status}`).join(", ")})` : ""}`);
  if (!quiet) out.push(...ts.flatMap(t => t.lines));
  else out.push(...ts.flatMap(t => t.lines.filter(l => /^\s*[✗~]/.test(l))));
}
const count = s => tables.filter(t => t.status === s).length;
const summary = `${count("pass")} table(s) pass, ${count("fail")} fail, ${count("skip")} skip, of ${scenarios.length} scenario(s) over examples/`;
console.log(out.join("\n") + `\n\n${summary}`);

// ---- coverage -------------------------------------------------------------------------------------------------------
if (process.env.RX_SCENARIO_DUMP) writeFileSync(process.env.RX_SCENARIO_DUMP, JSON.stringify(tables.map(t => ({ name: t.name, messages: t.messages }))));
const coverage = await import("./coverage.mjs").catch(e => { if (coverageOut || flag("--report") || flag("--update") || flag("--check")) throw e; return null; });
if (coverage) {
  const c = coverage.createCollector({ graphs: [...graphs.values()], tool: TOOL });
  for (const t of tables) {
    if (!t.module) continue;
    c.begin(t.name);
    for (const m of t.messages) c.feed(m);
    c.end({ failed: t.status === "fail" });
  }
  const file = c.result();
  if (coverageOut) {
    mkdirSync(path.dirname(path.resolve(coverageOut)), { recursive: true });
    writeFileSync(coverageOut, JSON.stringify(file, null, 2) + "\n");
    console.log(`coverage: ${coverageOut} (${Object.keys(file.hits).length} of ${Object.keys(file.paths).length} paths hit)`);
  }
  const text = reportText(coverage, file);
  if (flag("--report")) console.log("\n" + text);
  const fixtureText = `# RX's scenario coverage of examples/: node tooling/rx-map/scenarios.mjs --update\n# ${summary}\n${
    tables.map(t => `# ${t.status.padEnd(4)} ${t.name}`).join("\n")}\n\n${text.trimEnd()}\n`;
  if (flag("--update")) {
    if (filter) { console.error("scenarios: --update runs every scenario (no filter)"); process.exit(2); }
    writeFileSync(fixture, fixtureText);
    console.log(`wrote ${rel(fixture)}`);
  }
  if (flag("--check")) {
    if (filter) { console.error("scenarios: --check runs every scenario (no filter)"); process.exit(2); }
    const now = existsSync(fixture) ? readFileSync(fixture, "utf8") : "";
    if (now !== fixtureText) { console.error(`${rel(fixture)} is stale: run node tooling/rx-map/scenarios.mjs --update`); process.exit(1); }
    console.log(`${rel(fixture)} is up to date`);
  }
}
process.exit(count("fail") ? 1 : 0);

function reportText(coverage, file) {
  const r = coverage.report(file);
  return typeof r === "string" ? r : r.text ?? String(r);
}
