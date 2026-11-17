// Memory check: does an app's memory grow the longer it runs? For each workload, the live nodes, node slots, host
// nodes and the process's peak resident memory after R reps and after 10R (R as growth.mjs picks it). Fresh
// workloads remount every rep, so only their peak is shown.
//   node memory.mjs WORKLOAD_DIR SUITE_BIN WALL.jsonl OUT.jsonl [--jobs N] [names…]
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
const run = (w, reps) => new Promise((done, fail) => execFile(bin, [w.file, 'ir'], {env: {...process.env, REPS: String(reps), ARENAS: '1'}, maxBuffer: 1 << 28},
  (err, _o, stderr) => {
    if (err) return fail(new Error(String(stderr).split('\n').slice(-3).join(' | ')));
    const num = k => { const m = new RegExp(`\\b${k}=(\\d+)`).exec(stderr); return m ? Number(m[1]) : null; };
    done({nodes: num('nodes'), slots: num('node_slots'), host: num('host_nodes'), peakKb: num('peak_kb')});
  }));
const queue = [...ws];
const one = async w => {
  const r = 2 * Math.max(1, Math.min(100, Math.ceil(5000 / Math.max(wall[w.name] ?? 100, 0.001))));
  try {
    const a = await run(w, r), b = await run(w, 10 * r);
    const o = {name: w.name, fresh: !!w.fresh, reps: r, at: a, at10: b};
    appendFileSync(out, JSON.stringify(o) + '\n'); console.log(JSON.stringify(o));
  } catch (e) { const o = {name: w.name, error: e.message}; appendFileSync(out, JSON.stringify(o) + '\n'); console.log(JSON.stringify(o)); }
};
await Promise.all(Array.from({length: jobs}, async () => { while (queue.length) await one(queue.shift()); }));
