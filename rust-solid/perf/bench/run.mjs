// Times every workload: rust-solid wall clock, then callgrind instructions per timed op, and (with --js) Solid JS wall.
//   node --conditions=browser run.mjs WORKLOAD_DIR SUITE_BIN OUT.jsonl [--js] [--no-ir] [--wall-from W.jsonl] [--jobs N] [names…]
// Instructions: valgrind --tool=callgrind collecting only inside the suite's timed_ops, minus the harness's
// untimed_lookup (one pattern, *timed*, toggles on entering the first and off entering the second; callgrind keeps
// only one --toggle-collect), divided by the reps run.
// Reps under callgrind are cut so each workload's timed region is about 30 ms natively. Callgrind files stay in
// OUT.jsonl's folder under cg/ for profiling and the coverage report.
import {readdirSync, readFileSync, appendFileSync, mkdirSync, existsSync} from 'node:fs';
import {execFileSync, execFile} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const args = process.argv.slice(2);
const flag = f => { const i = args.indexOf(f); if (i < 0) return false; args.splice(i, 1); return true; };
const opt = (f, d) => { const i = args.indexOf(f); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const js = flag('--js'), noIr = flag('--no-ir'), jobs = Number(opt('--jobs', 3)), wallFrom = opt('--wall-from', null);
const [dir, bin, out, ...only] = args;
const cg = resolve(dirname(out), 'cg'); mkdirSync(cg, {recursive: true});
const jsDriver = fileURLToPath(new URL('./solid-js.mjs', import.meta.url));
const ws = readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => ({file: `${dir}/${f}`, ...JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))}))
  .filter(w => !only.length || only.includes(w.name));
const put = o => { appendFileSync(out, JSON.stringify(o) + '\n'); console.log(JSON.stringify(o)); };
const wall = {};
if (wallFrom) for (const r of readFileSync(wallFrom, 'utf8').trim().split('\n').map(l => JSON.parse(l))) { if (r.kind === 'wall' && r.runtime !== 'solid-js') wall[r.name] = r.med; }
else for (const w of ws) {
  const r = JSON.parse(execFileSync(bin, [w.file, 'wall'], {maxBuffer: 1 << 28}).toString());
  wall[w.name] = r.med; put({...r, kind: 'wall'});
  if (js) put({...JSON.parse(execFileSync(process.execPath, ['--conditions=browser', '--max-old-space-size=8192', jsDriver, w.file, 'wall'], {maxBuffer: 1 << 28}).toString()), kind: 'wall'});
}
if (!noIr) {
  const queue = [...ws];
  const one = w => new Promise(done => {
    const reps = Math.max(1, Math.min(w.reps, Math.ceil(30000 / Math.max(wall[w.name], 0.001))));
    const file = `${cg}/${w.name}.out`;
    execFile('valgrind', ['--tool=callgrind', `--callgrind-out-file=${file}`, '--collect-atstart=no', '--toggle-collect=*timed*', bin, w.file, 'ir'],
      {env: {...process.env, REPS: String(reps)}, maxBuffer: 1 << 28}, (err, stdout, stderr) => {
        const m = /Collected : (\d+)/.exec(stderr);
        if (err || !m) put({name: w.name, kind: 'ir', error: String(stderr).split('\n').slice(-4).join(' | ')});
        else put({name: w.name, kind: 'ir', reps, ir: Math.round(Number(m[1]) / reps)});
        done();
      });
  });
  await Promise.all(Array.from({length: jobs}, async () => { while (queue.length) await one(queue.shift()); }));
}
