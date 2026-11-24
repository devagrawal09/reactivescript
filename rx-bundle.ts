// node --experimental-strip-types rx-bundle.ts <rx-worktree> <file.rx>
// A production browser bundle of an .rx app (the worktree's own compiler, rt-web.ts, Solid's DOM build), minified; prints sizes.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, basename } from "node:path";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { createRequire } from "node:module";
const [wt, file] = process.argv.slice(2);
const ref = (p: string) => import(pathToFileURL(`${wt}/ref/${p}`).href);
const { loadModules } = await ref("src/modules.ts"); const { checkModules } = await ref("src/check.ts");
const { compileModules } = await ref("compile/emit.ts"); const { lowerViews } = await ref("compile/jsx.ts");
const { buildSync } = createRequire(`${wt}/ref/package.json`)("esbuild");
const set = loadModules(resolve(file), (p: string) => existsSync(p) ? readFileSync(p, "utf8") : undefined);
const { diags } = checkModules(set); if (diags.length) { console.error(diags); process.exit(1); }
const compiled = compileModules(set);
const out = `${wt}/ref/compile/.out/bundle-${basename(file)}/`; mkdirSync(out, { recursive: true });
for (const [n, js] of lowerViews(compiled.files, "dom")) writeFileSync(out + n, js);
writeFileSync(out + "api.mjs", `let id = 0;\nexport const buildRows = n => Array.from({ length: n }, () => ({ id: ++id, label: "row " + id, n: id }));\nexport const swapRows = rs => { const a = Array.from(rs); if (a.length > 3) { const t = a[1]; a[1] = a[a.length - 2]; a[a.length - 2] = t; } return a; };\nexport const buildDeep = n => Array.from({ length: n }, (_, i) => ({ id: i, a: { b: { c: "c" + i } } }));\nexport const save = t => new Promise(r => setTimeout(() => r(t), 100));\nexport const loadRows = p => new Promise(r => setTimeout(() => r(buildRows(10)), 100));\n`);
writeFileSync(out + "entry.mjs", `import { createApp } from ${JSON.stringify(`${wt}/ref/compile/rt-web.ts`)};\nimport main from "./${compiled.entry}";\nimport * as api from "./api.mjs";\nconst app = createApp({ root: document.getElementById("app"), api });\napp.mount(main(app));\n`);
const mode = process.argv[4] ?? "plain";   // plain | select (store-select build, all features) | manifest (store-select + the program's manifest)
const NAMES = ["accessors", "guards", "shallow", "families", "optimistic", "delete"];
const feats = (compiled as any).features;
const define: Record<string, string> = { "process.env.NODE_ENV": '"production"' };
if (mode === "manifest") { if (!feats) throw new Error("this worktree's compiler emits no manifest"); for (const n of NAMES) define[`__SOLID_STORE_${n.toUpperCase()}__`] = String(feats[n]); }
if (feats) { const on = mode !== "manifest"; define.__RX_STORES__ = String(on || feats.stores); define.__RX_FAMILIES__ = String(on || feats.families); define.__RX_OPTIMISTIC__ = String(on || feats.optimistic); }
const conditions = mode === "plain" ? ["browser"] : ["store-select", "browser"];
const r1 = buildSync({ entryPoints: [out + "entry.mjs"], bundle: true, write: false, format: "esm", platform: "browser", conditions, minify: true, treeShaking: true, tsconfigRaw: "{}", logLevel: "warning", define });
// a second pass over the bundle drops what folded arms left unused (every mode, so the numbers compare)
writeFileSync(out + "pass1.js", r1.outputFiles[0].contents);
const r = buildSync({ entryPoints: [out + "pass1.js"], bundle: true, write: false, format: "esm", platform: "browser", minify: true, treeShaking: true, logLevel: "warning" });
const code = r.outputFiles[0].contents;
console.log(JSON.stringify({ wt: basename(wt), file: basename(file), mode, kept: feats && mode === "manifest" ? ["stores", ...NAMES].filter(n => feats[n]).join(",") || "none" : "all", min: code.length, gzip: gzipSync(code, { level: 9 }).length, brotli: brotliCompressSync(code).length }));
