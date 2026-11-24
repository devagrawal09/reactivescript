// node --experimental-strip-types rt/spread.ts <rx-worktree> <dir-or-file>…
// The corpus spread: each program's tier (ladder step), store features and runtime members, from the worktree's own
// compiler manifest (compileModules().features). Scenario .md files contribute one row per distinct program.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url"; import { resolve, basename, join } from "node:path";
const [wt, ...targets] = process.argv.slice(2);
const ref = (p: string) => import(pathToFileURL(`${wt}/ref/${p}`).href);
const { parseScenario, moduleSet } = await ref("src/scenario.ts"); const { loadModules } = await ref("src/modules.ts");
const { parseStmts } = await ref("src/parse.ts"); const { checkModules } = await ref("src/check.ts"); const { compileModules, CompileError } = await ref("compile/emit.ts");
type Row = { group: string; name: string; f: any };
const rows: Row[] = [];
for (const t of targets) {
  const group = basename(resolve(t)); const files = statSync(t).isDirectory() ? readdirSync(t).map(x => join(t, x)).sort() : [t];
  for (const file of files) {
    try {
      if (file.endsWith(".md") && !/TEMPLATE|OPEN-/.test(file)) {
        const sc = parseScenario(basename(file, ".md"), readFileSync(file, "utf8"), resolve(file, ".."));
        sc.tables.forEach((tb: any, i: number) => { if (i > 0 && !tb.program) return; const set = moduleSet(sc, tb.program ?? sc.program); if (checkModules(set).diags.length) return;
          const extra = sc.tables.filter((x: any) => (x.program ?? sc.program) === (tb.program ?? sc.program)).flatMap((x: any) => x.rows.filter((r: any) => r.action.startsWith("handler")).map((r: any) => { try { return parseStmts(r.action.slice(7)); } catch { return []; } }));
          rows.push({ group, name: sc.name + (i ? "#" + i : ""), f: compileModules(set, { extraStmts: extra }).features }); });
      } else if (file.endsWith(".rx") || (statSync(file).isDirectory() && existsSync(join(file, "main.rx")))) {
        const entry = file.endsWith(".rx") ? file : join(file, "main.rx");
        const set = loadModules(resolve(entry), (p: string) => existsSync(p) && statSync(p).isFile() ? readFileSync(p, "utf8") : undefined);
        if (!checkModules(set).diags.length) rows.push({ group, name: basename(file), f: compileModules(set).features });
      }
    } catch (e) { if (!(e instanceof CompileError)) console.error(`! ${file}: ${(e as Error).message.slice(0, 120)}`); }
  }
}
const steps = ["A0", "A1", "A2", "A3", "A4", "A5"]; const feats = ["stores", "families", "optimistic", "guesses", "accessors", "guards"];
const groups = [...new Set(rows.map(r => r.group))];
console.log(`| group | programs | ${steps.join(" | ")} | ${feats.join(" | ")} | memos | proved sync |`); console.log(`|---|---:|${steps.map(() => "---:").join("|")}|${feats.map(() => "---:").join("|")}|---:|---:|`);
for (const g of [...groups, "all"]) { const rs = g === "all" ? rows : rows.filter(r => r.group === g);
  console.log(`| ${g} | ${rs.length} | ${steps.map(s => rs.filter(r => r.f.tier.step === s).length).join(" | ")} | ${feats.map(k => rs.filter(r => r.f[k]).length).join(" | ")} | ${rs.reduce((a, r) => a + r.f.tier.nodes.memos, 0)} | ${rs.reduce((a, r) => a + r.f.tier.nodes.syncMemos, 0)} |`); }
if (process.env.ROWS) for (const r of rows.filter(r => process.env.ROWS === "1" || r.group === process.env.ROWS)) console.log(`${r.f.tier.step} ${r.name.padEnd(26)} kept: ${["stores", ...feats.slice(1)].filter(k => r.f[k]).join(",") || "none"}; rt members ${r.f.rt.length}; memos ${r.f.tier.nodes.memos} (sync ${r.f.tier.nodes.syncMemos}); ${r.f.tier.step}: ${r.f.tier.why[r.f.tier.step] ?? "-"}`);
