// node --experimental-strip-types --conditions=browser probe.ts <rx-worktree> <file.rx>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const [wt, file] = process.argv.slice(2);
const ref = (p: string) => import(pathToFileURL(`${wt}/ref/${p}`).href);
const { loadModules } = await ref("src/modules.ts"); const { checkModules } = await ref("src/check.ts");
const { compileModules } = await ref("compile/emit.ts"); const { lowerViews } = await ref("compile/jsx.ts");
const { createApp, flush } = await ref("compile/rt.ts");
const set = loadModules(resolve(file), (p: string) => { try { return readFileSync(p, "utf8"); } catch { return undefined; } });
const { diags } = checkModules(set); if (diags.length) { console.error(diags); process.exit(1); }
const compiled = compileModules(set);
const out = `${wt}/ref/compile/.out/bench-${process.pid}/`; mkdirSync(out, { recursive: true });
for (const [n, js] of lowerViews(compiled.files, "universal")) writeFileSync(out + n, js);
console.log(readFileSync(out + compiled.entry, "utf8").split("\n").filter(l => !l.startsWith("import")).join("\n"));
