// node --experimental-strip-types rt/why.ts <rx-worktree> <file.rx> <needle-module-substring>
// Which modules import the needle in a manifest bundle, and through which names.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url"; import { resolve, basename } from "node:path"; import { createRequire } from "node:module";
const [wt, file, needle] = process.argv.slice(2);
const ref = (p: string) => import(pathToFileURL(`${wt}/ref/${p}`).href);
const { loadModules } = await ref("src/modules.ts"); const { checkModules } = await ref("src/check.ts");
const { compileModules } = await ref("compile/emit.ts"); const { lowerViews } = await ref("compile/jsx.ts"); const F = await ref("compile/features.ts");
const { build } = createRequire(`${wt}/ref/package.json`)("esbuild");
const set = loadModules(resolve(file), (p: string) => existsSync(p) ? readFileSync(p, "utf8") : undefined); checkModules(set);
const compiled = compileModules(set); const out = `${wt}/ref/compile/.out/why-${basename(file)}/`; mkdirSync(out, { recursive: true });
for (const [n, js] of lowerViews(compiled.files, "dom")) writeFileSync(out + n, js);
writeFileSync(out + "api.mjs", "export const x = 1;\n");
writeFileSync(out + "entry.mjs", `import { createApp } from ${JSON.stringify(`${wt}/ref/compile/rt-web.ts`)};\nimport main from "./${compiled.entry}";\nconst app = createApp({ root: document.getElementById("app"), api: {} });\napp.mount(main(app));\n`);
const r = await build({ entryPoints: [out + "entry.mjs"], bundle: true, write: false, format: "esm", platform: "browser", conditions: ["store-select", "browser"], minify: false, treeShaking: true, metafile: true, tsconfigRaw: "{}", logLevel: "silent", define: { ...F.defines(compiled.features), ...(process.env.DEFINES ? JSON.parse(process.env.DEFINES) : {}) } });
const m = r.metafile; const o = Object.values(m.outputs)[0] as any;
const hit = Object.keys(o.inputs).filter(k => k.includes(needle) && o.inputs[k].bytesInOutput > 0);
for (const h of hit) { console.log(h, o.inputs[h].bytesInOutput); for (const [k, v] of Object.entries(m.inputs) as any) if (o.inputs[k]?.bytesInOutput > 0 && v.imports.some((i: any) => i.path === h)) console.log("   <-", k.split("/").slice(-3).join("/")); }
writeFileSync(out + "bundle.js", r.outputFiles[0].text); console.log(out + "bundle.js", r.outputFiles[0].text.length);
