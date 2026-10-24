// Usage: node --experimental-strip-types ref/compile/build.ts file.rx [--api path.mjs]
// Checks and compiles a .rx app for the browser into ref/compile/.out/web/<name>/ (index.html, app.mjs, rt.mjs, api.mjs).
// Serve the ref/ directory (it resolves the Solid packages from ref/node_modules): open /compile/.out/web/<name>/.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";
import { loadModules } from "../src/modules.ts";
import { checkModules } from "../src/check.ts";
import { compileModules } from "./emit.ts";

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith("--"))!;
const apiAt = args.indexOf("--api"); const api = apiAt >= 0 ? args[apiAt + 1] : resolve(fileURLToPath(new URL("../../examples/api.mjs", import.meta.url)));
const name = basename(file) === "main.rx" ? basename(dirname(resolve(file))) : basename(file).replace(/\.rx$/, "");   // examples/shop/main.rx → shop
const set = loadModules(resolve(file), p => existsSync(p) ? readFileSync(p, "utf8") : undefined);   // 09: the entry and every .rx module it imports
const { diags } = checkModules(set);
if (diags.length) { for (const d of diags) console.error(`${d.file ?? file}:${d.line}: error ${d.code} [${d.rule}] ${d.msg}`); process.exit(1); }
const out = fileURLToPath(new URL(`./.out/web/${name}/`, import.meta.url)); mkdirSync(out, { recursive: true });
const compiled = compileModules(set);
for (const [n, js] of compiled.files) writeFileSync(out + (n === compiled.entry ? "app.mjs" : n), js.replace('from "./main.mjs"', 'from "./app.mjs"'));
writeFileSync(out + "rt.mjs", stripTypeScriptTypes(readFileSync(fileURLToPath(new URL("./rt.ts", import.meta.url)), "utf8")));
copyFileSync(api, out + "api.mjs");
const nm = "/node_modules/";
writeFileSync(out + "index.html", `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><title>${name}.rx</title>
<script type="importmap">${JSON.stringify({ imports: {
  "@solidjs/signals": `${nm}@solidjs/signals/dist/dev.js`, "@solidjs/signals/attribution": `${nm}@solidjs/signals/dist/dev.attribution.js`,
  "@solidjs/universal": `${nm}@solidjs/universal/dist/universal.dev.js`,
  "solid-js": `${nm}solid-js/dist/solid.dev.js`, "solid-js/internal": `${nm}solid-js/dist/internal.js`, "solid-js/attribution": `${nm}solid-js/dist/attribution.js`,
} }, null, 1)}</script>
<style>body{font:15px system-ui,sans-serif;margin:24px;max-width:640px} .done{text-decoration:line-through;color:#888} .dim{opacity:.5} .selected{font-weight:bold} button{margin:2px}</style>
</head><body><div id="app"></div>
<script type="module">
import { createApp, domNodes } from "./rt.mjs";
import main from "./app.mjs";
import * as api from "./api.mjs";
const root = document.getElementById("app");
const app = createApp({ nodes: domNodes(document), root, api });
app.mount(main(app));
window.__app = app;
</script></body></html>
`);
console.log(`built ${out}`);
