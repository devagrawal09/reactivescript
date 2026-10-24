// Usage: node --experimental-strip-types ref/compile/build.ts file.rx [--api path.mjs]
// Checks and compiles a .rx app for the browser into ref/compile/.out/web/<name>/ (index.html and one bundled app.js):
// views through Solid's compiler, rt-web.ts, and Solid's DOM build. Serve that directory and open it.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { loadModules } from "../src/modules.ts";
import { checkModules } from "../src/check.ts";
import { compileModules } from "./emit.ts";
import { lowerViews } from "./jsx.ts";

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith("--"))!;
const apiAt = args.indexOf("--api"); const api = apiAt >= 0 ? args[apiAt + 1] : resolve(fileURLToPath(new URL("../../examples/api.mjs", import.meta.url)));
const name = basename(file) === "main.rx" ? basename(dirname(resolve(file))) : basename(file).replace(/\.rx$/, "");   // examples/shop/main.rx → shop
const set = loadModules(resolve(file), p => existsSync(p) ? readFileSync(p, "utf8") : undefined);   // 09: the entry and every .rx module it imports
const { diags } = checkModules(set);
if (diags.length) { for (const d of diags) console.error(`${d.file ?? file}:${d.line}: error ${d.code} [${d.rule}] ${d.msg}`); process.exit(1); }
const out = fileURLToPath(new URL(`./.out/web/${name}/`, import.meta.url)); mkdirSync(out, { recursive: true });
const compiled = compileModules(set);
const src = out + "src/"; mkdirSync(src, { recursive: true });
for (const [n, js] of lowerViews(compiled.files, "dom")) writeFileSync(src + n, js);   // Solid's compiler lowers the views (compile/jsx.ts)
copyFileSync(api, src + "api.mjs");
writeFileSync(src + "entry.mjs", `import { createApp } from ${JSON.stringify(fileURLToPath(new URL("./rt-web.ts", import.meta.url)))};
import main from "./${compiled.entry}";
import * as api from "./api.mjs";
const app = createApp({ root: document.getElementById("app"), api });
app.mount(main(app));
window.__app = app;
`);
// one bundle: the program, rt-web.ts and Solid's DOM build (from the next branch, ../SOLID_NEXT)
buildSync({ entryPoints: [src + "entry.mjs"], bundle: true, outfile: out + "app.js", format: "esm", platform: "browser", conditions: ["browser", "development"], tsconfigRaw: "{}", logLevel: "warning" });
writeFileSync(out + "index.html", `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><title>${name}.rx</title>
<style>body{font:15px system-ui,sans-serif;margin:24px;max-width:640px} .done{text-decoration:line-through;color:#888} .dim{opacity:.5} .selected{font-weight:bold} button{margin:2px}</style>
</head><body><div id="app"></div><script type="module" src="./app.js"></script></body></html>
`);
console.log(`built ${out}`);
