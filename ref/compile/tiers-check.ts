// node --experimental-strip-types compile/tiers-check.ts
// One program per tier decision (emit.ts `tier`, `provablySync`): a program that needs a step gets it, and no lower one.
import { parseProgram, parseStmts } from "../src/parse.ts";
import { singleModule } from "../src/modules.ts";
import { compileModules } from "./emit.ts";
const app = (body: string, head = "") => `${head}export default component App() {\n${body}\n}`;
const cases: [string, string, string, string[]?, { sync?: number; memos?: number }?][] = [
  ["A0: sources, equations, effects, sync handlers", app(`  source n := 0\n  double = n * 2\n  effect (double) { log($0) }\n  <button onClick={() => { n := n + 1 }}>{double}</button>`, `import { log } from "./prelude"\n`), "A0"],
  ["A0: a store with path writes, a for, an if", app(`  source rows := [{ id: 1, t: "A" }]\n  <ul onClick={() => { rows[0].t := "B" }}>{for r in rows { <li>{if r.id == 1 { <b>{r.t}</b> } else { <i>{r.t}</i> }}</li> }}</ul>`), "A0"],
  ["A1: an action that never awaits", app(`  source n := 0\n  action bump() { n := n + 1 }\n  <button onClick={() => { bump() }}>{n}</button>`), "A1"],
  ["A2: an action that awaits and then writes", app(`  source n := 0\n  action save() { let r = await fetch("save"); n := r }\n  <button onClick={() => { save() }}>{n}</button>`, `import pure { fetch } from "./prelude"\n`), "A5"],   // fetch is a flight: the prelude's own question
  ["A2: a handler row that awaits (a scenario's handler)", app(`  source n := 0\n  <p>{n}</p>`), "A2", ["let r = await tick(); n := r"]],
  ["A3: pending?", app(`  source n := 0\n  <p>{pending? n ? "…" : ""}{n}</p>`), "A3"],
  ["A3: latest", app(`  source n := 0\n  <p>{latest n}</p>`), "A3"],
  ["A4: a guess", app(`  source n := 0\n  action save() { guess n := 1 }\n  <button onClick={() => { save() }}>{n}</button>`), "A4"],
  ["A5: a question", app(`  source q := "a"\n  hits = await fetch(q) -> []\n  <p>{len(hits)}</p>`, `import pure { fetch } from "./prelude"\n`), "A5"],
  ["A5: a loading boundary", app(`  source n := 0\n  {loading fallback { <p>…</p> } { <p>{n}</p> }}`), "A5"],
  ["per node: a memo proved synchronous is sync", app(`  source n := 0\n  double = n * 2\n  label = "n is {n}"\n  <p>{double}{label}</p>`), "A0", undefined, { sync: 2, memos: 2 }],
  ["per node: a memo whose value may be a promise is not", app(`  source n := 0\n  source box := { v: 1 }\n  same = box.v\n  <p>{same}{n}</p>`), "A0", undefined, { sync: 0, memos: 1 }],
];
let bad = 0;
for (const [name, src, want, extra, nodes] of cases) {
  try {
    const f = compileModules(singleModule(parseProgram(src)), { extraStmts: (extra ?? []).map(h => parseStmts(h)) }).features;
    const wrong: string[] = [];
    if (f.tier.step !== want) wrong.push(`step ${f.tier.step}, expected ${want}`);
    if (nodes?.sync !== undefined && f.tier.nodes.syncMemos !== nodes.sync) wrong.push(`${f.tier.nodes.syncMemos} sync memos, expected ${nodes.sync}`);
    if (nodes?.memos !== undefined && f.tier.nodes.memos !== nodes.memos) wrong.push(`${f.tier.nodes.memos} memos, expected ${nodes.memos}`);
    console.log(`${wrong.length ? "✗" : "✓"} ${name}: ${f.tier.step} (${f.tier.why[f.tier.step] ?? "nothing above sync"})${wrong.length ? "  — " + wrong.join(", ") : ""}`);
    if (wrong.length) bad++;
  } catch (e) { console.log(`✗ ${name}: ${(e as Error).message}`); bad++; }
}
console.log(`\n${cases.length - bad} of ${cases.length} tier cases`);
process.exit(bad ? 1 : 0);
