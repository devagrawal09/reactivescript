// Steady-state check: does an op cost more the longer the app runs? For each workload, callgrind instructions
// for the first R reps against the next 2R (R from the wall time, about 10 ms of work). A ratio well over 1 means
// state that grows with use (a leak, tombstones, a list never trimmed), which a fixed rep count hides.
//   node --conditions=browser growth.mjs WORKLOAD_DIR SUITE_BIN WALL.jsonl OUT.jsonl [--jobs N] [names…]
import {readdirSync, readFileSync, appendFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const jobs = Number(opt('--jobs', 3));
const [dir, bin, wallFile, out, ...only] = args;
const wall = {};
for (const r of readFileSync(wallFile, 'utf8').trim().split('\n').map(l => JSON.parse(l))) if (r.kind === 'wall' && r.runtime !== 'solid-js') wall[r.name] = r.med;
const ws = readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => ({file: `${dir}/${f}`, ...JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))}))
  .filter(w => !only.length || only.includes(w.name));
const ir = (w, reps) => new Promise((done, fail) => execFile('valgrind', ['--tool=callgrind', '--callgrind-out-file=/dev/null', '--collect-atstart=no', '--toggle-collect=*timed*', bin, w.file, 'ir'],
  {env: {...process.env, REPS: String(reps)}, maxBuffer: 1 << 28}, (err, _o, stderr) => {
    const m = /Collected : (\d+)/.exec(stderr);
    if (err || !m) fail(new Error(String(stderr).split('\n').slice(-3).join(' | '))); else done(Number(m[1]));
  }));
const queue = [...ws];
const one = async w => {
  // Even, so an op that flips a flag is measured over whole on/off cycles. dashboard steps through ten
  // thresholds, so its ratio is noise unless R is a multiple of ten.
  const r = 2 * Math.max(1, Math.min(100, Math.ceil(5000 / Math.max(wall[w.name] ?? 100, 0.001))));
  try {
    const [a, b] = await Promise.all([ir(w, r), ir(w, 3 * r)]);
    const early = a / r, late = (b - a) / (2 * r);
    const o = {name: w.name, reps: r, early: Math.round(early), late: Math.round(late), growth: Math.round(late / early * 1000) / 1000};
    appendFileSync(out, JSON.stringify(o) + '\n'); console.log(JSON.stringify(o));
  } catch (e) { const o = {name: w.name, error: e.message}; appendFileSync(out, JSON.stringify(o) + '\n'); console.log(JSON.stringify(o)); }
};
await Promise.all(Array.from({length: jobs}, async () => { while (queue.length) await one(queue.shift()); }));
