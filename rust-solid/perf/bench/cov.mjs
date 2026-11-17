// Function-level coverage of the bench suite against a reference run (the plan-fuzz corpus replayed by the
// `corpus` example under callgrind). Lists rust-solid functions the reference executes that no workload does,
// ranked by their share of the reference's instructions, and per workload the functions only it reaches.
//   node cov.mjs REF.out CG_DIR [CG_DIR…]   (CG_DIR: run.mjs's callgrind files)
import {readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const [ref, ...dirs] = process.argv.slice(2);
const HARNESS = /TreeRenderer>::(tree|handlers_of|handles|frame|nth_handler)|TreeRenderer>::kids::|frame::\{|rust_solid::scenario|serde_json|plan_v2::Check>|plan_v2::validate|HostType>::one|App>::frame|to_json/;
const fns = file => {
  const out = execFileSync('callgrind_annotate', ['--inclusive=no', '--threshold=100', file], {maxBuffer: 1 << 28}).toString();
  const m = new Map();
  for (const line of out.split('\n')) {
    const r = /^\s*([\d,]+) \([^)]*\)\s+\S*?:(.*) \[/.exec(line);
    if (!r) continue;
    const name = r[2].replace(/::h[0-9a-f]{16}$/, '');
    if (!/rust_solid|slice1|plan_v2/.test(name)) continue;
    // The harness's own work (log, tree and frame dumps, scenario parsing, target lookup, plan validation) is not the
    // runtime's: the reference runs with the log on, the workloads time with it off.
    if (HARNESS.test(name)) continue;
    m.set(name, (m.get(name) ?? 0) + Number(r[1].replaceAll(',', '')));
  }
  return m;
};
const R = fns(ref), total = [...R.values()].reduce((a, b) => a + b, 0);
const per = new Map();
for (const d of dirs) for (const f of readdirSync(d).filter(f => f.endsWith('.out'))) per.set(f.replace(/\.out$/, ''), fns(`${d}/${f}`));
const hit = new Set([...per.values()].flatMap(m => [...m.keys()]));
const missed = [...R].filter(([n]) => !hit.has(n)).sort((a, b) => b[1] - a[1]);
const pct = x => (100 * x / total).toFixed(2) + '%';
console.log(`reference: ${R.size} rust-solid functions; workloads reach ${[...R.keys()].filter(n => hit.has(n)).length}; ` +
  `missed ${missed.length}, ${pct(missed.reduce((a, [, v]) => a + v, 0))} of the reference's instructions`);
console.log('\n## Executed by the reference, by no workload (top 60 by reference Ir)');
for (const [n, v] of missed.slice(0, 60)) console.log(`${pct(v).padStart(7)}  ${n}`);
console.log('\n## Functions only one workload reaches');
const only = new Map();
for (const [w, m] of per) for (const n of m.keys()) { const owners = [...per].filter(([, x]) => x.has(n)).length; if (owners === 1) only.set(w, [...(only.get(w) ?? []), n]); }
for (const [w, ns] of [...only].sort()) console.log(`${w}: ${ns.length} — ${ns.slice(0, 6).join(', ')}${ns.length > 6 ? ', …' : ''}`);
