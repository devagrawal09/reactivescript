// Billed cost without each run's first model call (round 5b, post hoc). The first call is the same in every run of
// a round (system prompt, tools and the one-line start), but whether its prefix is read from the prompt cache or
// written to it depends on what ran just before, not on the arm: round 5's labels batch and all of 5b started cold
// (prefix written, about 31k billed units more), round 5's related and count batches warm. Dropping it compares the
// runs' own work. Usage: node harness/cost-warm.mjs <agents.txt> <transcripts-dir> [out.json]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WEIGHTS, permutation } from "./cost.mjs";

const [list, dir, out] = process.argv.slice(2);
const bill = u => (u.input_tokens ?? 0) * WEIGHTS.input + (u.cache_creation_input_tokens ?? 0) * WEIGHTS.cacheWrite
  + (u.cache_read_input_tokens ?? 0) * WEIGHTS.cacheRead + (u.output_tokens ?? 0) * WEIGHTS.output;
const runs = readFileSync(list, "utf8").trim().split("\n").map(l => l.trim().split(/\s+/)).map(([run, id]) => {
  const seen = new Set(); const calls = [];
  for (const line of readFileSync(path.join(dir, `agent-${id}.jsonl`), "utf8").split("\n")) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.message?.usage && !seen.has(e.message.id)) { seen.add(e.message.id); calls.push(e.message.usage); }
  }
  const [, task, arm] = run.match(/^(\w+)-(\w+)-(\d+)$/);
  return { run, task, arm, first: bill(calls[0]), rest: calls.slice(1).reduce((s, u) => s + bill(u), 0) };
});
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const arms = [...new Set(runs.map(r => r.arm))];
for (const a of arms) for (const t of [...new Set(runs.map(r => r.task)), "ALL"]) {
  const xs = runs.filter(r => r.arm === a && (t === "ALL" || r.task === t)).map(r => r.rest);
  console.log(`${a.padEnd(6)} ${t.padEnd(8)} n ${xs.length}  mean ${Math.round(mean(xs))}`);
}
const tests = [];
for (const a of arms) for (const b of arms) if (a !== b) {
  const xa = runs.filter(r => r.arm === a).map(r => r.rest), xb = runs.filter(r => r.arm === b).map(r => r.rest);
  if (mean(xa) > mean(xb)) { const p = permutation(xa, xb); tests.push({ higher: a, lower: b, diff: mean(xa) - mean(xb), p }); console.log(`${a} - ${b} = ${Math.round(mean(xa) - mean(xb))}, one-sided p = ${p.toFixed(4)}`); }
}
if (out) writeFileSync(out, JSON.stringify({ runs, tests }, null, 2) + "\n");
