// The prototype end to end: each example app built by Vite with vite-plugin-rx and @solidjs/vite-plugin, then driven in
// Chromium — and the todo app again under the dev server. Vite, solid-js and @solidjs/web come from the solid-next
// checkout (ref/SOLID_NEXT), as ref/ takes Solid. Solid's plugin needs the `frontends` option (solid-vite-plugin PR,
// see README): SOLID_VITE_PLUGIN names a built checkout of it, else the one pnpm installed in solid-next.
// Usage: SOLID_VITE_PLUGIN=../solid-vite-plugin node vite-plugin-rx/test.mjs [filter]
import { readdirSync, mkdirSync, rmSync, symlinkSync, writeFileSync, cpSync, readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import rx from "./index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const store = path.resolve(repo, "../solid-next/node_modules/.pnpm");
const installed = path.join(store, readdirSync(store).filter(d => d.startsWith("@solidjs+vite-plugin@")).sort().pop(), "node_modules/@solidjs/vite-plugin");
const pluginDir = process.env.SOLID_VITE_PLUGIN ? path.resolve(process.env.SOLID_VITE_PLUGIN) : installed;
const deps = path.resolve(installed, "../..");   // the installed plugin's node_modules: vite, solid-js, @solidjs/web
const vite = await import(pathToFileURL(path.join(deps, "vite/dist/node/index.js")).href);
const solid = (await import(pathToFileURL(path.join(pluginDir, "dist/esm/index.mjs")).href)).default;
const { chromium } = createRequire(import.meta.url)("playwright");
const rtWeb = path.join(repo, "ref/compile/rt-web.ts");

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
  symlinkSync(deps, path.join(dir, "node_modules"));
  cpSync(path.join(repo, "examples"), path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "src/entry.js"), `import { createApp } from ${JSON.stringify(rtWeb)};\nimport main from "./${entry}";\nimport * as api from "./api.mjs";\nconst app = createApp({ root: document.getElementById("app"), api });\napp.mount(main(app));\n`);
  writeFileSync(path.join(dir, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title></head><body><div id="app"></div><script type="module" src="/src/entry.js"></script></body></html>\n`);
  return dir;
}
const config = (dir, entry) => ({
  root: dir, configFile: false, logLevel: "warn", clearScreen: false,
  plugins: [solid({ frontends: { ".rx": rx() } })],
  server: { fs: { allow: [repo, path.dirname(deps), path.resolve(repo, "../solid-next"), pluginDir] } },
  build: { outDir: "dist", sourcemap: true, emptyOutDir: true },
});

const browser = await chromium.launch();
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
  const dist = path.join(dir, "dist");
  const http = createServer((req, res) => { const f = path.join(dist, req.url === "/" ? "index.html" : req.url.split("?")[0]); if (!existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : "text/html"); res.end(readFileSync(f)); });
  await new Promise(r => http.listen(0, "127.0.0.1", r));
  await drive(`${name} (build)`, `http://127.0.0.1:${http.address().port}/`, name === "todo" ? todo : undefined);
  http.close();
}
if (!filter || "shared".includes(filter)) {   // two programs on one page, sharing shop/catalog.rx: no entry option, one catalog module
  const dir = project("shared", "shop/main.rx");
  writeFileSync(path.join(dir, "src/shop/count.rx"), `import { products } from "./catalog.rx"\n\nexport default component Count() {\n  errored fallback(e) { <p>no catalogue</p> } {\n    <p>{len(products)} products</p>\n  }\n}\n`);
  writeFileSync(path.join(dir, "src/entry.js"), `import { createApp } from ${JSON.stringify(rtWeb)};\nimport shop from "./shop/main.rx";\nimport count from "./shop/count.rx";\nimport * as api from "./api.mjs";\nfor (const [main, el] of [[shop, "app"], [count, "app2"]]) { const app = createApp({ root: document.getElementById(el), api }); app.mount(main(app)); }\n`);
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
if (!filter || "todo".includes(filter)) {   // the dev server: modules transformed on request
  const dir = project("todo-dev", "todo.rx");
  const server = await vite.createServer(config(dir, "todo.rx")); await server.listen(0);
  await drive("todo (dev)", `http://127.0.0.1:${server.httpServer.address().port}/`, todo);
  await server.close();
}
await browser.close();
console.log(`\n${pass} pass, ${fail} fail (vite ${vite.version}, @solidjs/vite-plugin ${JSON.parse(readFileSync(path.join(pluginDir, "package.json"), "utf8")).version})`);
process.exit(fail ? 1 : 0);
