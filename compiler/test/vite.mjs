// `.rx` in Vite end to end: each example app built by Vite with plain `solid()` from @solidjs/vite-plugin, which finds
// this package (`@reactivescript/compiler/vite`) in the project, then driven in Chromium; and the todo app again under
// the dev server. Vite, solid-js and @solidjs/web come from the solid-next checkout (ref/SOLID_NEXT), as ref/ takes
// Solid. Solid's plugin needs built-in `.rx` (solid-vite-plugin PR, see README): SOLID_VITE_PLUGIN names a built
// checkout of it, else the one pnpm installed in solid-next. The Node-API build first: `npm run build` here,
// and the runtime's: `npm run build` in ../runtime.
// Usage: SOLID_VITE_PLUGIN=../solid-vite-plugin node compiler/test/vite.mjs [filter]
// e.g. SOLID_VITE_PLUGIN=$(realpath ../rx-r4-mcp/node_modules/@solidjs/vite-plugin) NODE_PATH=<playwright's node_modules>:$PWD/ref/node_modules
//      node compiler/test/vite.mjs ts-module
import { readdirSync, mkdirSync, rmSync, symlinkSync, writeFileSync, cpSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const repo = path.resolve(pkg, "..");
const store = path.resolve(repo, "../solid-next/node_modules/.pnpm");
const installed = path.join(store, readdirSync(store).filter(d => d.startsWith("@solidjs+vite-plugin@")).sort().pop(), "node_modules/@solidjs/vite-plugin");
const pluginDir = process.env.SOLID_VITE_PLUGIN ? path.resolve(process.env.SOLID_VITE_PLUGIN) : installed;
const deps = process.env.SOLID_VITE_DEPS ? path.resolve(process.env.SOLID_VITE_DEPS) : path.resolve(installed, "../..");
const vite = await import(pathToFileURL(path.join(deps, "vite/dist/node/index.js")).href);
const solid = (await import(pathToFileURL(path.join(pluginDir, "dist/esm/index.mjs")).href)).default;
const { chromium } = createRequire(import.meta.url)("playwright");
const runtime = path.join(repo, "runtime");   // @reactivescript/runtime, built (`npm run build` there)
const { app: compile } = createRequire(import.meta.url)("../index.js");
const { build: esbuild } = createRequire(path.join(runtime, "package.json"))("esbuild");
const instrumentation = /__RX_|rx:|MISSING_TEST_API|jsError|actionCaught|@reactivescript\/map/;

// notes/ calls server functions: with no server behind the static build, it shows its own error boundary
const apps = {
  todo: "todo.rx", cart: "cart.rx", signup: "signup.rx", users: "users.rx", shop: "shop/main.rx", notes: "notes/main.rx",
  "ai-feed": "ai/feed.rx", "ai-grid": "ai/grid.rx", "ai-wizard": "ai/wizard.rx",
  "ai2-search": "ai2/search/main.rx", "ai2-settings": "ai2/settings/main.rx", "ai2-tracker": "ai2/tracker/main.rx",
};
const filter = process.argv[2];
const out = path.join(here, ".out"); mkdirSync(out, { recursive: true });

/** A Vite project around an example: its sources, a page, an entry that mounts the program over rt-web.ts. */
function project(name, entry) {
  const dir = path.join(out, name); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  // the project's node_modules: the plugin's (vite, solid-js, @solidjs/web) and this package, installed
  const nm = path.join(dir, "node_modules"); mkdirSync(path.join(nm, "@reactivescript"), { recursive: true });
  for (const d of readdirSync(deps)) {
    if (d === "@reactivescript") continue;
    if (!d.startsWith("@")) { symlinkSync(path.join(deps, d), path.join(nm, d)); continue; }
    mkdirSync(path.join(nm, d), { recursive: true });
    for (const e of readdirSync(path.join(deps, d))) symlinkSync(path.join(deps, d, e), path.join(nm, d, e));
  }
  // the runtime's peers: solid-js and @solidjs/web are the plugin's; @solidjs/signals the one that solid-js runs on
  if (!existsSync(path.join(nm, "@solidjs/signals"))) symlinkSync(realpathSync(path.join(deps, "solid-js/node_modules/@solidjs/signals")), path.join(nm, "@solidjs/signals"));
  symlinkSync(pkg, path.join(nm, "@reactivescript/compiler"));
  // the runtime as installed: copied, so that it takes the project's Solid (a peer), not its own dev copy
  for (const f of ["package.json", "dist"]) cpSync(path.join(runtime, f), path.join(nm, "@reactivescript/runtime", f), { recursive: true });
  cpSync(path.join(repo, "examples"), path.join(dir, "src"), { recursive: true });
  // The notes scenarios inject a synthetic error class. A packaged app
  // resolves the real JS API next to its .d.rx instead.
  if (name === "notes") writeFileSync(path.join(dir, "src/notes/api.js"), `
export class Conflict extends Error {}
export async function dbNotes() { return []; }
export async function dbNote() { return null; }
export async function dbSave() { throw new Conflict("not available in the browser fixture"); }
export async function viewport() { return window.innerWidth; }
`);
  writeFileSync(path.join(dir, "src/entry.js"), `import { createApp } from "@reactivescript/runtime";\nimport main from "./${entry}";\nimport * as api from "./demo-api.mjs";\nconst app = createApp({ root: document.getElementById("app"), api });\napp.mount(main(app));\n`);
  writeFileSync(path.join(dir, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title></head><body><div id="app"></div><script type="module" src="/src/entry.js"></script></body></html>\n`);
  return dir;
}
const config = (dir, entry) => ({
  root: dir, configFile: false, logLevel: "warn", clearScreen: false,
  plugins: [solid()],
  resolve: { dedupe: ["solid-js", "@solidjs/web", "@solidjs/signals"] },
  server: { fs: { allow: [repo, path.dirname(deps), path.resolve(repo, "../solid-next"), pluginDir] } },
  build: { outDir: "dist", sourcemap: true, emptyOutDir: true },
});

const browser = await chromium.launch({ executablePath: process.env.CHROME });
let pass = 0, fail = 0;
async function drive(name, url, check) {
  const page = await browser.newPage(); const errors = [];
  page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  try {
    await page.goto(url); await page.waitForTimeout(900);
    const text = (await page.textContent("#app"))?.replace(/\s+/g, " ").trim() ?? "";
    if (!text) throw new Error("nothing rendered");
    if (check) await check(page);
    if (errors.length) throw new Error(errors.join(" | "));
    pass++; console.log(`✓ ${name}: ${text.slice(0, 90)}`);
  } catch (e) { fail++; console.log(`✗ ${name}: ${e.message}`); }
  finally { await page.close(); }
}
const todo = async page => {
  await page.fill("input[placeholder]", "milk"); await page.click("text=Add"); await page.waitForTimeout(100);
  const t1 = await page.textContent("#app"); if (!t1.includes("milk") || !t1.includes("1 left")) throw new Error(`after add: ${t1}`);
  await page.click("input[type=checkbox]"); await page.waitForTimeout(100);
  const t2 = await page.textContent("#app"); if (!t2.includes("0 left")) throw new Error(`after toggle: ${t2}`);
};

for (const [name, entry] of Object.entries(apps)) {
  if (filter && !name.includes(filter)) continue;
  const dir = project(name, entry);
  try { await vite.build(config(dir, entry)); }
  catch (e) { fail++; console.log(`✗ ${name}: build: ${e.message.split("\n")[0]}`); continue; }
  // CP-1c: the bundle's map reaches the .rx sources
  const maps = readdirSync(path.join(dir, "dist/assets")).filter(f => f.endsWith(".js.map"));
  const sources = maps.flatMap(f => JSON.parse(readFileSync(path.join(dir, "dist/assets", f), "utf8")).sources);
  if (!sources.some(s => s.endsWith(".rx"))) { fail++; console.log(`✗ ${name}: the bundle's source map names no .rx file`); continue; }
  // 11 CP-4b `key` is dev only: a production bundle names no node
  const js = readdirSync(path.join(dir, "dist/assets")).filter(f => f.endsWith(".js")).map(f => readFileSync(path.join(dir, "dist/assets", f), "utf8")).join("\n");
  if (instrumentation.test(js)) { fail++; console.log(`✗ ${name}: the Vite production bundle has ${js.match(instrumentation)[0]}`); continue; }
  const dist = path.join(dir, "dist");
  const http = createServer((req, res) => { const f = path.join(dist, req.url === "/" ? "index.html" : req.url.split("?")[0]); if (!existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : "text/html"); res.end(readFileSync(f)); });
  await new Promise(r => http.listen(0, "127.0.0.1", r));
  await drive(`${name} (build)`, `http://127.0.0.1:${http.address().port}/`, name === "todo" ? todo : undefined);
  http.close();
}
if (!filter || "todo".includes(filter) || "esbuild".includes(filter)) {
  const dir = project("esbuild-prod", "todo.rx");
  try {
    const out = JSON.parse(compile(path.join(dir, "src/todo.rx"), "dom", "@solidjs/web", true));
    writeFileSync(path.join(dir, "src/todo.mjs"), Object.values(out.modules)[0].code);
    writeFileSync(path.join(dir, "src/esbuild-entry.js"), `import { createApp } from "@reactivescript/runtime";\nimport main from "./todo.mjs";\nconst app = createApp({root: document.body});\napp.mount(main(app));\n`);
    const result = await esbuild({ absWorkingDir: dir, entryPoints: ["src/esbuild-entry.js"], bundle: true,
      conditions: ["production"], platform: "browser", minify: true, write: false });
    const leaked = result.outputFiles[0].text.match(instrumentation);
    if (leaked) throw new Error(`found ${leaked[0]}`);
    pass++; console.log("✓ esbuild (production): no dev registry, names or harness");
  } catch (e) { fail++; console.log(`✗ esbuild (production): ${e.message}`); }
}
if (!filter || "shared".includes(filter)) {   // two programs on one page, sharing shop/catalog.rx: no entry option, one catalog module
  const dir = project("shared", "shop/main.rx");
  writeFileSync(path.join(dir, "src/shop/count.rx"), `import { products } from "./catalog.rx"\n\nexport default component Count() {\n  errored fallback(e) { <p>no catalogue</p> } {\n    <p>{len(products)} products</p>\n  }\n}\n`);
  writeFileSync(path.join(dir, "src/entry.js"), `import { createApp } from "@reactivescript/runtime";\nimport shop from "./shop/main.rx";\nimport count from "./shop/count.rx";\nimport * as api from "./demo-api.mjs";\nfor (const [main, el] of [[shop, "app"], [count, "app2"]]) { const app = createApp({ root: document.getElementById(el), api }); app.mount(main(app)); }\n`);
  writeFileSync(path.join(dir, "index.html"), readFileSync(path.join(dir, "index.html"), "utf8").replace('<div id="app"></div>', '<div id="app"></div><div id="app2"></div>'));
  try {
    const bundle = await vite.build(config(dir, "shop/main.rx"));
    const ids = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(b => b.output.flatMap(o => Object.keys(o.modules ?? {})));
    const catalogs = ids.filter(m => m.includes("catalog.rx"));
    if (catalogs.length !== 1) throw new Error(`catalog.rx bundled as ${JSON.stringify(catalogs)}`);
    const dist = path.join(dir, "dist");
    const http = createServer((req, res) => { const f = path.join(dist, req.url === "/" ? "index.html" : req.url.split("?")[0]); if (!existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : "text/html"); res.end(readFileSync(f)); });
    await new Promise(r => http.listen(0, "127.0.0.1", r));
    await drive("shared (build)", `http://127.0.0.1:${http.address().port}/`, async page => {
      const t = await page.textContent("#app2"); if (!/3 products/.test(t)) throw new Error(`second program: ${t}`);
    });
    http.close();
  } catch (e) { fail++; console.log(`✗ shared: ${e.message.split("\n").slice(0, 6).join(" | ")}`); }
}
if (!filter || "ts-module".includes(filter)) {   // 09 MO-11: an .rx program over a .ts with no .d.rx — its declaration generated in process
  const dir = project("ts-module", "dts/main.rx");
  const src = path.join(dir, "src/dts"); mkdirSync(src);
  // the helpers package (@reactivescript/js), as a project installs it: the repository's
  symlinkSync(path.join(repo, "js"), path.join(dir, "node_modules/@reactivescript/js"), "dir");
  writeFileSync(path.join(src, "api.ts"), `import { pure, rejects } from "@reactivescript/js";
export class NotFound extends Error {}
export type User = { id: number; name: string };
export const fetchUser = pure(rejects([NotFound], async (id: number): Promise<User> => {
  if (id === 2) throw new NotFound("no user 2");
  return { id, name: "Ann" };
}));
export const greeting = pure((name: string) => "hi " + name);
`);
  // \`User\` is a type: it must not reach the emitted import (MO-8d), or the bundler finds no such export in api.ts.
  // Both functions state purity in the TS module. Adding a row to its import fails with the helper fix.
  writeFileSync(path.join(src, "main.rx"), `import { fetchUser, NotFound, User } from "./api"
import pure { greeting } from "./api"
export default component Main() {
  source id := 1
  user: User | null = await fetchUser(id) catch (e: NotFound) => null
  <main>
    <button onClick={() => { id := 2 }}>next</button>
    {loading fallback { <p>loading…</p> } {
      <p>{user == null ? "nobody" : greeting(user.name)}</p>
    }}
  </main>
}
`);
  try {
    const file = path.join(src, "main.rx");
    const source = readFileSync(file, "utf8");
    const rejected = await vite.build(config(dir, "dts/main.rx")).then(() => "", e => e.message);
    if (!/error IMPORT_ROW_ON_TS \[MO-11e\].*remove `pure`/.test(rejected)) throw new Error(`expected import row error: ${rejected}`);
    writeFileSync(file, source.replace("import pure { greeting }", "import { greeting }"));
    await vite.build(config(dir, "dts/main.rx"));
    const dist = path.join(dir, "dist");
    const http = createServer((req, res) => { const f = path.join(dist, req.url === "/" ? "index.html" : req.url.split("?")[0]); if (!existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : "text/html"); res.end(readFileSync(f)); });
    await new Promise(r => http.listen(0, "127.0.0.1", r));
    await drive("ts-module (build): a .ts with no .d.rx", `http://127.0.0.1:${http.address().port}/`, async page => {
      const t1 = await page.textContent("#app"); if (!t1.includes("hi Ann")) throw new Error(`first: ${t1}`);
      await page.click("text=next"); await page.waitForTimeout(200);
      const t2 = await page.textContent("#app"); if (!t2.includes("nobody")) throw new Error(`after NotFound: ${t2}`);
    });
    http.close();
  } catch (e) { fail++; console.log(`✗ ts-module: ${e.message.split("\n").slice(0, 6).join(" | ")}`); }
}
// Vite build() sets NODE_ENV for its first build in this process.
process.env.NODE_ENV = "development";
if (!filter || "todo".includes(filter)) {   // the dev server: modules transformed on request
  const dir = project("todo-dev", "todo.rx");
  const server = await vite.createServer(config(dir, "todo.rx")); await server.listen(0);
  await drive("todo (dev)", server.resolvedUrls.local[0], async page => {
    await todo(page);
    // 11 CP-4b `key`: the dev client runs each source's and equation's creating calls under its key
    const code = (await server.transformRequest("/src/todo.rx"))?.code ?? "";
    if (!code.includes('__rt.key("src/todo.rx||todos", () =>')) throw new Error("the dev build keys no declaration");
  });
  await server.close();
}
if (!filter || "ts-graph".includes(filter)) {   // 09 MO-11: generated declarations are no module: never a runtime import
  const dir = project("ts-graph", "tsg/main.rx");
  // round 5: an app with no .d.rx anywhere (the dev server once watched every candidate `x.d.rx` of a .ts import, and
  // Vite answered the entry with a 500 when none existed); the copied examples bring theirs, so take them out
  const dRx = d => readdirSync(d, { recursive: true }).filter(f => /\.d\.rx$/.test(f)).map(f => path.join(d, f));
  for (const f of dRx(path.join(dir, "src"))) rmSync(f);
  const src = path.join(dir, "src/tsg"); mkdirSync(src);
  symlinkSync(path.join(repo, "js"), path.join(dir, "node_modules/@reactivescript/js"), "dir");
  writeFileSync(path.join(src, "model.ts"), `import { pure } from "@reactivescript/js";
export type Item = { id: number; label: string };
export const describe = pure((item: Item) => item.id + ": " + item.label);
`);
  writeFileSync(path.join(src, "server.ts"), `import { pure } from "@reactivescript/js";
import type { Item } from "./model";
export const load = pure(async (id: number): Promise<Item> => ({ id, label: "first" }));
`);
  writeFileSync(path.join(src, "browser.ts"), `import { pure } from "@reactivescript/js";
export const shout = pure((s: string) => s.toUpperCase());
`);
  writeFileSync(path.join(src, "main.rx"), `import { describe, Item } from "./model"
import { load } from "./server"
import { shout } from "./browser"
export default component Main() {
  item: Item = await load(1)
  <main>
    {errored fallback(e) { <p>failed</p> } {
      {loading fallback { <p>loading…</p> } {
        <p>{shout(describe(item))}</p>
      }}
    }}
  </main>
}
`);
  const requested = [];
  const seen = new Set(), problems = [];
  const server = await vite.createServer({ ...config(dir, "tsg/main.rx"), plugins: [solid(), {
    name: "record-requests", configureServer(s) { s.middlewares.use((req, _res, next) => { requested.push(req.url); next(); }); },
  }] });
  await server.listen(0);
  try {
    if (dRx(path.join(dir, "src")).length) problems.push(`the fixture has ${dRx(path.join(dir, "src")).join(", ")}`);
    // the entry and the .rx module it imports, over HTTP, as the browser asks for them first: 200
    for (const u of ["", "src/entry.js", "src/tsg/main.rx"]) {
      const res = await fetch(new URL(u, server.resolvedUrls.local[0]));
      if (res.status !== 200) problems.push(`GET /${u}: ${res.status} ${(await res.text()).split("\n")[0].slice(0, 200)}`);
    }
    // what the browser does: transform the entry, then every URL import analysis put in its graph, transitively
    const env = server.environments.client;
    const walk = async url => {
      if (seen.has(url)) return; seen.add(url);
      if (/\.d\.rx(\?|$)/.test(url)) problems.push(`requested ${url}`);
      let r;
      try { r = await env.transformRequest(url); } catch (e) { problems.push(`${url}: ${e.message.split("\n")[0]}`); return; }
      if (!r) { problems.push(`${url}: not served`); return; }
      if (/\.d\.rx/.test(r.code)) problems.push(`${url} names a .d.rx: ${r.code.match(/.*\.d\.rx.*/)[0]}`);
      const mod = await env.moduleGraph.getModuleByUrl(url);
      for (const dep of mod?.importedModules ?? []) if (dep.url.includes("/src/")) await walk(dep.url);
    };
    await walk("/src/entry.js");
    for (const id of [...env.moduleGraph.idToModuleMap.keys()]) if (/\.d\.rx(\?|$)/.test(id)) problems.push(`module graph has ${id}`);
    await drive("ts-graph (dev): generated declarations are no import", server.resolvedUrls.local[0], async page => {
      const t = await page.textContent("#app"); if (!t.includes("1: FIRST")) throw new Error(`rendered: ${t}`);
    });
    for (const u of requested) if (/\.d\.rx(\?|$)/.test(u)) problems.push(`the browser requested ${u}`);
    if (problems.length) { fail++; console.log(`✗ ts-graph (dev): ${problems.join(" | ")}`); }
    else { pass++; console.log(`✓ ts-graph (dev): ${seen.size} modules served, no .d.rx requested`); }
  } finally { await server.close(); }
  try {
    process.env.NODE_ENV = "production";
    await vite.build(config(dir, "tsg/main.rx"));
    const js = readdirSync(path.join(dir, "dist/assets")).filter(f => f.endsWith(".js")).map(f => readFileSync(path.join(dir, "dist/assets", f), "utf8")).join("\n");
    if (/\.d\.rx/.test(js)) throw new Error(`the bundle names ${js.match(/[\w./-]*\.d\.rx/)[0]}`);
    pass++; console.log("✓ ts-graph (build): no .d.rx in the bundle");
  } catch (e) { fail++; console.log(`✗ ts-graph (build): ${e.message.split("\n")[0]}`); }
  finally { process.env.NODE_ENV = "development"; }
}
if (!filter || "hmr".includes(filter)) {
  const dir = project("hmr-without-map", "hot/main.rx");
  const src = path.join(dir, "src/hot");
  mkdirSync(src);
  const original = `import pure { seed } from "./sample.js"
import { sensor } from "./shared.rx"
import { Badge } from "./badge.rx"
export default component Main() {
  source counter := seed()
  <main>
    <button onClick={() => { counter := c => c + 1 }}>{counter}</button>
    <p>{sensor}</p>
    <Badge />
  </main>
}
`;
  writeFileSync(path.join(src, "main.rx"), original);
  writeFileSync(path.join(src, "shared.rx"), `import pure { sample } from "./sample.js"
export source sensor: number = sample()
`);
  writeFileSync(path.join(src, "sample.d.rx"), `export pure fn sample(): number\nexport pure fn seed(): number\n`);
  writeFileSync(path.join(src, "sample.js"), `export function sample() { return globalThis.samples = (globalThis.samples ?? 0) + 1; }
export function seed() { globalThis.seeds = (globalThis.seeds ?? 0) + 1; return 0; }\n`);
  const badge = path.join(src, "badge.rx");
  writeFileSync(badge, `export component Badge() { <span>old</span> }\n`);
  writeFileSync(path.join(dir, "src/entry.js"), `import { createApp } from "@reactivescript/runtime";
import main from "./hot/main.rx";
document.body.innerHTML = '<div id="app"></div><div id="app2"></div>';
for (const root of document.body.children) { const app = createApp({ root }); app.mount(main(app)); }
`);
  const server = await vite.createServer(config(dir, "hot/main.rx")); await server.listen(0);
  try {
    await drive("HMR without map: two app instances and an untouched shared module", server.resolvedUrls.local[0], async page => {
      await page.locator("#app button").click();
      await page.locator("#app2 button").click();
      await page.locator("#app2 button").click();
      const before = await page.evaluate(() => ({ samples: globalThis.samples, seeds: globalThis.seeds, sensors: [...document.querySelectorAll("main p")].map(el => el.textContent) }));
      writeFileSync(badge, `export component Badge() { <span>new badge</span> }\n`);
      await page.waitForFunction(() => document.querySelector("#app2 span")?.textContent === "new badge", null, { timeout: 8000 });
      const after = await page.evaluate(() => ({
        counters: [...document.querySelectorAll("main button")].map(el => el.textContent),
        samples: globalThis.samples, seeds: globalThis.seeds, sensors: [...document.querySelectorAll("main p")].map(el => el.textContent),
      }));
      if (JSON.stringify(after.counters) !== '["1","2"]' || after.samples !== before.samples || before.seeds !== 2 || after.seeds !== before.seeds ||
        JSON.stringify(after.sensors) !== JSON.stringify(before.sensors) || await page.evaluate(() => !!globalThis.__RX__))
        throw new Error(`incorrect carry: ${JSON.stringify({ before, after })}`);
    });
  } finally { await server.close(); }
}
if (!filter || "styles".includes(filter)) {   // CSS-4 under the dev server: a dependency's <style> edit reaches the page
  const dir = project("styles-dev", "styled/main.rx");
  mkdirSync(path.join(dir, "src/styled"));
  writeFileSync(path.join(dir, "src/styled/main.rx"), `import { Badge } from "./badge.rx"\n\nexport default component Main() {\n  <main><Badge /></main>\n}\n`);
  const badge = path.join(dir, "src/styled/badge.rx");
  const style = color => `export component Badge() {\n  <style>\n    .badge { color: ${color} }\n  </style>\n  <p class="badge">badge</p>\n}\n`;
  writeFileSync(badge, style("rgb(0, 0, 255)"));
  const server = await vite.createServer(config(dir, "styled/main.rx")); await server.listen(0);
  const url = server.resolvedUrls.local[0];
  const color = page => page.$eval(".badge", e => getComputedStyle(e).color);
  const until = async (page, want, what) => {
    for (let i = 0; i < 40 && await color(page).catch(() => "") !== want; i++) await page.waitForTimeout(100);
    const got = await color(page).catch(e => e.message.split("\n")[0]); if (got !== want) throw new Error(`${what}: color ${got}, not ${want}`);
  };
  await drive("styles (dev)", url, async page => {
    await until(page, "rgb(0, 0, 255)", "first load");
    writeFileSync(badge, style("rgb(255, 0, 0)"));
    await until(page, "rgb(255, 0, 0)", "after the edit");
    await page.reload(); await until(page, "rgb(255, 0, 0)", "after a reload");
    const fresh = await browser.newPage();
    try { await fresh.goto(url); await until(fresh, "rgb(255, 0, 0)", "in a new page"); } finally { await fresh.close(); }
  });
  await server.close();
}
if (!filter || "cold".includes(filter)) {   // a dependency asked for before its entry, as Vitest's `fsModuleCache` leaves it
  const { default: rx } = await import(pathToFileURL(path.join(pkg, "vite.mjs")).href);
  const root = project("cold", "shop/main.rx"), catalog = path.join(root, "src/shop/catalog.rx");
  const ctx = (id, moduleId) => ({ id, moduleId, root, ssr: false, solid: { generate: "dom", hydratable: false }, addWatchFile() {} });
  try {
    // a commented-out import is not an edge: read as one, it would make main.rx look imported and leave no entry
    writeFileSync(catalog, readFileSync(catalog, "utf8") + `\n// import { x } from "./main.rx"\n`);
    const warm = rx(); warm.compile("", ctx(path.join(root, "src/shop/main.rx"), path.join(root, "src/shop/main.rx")));
    const want = warm.compile("", ctx(catalog, `${catalog}?rx-dep`)).code;
    const got = rx().compile("", ctx(catalog, `${catalog}?rx-dep`)).code;
    if (got !== want) throw new Error("the dependency compiled cold differs from the one compiled after its entry");
    writeFileSync(catalog, readFileSync(catalog, "utf8") + "\nexport bad = missingName\n");
    let report = "";
    try { rx().compile("", ctx(catalog, `${catalog}?rx-dep`)); } catch (e) { report = e.message; }
    if (!/catalog\.rx:\d+(:\d+)?: error /.test(report)) throw new Error(`a cold dependency that does not compile reports ${JSON.stringify(report.slice(0, 200))}`);
    pass++; console.log("✓ cold dependency: compiled from the program that holds it, or that program's diagnostics");
  } catch (e) { fail++; console.log(`✗ cold dependency: ${e.message.split("\n")[0]}`); }
}
await browser.close();
console.log(`\n${pass} pass, ${fail} fail (vite ${vite.version}, @solidjs/vite-plugin ${JSON.parse(readFileSync(path.join(pluginDir, "package.json"), "utf8")).version})`);
process.exit(fail ? 1 : 0);
