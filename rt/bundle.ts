// node --experimental-strip-types rt/bundle.ts <rx-worktree> <app dir or file.rx> <mode> [--keep]
// A production browser bundle of an RX app with the worktree's own compiler and runtime. Modes:
//   plain     no switches (baseline, prototype A)
//   manifest  Solid's store-select build + the worktree's manifest defines, hydratable views (round 2's measure)
//   csr       the same without hydration (views lowered non-hydratable, the runtime's hydrate arm off) — worktrees whose
//             compile/features.ts `defines(features, { hydrate })` takes the option
//   csr-all   csr with every other switch on (what hydration alone costs)
// Prints one JSON line. --keep also writes the unminified bundle and esbuild's metafile beside the output.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { pathToFileURL } from "node:url"; import { resolve, basename, dirname, join } from "node:path";
import { gzipSync, brotliCompressSync } from "node:zlib"; import { createRequire } from "node:module";
const [wt, target, mode = "plain", ...flags] = process.argv.slice(2);
const file = target.endsWith(".rx") ? target : join(target, "main.rx"); const name = target.endsWith(".rx") ? basename(target, ".rx") : basename(resolve(target));
const ref = (p: string) => import(pathToFileURL(`${wt}/ref/${p}`).href);
const { loadModules } = await ref("src/modules.ts"); const { checkModules } = await ref("src/check.ts");
const { compileModules } = await ref("compile/emit.ts"); const { lowerViews } = await ref("compile/jsx.ts");
const F = existsSync(`${wt}/ref/compile/features.ts`) ? await ref("compile/features.ts") : null;
const { buildSync } = createRequire(`${wt}/ref/package.json`)("esbuild");
const set = loadModules(resolve(file), (p: string) => existsSync(p) ? readFileSync(p, "utf8") : undefined);
const { diags } = checkModules(set); if (diags.length) { console.error(diags); process.exit(1); }
const compiled = compileModules(set); const feats = (compiled as any).features;
const out = `${wt}/ref/compile/.out/rtbundle-${name}-${mode}/`; mkdirSync(out, { recursive: true });
const csr = mode.startsWith("csr");
for (const [n, js] of lowerViews(compiled.files, "dom", ...(csr ? [false] : []))) writeFileSync(out + n, js);
const api = join(dirname(resolve(file)), "api.mjs");
if (existsSync(api)) copyFileSync(api, out + "api.mjs");
else writeFileSync(out + "api.mjs", `let id = 0;\nexport const buildRows = n => Array.from({ length: n }, () => ({ id: ++id, label: "row " + id, n: id }));\nexport const swapRows = rs => { const a = Array.from(rs); if (a.length > 3) { const t = a[1]; a[1] = a[a.length - 2]; a[a.length - 2] = t; } return a; };\nexport const buildDeep = n => Array.from({ length: n }, (_, i) => ({ id: i, a: { b: { c: "c" + i } } }));\nexport const save = t => new Promise(r => setTimeout(() => r(t), 100));\nexport const loadRows = p => new Promise(r => setTimeout(() => r(buildRows(10)), 100));\n`);
writeFileSync(out + "entry.mjs", `import { createApp } from ${JSON.stringify(`${wt}/ref/compile/rt-web.ts`)};\nimport main from "./${compiled.entry}";\nimport * as api from "./api.mjs";\nconst app = createApp({ root: document.getElementById("app"), api });\napp.mount(main(app));\n`);
let define: Record<string, string> = {}; let conditions = ["browser"];
if (mode !== "plain") {
  if (!F) throw new Error("this worktree has no compile/features.ts");
  conditions = ["store-select", "browser"];
  define = mode === "csr-all" ? { ...F.defines(null), __RX_HYDRATE__: "false" } : F.defines(feats, { hydrate: !csr });
  if (typeof F.ALL_ON !== "function" && mode === "manifest") { define.__RX_STORES__ = String(feats.stores); define.__RX_FAMILIES__ = String(feats.families); define.__RX_OPTIMISTIC__ = String(feats.optimistic); }
}
define["process.env.NODE_ENV"] = '"production"';
const common = { bundle: true, write: false, format: "esm" as const, platform: "browser" as const, conditions, treeShaking: true, tsconfigRaw: "{}", logLevel: "warning" as const, define };
const r1 = buildSync({ ...common, entryPoints: [out + "entry.mjs"], minify: true, metafile: true });
writeFileSync(out + "pass1.js", r1.outputFiles[0].contents);
const r = buildSync({ entryPoints: [out + "pass1.js"], bundle: true, write: false, format: "esm", platform: "browser", minify: true, treeShaking: true, logLevel: "warning" });
const code = r.outputFiles[0].contents; writeFileSync(out + "app.js", code);
if (flags.includes("--keep")) { writeFileSync(out + "meta.json", JSON.stringify(r1.metafile)); writeFileSync(out + "readable.js", buildSync({ ...common, entryPoints: [out + "entry.mjs"], minify: false }).outputFiles[0].contents); }
const groups: Record<string, number> = {}; const o = Object.values(r1.metafile!.outputs)[0] as any;
for (const [k, v] of Object.entries(o.inputs) as any) { const g = /packages\/signals\/dist\/[^/]+\/store\//.test(k) ? "store" : /packages\/signals\//.test(k) ? "signals" : /packages\/solid\//.test(k) ? "solid-js" : /packages\/web\//.test(k) ? "web" : /ref\/compile\/(rt-|store-ops|features|prims)/.test(k) ? "rx-rt" : "program"; groups[g] = (groups[g] ?? 0) + v.bytesInOutput; }
console.log(JSON.stringify({ wt: basename(wt), app: name, mode, min: code.length, gzip: gzipSync(code, { level: 9 }).length, brotli: brotliCompressSync(code).length, groups, kept: feats ? ["stores", "accessors", "guards", "shallow", "families", "optimistic", "delete"].filter(n => feats[n]).join(",") || "none" : "all", rt: feats?.rt?.length }));
