// Round 7 (maintenance chains, PREREG-chain-7.md): per run, the tests it fails, which of them are new (passed in its
// base, the previous step's app, or are new at this step) and which of the new ones are regressions (an earlier
// step's test); per chain, whether its last app has a defect and its cost (billed without each run's first call).
// Usage: node harness/chain.mjs <score.json> [<agents.txt> <transcripts-dir>] [--out <file.json>]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WEIGHTS, permutation } from "./cost.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const tasks = path.resolve(here, "../tasks");
const args = process.argv.slice(2);
const o = args.indexOf("--out");
const out = o >= 0 ? args.splice(o, 2)[1] : null;
const [scoreFile, list, dir] = args;
const score = JSON.parse(readFileSync(scoreFile, "utf8"));

// every test name of step k's suites, and the step each test first appears in
const suite = {};
const firstStep = {};
for (let k = 1; k <= 4; k++) {
  suite[k] = new Set();
  for (const f of ["visible", "hidden", "hidden-overlap"]) {
    for (const t of (await import(pathToFileURL(path.join(tasks, `chain${k}`, `${f}.mjs`)).href)).default) {
      suite[k].add(`${f === "visible" ? "visible" : "hidden"}: ${t.name}`);
      firstStep[`${f === "visible" ? "visible" : "hidden"}: ${t.name}`] ??= k;
    }
  }
}

const failing = r => r.built === false ? new Set(["build"]) : new Set([
  ...r.failedVisible.map(t => `visible: ${t.name}`),
  ...r.failedHidden.map(t => `hidden: ${t.name}`),
  ...(r.failedOverlap ?? []).map(t => `hidden: ${t.name}`),
]);
const byRun = Object.fromEntries(score.map(r => [r.run, r]));

let bill = null;
if (list) {
  const b = u => (u.input_tokens ?? 0) * WEIGHTS.input + (u.cache_creation_input_tokens ?? 0) * WEIGHTS.cacheWrite
    + (u.cache_read_input_tokens ?? 0) * WEIGHTS.cacheRead + (u.output_tokens ?? 0) * WEIGHTS.output;
  bill = {};
  for (const [run, id] of readFileSync(list, "utf8").trim().split("\n").map(l => l.trim().split(/\s+/))) {
    const seen = new Set(); const calls = [];
    for (const line of readFileSync(path.join(dir, `agent-${id}.jsonl`), "utf8").split("\n")) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.message?.usage && !seen.has(e.message.id)) { seen.add(e.message.id); calls.push(e.message.usage); }
    }
    bill[run] = calls.slice(1).reduce((s, u) => s + b(u), 0);
  }
}

const runs = [];
for (const r of score) {
  const [, k, arm, n] = r.run.match(/^chain(\d)-(\w+)-(\d+)$/).map((x, i) => (i === 1 || i === 3 ? Number(x) : x));
  const fails = failing(r);
  const base = k > 1 ? byRun[`chain${k - 1}-${arm}-${n}`] : null;
  const baseFails = base ? failing(base) : new Set();
  const isNew = t => t === "build" ? !baseFails.has("build") : !(baseFails.has(t) || (baseFails.has("build") && firstStep[t] < k));
  const fresh = [...fails].filter(isNew);
  const regressions = fresh.filter(t => t !== "build" && firstStep[t] < k);
  runs.push({ run: r.run, step: k, arm, chain: n, defect: fails.size > 0, failing: [...fails], new: fresh, regressions, cost: bill?.[r.run] ?? null });
}
runs.sort((a, b) => a.arm.localeCompare(b.arm) || a.chain - b.chain || a.step - b.step);

/** one-sided Fisher: p that the first group has at least `a` of the `a + c` hits by chance */
function fisherGreater(a, n1, c, n2) {
  const lf = x => { let s = 0; for (let i = 2; i <= x; i++) s += Math.log(i); return s; };
  const choose = (n, k) => lf(n) - lf(k) - lf(n - k);
  const hits = a + c; let p = 0;
  for (let x = a; x <= Math.min(hits, n1); x++) p += Math.exp(choose(n1, x) + choose(n2, hits - x) - choose(n1 + n2, hits));
  return Math.min(1, p);
}

for (const r of runs) console.log(`${r.run.padEnd(16)} ${r.defect ? "DEFECT" : "ok    "} new ${r.new.length}  regressions ${r.regressions.length}${r.cost != null ? `  cost ${Math.round(r.cost)}` : ""}${r.new.length ? `\n    ${r.new.join("\n    ")}` : ""}`);
const arms = ["react", "rx"];
const last = Math.max(...runs.map(r => r.step));
const report = { last, arms: {} };
for (const a of arms) {
  const rs = runs.filter(r => r.arm === a);
  const chains = [...new Set(rs.map(r => r.chain))];
  report.arms[a] = {
    chains: chains.length,
    endDefect: chains.filter(c => rs.find(r => r.chain === c && r.step === last)?.defect).length,
    runs: rs.length,
    runsWithNew: rs.filter(r => r.new.length).length,
    runsWithRegression: rs.filter(r => r.regressions.length).length,
    perStep: Object.fromEntries([1, 2, 3, 4].filter(k => rs.some(r => r.step === k)).map(k => [k, {
      defect: rs.filter(r => r.step === k && r.defect).length, new: rs.filter(r => r.step === k && r.new.length).length,
      ...(bill ? { meanCost: Math.round(rs.filter(r => r.step === k).reduce((s, r) => s + r.cost, 0) / rs.filter(r => r.step === k).length) } : {}),
    }])),
    ...(bill ? { chainCost: chains.map(c => Math.round(rs.filter(r => r.chain === c).reduce((s, r) => s + r.cost, 0))) } : {}),
  };
}
const [R, X] = arms.map(a => report.arms[a]);
report.H7a = { react: `${R.endDefect}/${R.chains}`, rx: `${X.endDefect}/${X.chains}`, p: fisherGreater(R.endDefect, R.chains, X.endDefect, X.chains) };
report.H7b = { react: `${R.runsWithNew}/${R.runs}`, rx: `${X.runsWithNew}/${X.runs}`, p: fisherGreater(R.runsWithNew, R.runs, X.runsWithNew, X.runs) };
report.H7c = { react: `${R.runsWithRegression}/${R.runs}`, rx: `${X.runsWithRegression}/${X.runs}`, p: fisherGreater(R.runsWithRegression, R.runs, X.runsWithRegression, X.runs) };
if (bill) {
  report.cost = { reactMinusRx: permutation(R.chainCost, X.chainCost), rxMinusReact: permutation(X.chainCost, R.chainCost) };
}
console.log(JSON.stringify({ ...report, runs: undefined }, null, 1));
if (out) writeFileSync(out, JSON.stringify({ ...report, runs }, null, 2) + "\n");
