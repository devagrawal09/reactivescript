import { readFileSync, writeFileSync } from "node:fs";
import { execute, loadVariant, ensureBuilds } from "./fuzz.mjs";

await ensureBuilds();
const apis = await loadVariant("slots");
const raw = JSON.parse(
  readFileSync("/home/lucifer/work/solidjs/store-proto-bench/fuzz/failures/slots-seed-1.json", "utf8")
);
const full = raw.program;
let program = {
  ...full,
  steps: [full.steps[26]],
  readers: full.readers.filter(r => r.id === 5 || r.id === 8),
  mapArray: null,
  memo: null,
  cond: null,
  disposable: null
};

async function differs(prog) {
  const proxy = await execute(prog, apis.ref, { mode: "proxy", kind: "ref" });
  const target = await execute(prog, apis.variant, { mode: "target", kind: "slots" });
  const n = Math.max(proxy.lines.length, target.lines.length);
  for (let i = 0; i < n; i++) if (proxy.lines[i] !== target.lines[i]) return { diff: true, proxy, target, i };
  return { diff: proxy.halted || target.halted, proxy, target, i: -1 };
}

let cur = await differs(program);
if (!cur.diff) {
  console.log("reduced start matches, need more");
  process.exit(1);
}
console.error("start differs at", cur.i, cur.proxy.lines[cur.i], "vs", cur.target.lines[cur.i]);

for (let i = program.projections.length - 1; i >= 0; i--) {
  const trial = { ...program, projections: program.projections.filter((_, j) => j !== i) };
  const r = await differs(trial);
  if (r.diff) {
    program = trial;
    console.error("drop proj", full.projections[i].kind);
  }
}
if (program.optimistic.length) {
  const trial = { ...program, optimistic: [] };
  if ((await differs(trial)).diff) {
    program = trial;
    console.error("drop opt");
  }
}
const out = "/home/lucifer/work/solidjs/store-proto-bench/fuzz/failures/slots-seed-1.min.json";
writeFileSync(out, JSON.stringify({ program }, null, 2));
const fin = await differs(program);
console.log("DIFF", fin.i);
console.log("proxy ", fin.proxy.lines[fin.i]);
console.log("target", fin.target.lines[fin.i]);
console.log("--- proxy ---");
console.log(fin.proxy.lines.join("\n"));
console.log("--- target ---");
console.log(fin.target.lines.join("\n"));
console.log("proj", program.projections.map(p => p.kind));
console.log("readers", program.readers.map(r => r.kind + JSON.stringify(r.path)));
