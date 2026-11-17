// Correctness gate for the suite: each workload's full host log on rust-solid must equal native Solid's (solid-js.mjs
// trace), entry for entry, with step, tree and frame entries after every step. Run before timing.
//   node --conditions=browser check.mjs WORKLOAD_DIR SUITE_BIN [names…]
import {readdirSync, readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const [dir, bin, ...only] = process.argv.slice(2);
const js = fileURLToPath(new URL('./solid-js.mjs', import.meta.url));
let bad = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const w = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
  if (only.length && !only.includes(w.name)) continue;
  const reps = String(Math.min(w.reps, w.fresh ? 1 : 3));
  const env = {...process.env, REPS: reps};
  const run = (cmd, args) => { try { return JSON.parse(execFileSync(cmd, args, {env, maxBuffer: 1 << 30}).toString()); } catch (e) { return {error: String(e.stderr ?? e).split('\n').filter(Boolean).slice(-3).join(' | ')}; } };
  // logCheck: false (very large workloads): compare the final frame only, with logging off.
  const mode = w.logCheck === false ? 'wall' : 'trace';
  const a = run(process.execPath, ['--conditions=browser', '--max-old-space-size=8192', js, `${dir}/${f}`, mode]);
  const b = run(bin, [`${dir}/${f}`, mode]);
  let verdict;
  if (a.error || b.error) verdict = `ERROR solid: ${a.error ?? 'ok'} rust: ${b.error ?? 'ok'}`;
  else if (mode === 'wall') verdict = a.frame === b.frame ? `agree frame ${a.frame} (log not compared)` : `DIFFER frame solid ${a.frame} rust ${b.frame}`;
  else {
    const n = Math.max(a.log.length, b.log.length);
    let at = -1;
    for (let i = 0; i < n; i++) if (JSON.stringify(a.log[i]) !== JSON.stringify(b.log[i])) { at = i; break; }
    verdict = at < 0 ? `agree ${a.log.length} entries` : `DIFFER at entry ${at} of ${a.log.length}/${b.log.length}: solid ${JSON.stringify(a.log[at])} rust ${JSON.stringify(b.log[at])}`;
  }
  if (!verdict.startsWith('agree')) bad++;
  console.log(`${w.name.padEnd(14)} ${verdict}`);
}
process.exitCode = bad ? 1 : 0;
