// npm run ssr-corpus -- --start S --seeds N [--max M] --out DIR [--async]
// Writes rust-solid's crates/runtime/tests/fixtures/ssr/: generated programs whose plans the Rust server renderer renders
// as Solid renders their TSX twins, each `{ seed, plan, html }` with Solid's renderToString HTML, plus the tracker and
// like (their canonical twins). Picks programs in seed order until every plan node kind and every lowering form the
// renderer distinguishes (scoped and unscoped holes, markers, Show with and without fallback, For rows of one and two
// views, condition memos) is covered, then fills up to M. `cargo test --test ssr` replays them without Node.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { emit, generate } from '../plan/fuzz/gen.ts';
import { loadTsxModules } from '../tsx/modules.ts';
import { resolvePlanV2 } from '../plan/resolve-v2.ts';
import { planNodes } from '../plan/fuzz/run.ts';
import { solidServer } from '../ssr/run.ts';
import { generateAsync, emitAsync } from '../plan/fuzz/gen-async.ts';
import { solidServerAsync } from '../ssr/run-async.ts';
import type { ServerAnswer, StreamEvent } from '../ssr/stream-core.ts';

const flag = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const start = Number(flag('--start') ?? 1), seeds = Number(flag('--seeds') ?? 300), max = Number(flag('--max') ?? 16);
const out = flag('--out');
if (!out) { console.error('--out DIR is required'); process.exit(2); }
mkdirSync(out, { recursive: true });
const tmp = fileURLToPath(new URL('../.out/ssr/corpus/', import.meta.url));

/** The lowering forms of a server render, read off Solid's compiled SSR module and its HTML. */
const forms = (compiled: string, html: string) => {
  const f: string[] = [];
  if (/_\$scope\(/.test(compiled)) f.push('scoped hole');
  if (/= \(\) => \{\n\s*return "" \+/.test(compiled)) f.push('unscoped hole');
  if (/_\$memo\(/.test(compiled)) f.push('condition memo');
  if (html.includes('<!--$-->')) f.push('markers');
  if (html.includes('<!--!$-->')) f.push('text separator');
  if (/fallback/.test(compiled)) f.push('show fallback');
  if (/return \[\(/.test(compiled)) f.push('row of two views');
  return f;
};
const covered = new Set<string>();
let written = 0;
const write = (name: string, value: unknown) => { writeFileSync(out + '/' + name + '.json', JSON.stringify(value, null, 1) + '\n'); written++; };
// --async (docs/RESULTS.md, "Slice 5: async data"): crates/runtime/tests/fixtures/ssr-async/: the tracker-async slice
// under four server answer scripts, and generated v2.1 programs (gen-async.ts) under the SSR fuzz's server chooser,
// each `{ plan, answers, events, html, requests }` with Solid's renderToStream event log (its chunks, the settlements,
// the end), the answers it realized, and its renderToString HTML and requests. Programs are picked in seed order until
// every stream form below is covered, then up to M. `cargo test --test ssr_async` replays them without Node.
if (process.argv.includes('--async')) {
  const streamForms = (events: StreamEvent[], answers: ServerAnswer[], plan: any) => {
    const f: string[] = [];
    const chunks = events.flatMap(e => 'chunk' in e ? [e.chunk] : []);
    const all = chunks.join('');
    f.push('chunks ' + Math.min(chunks.length, 4));
    if (/<template id="[^"]*" e>/.test(all)) f.push('error fragment');
    if (/<template id="[^"]*">/.test(all)) f.push('fragment');
    if (all.includes('"$$f"')) f.push('$$f');
    if (answers.some(a => 'error' in a)) f.push('server rejection');
    if (answers.some(a => a.mode === 'now')) f.push('now answer');
    if (answers.some(a => a.mode === 'idle' && a.at === undefined)) f.push('idle answer never settled');
    if (/new Error\("Internal Server Error"\)/.test(all)) f.push('wire error');
    if (all.includes('delete _$HY.r[')) f.push('unregistered record');
    const json = JSON.stringify(plan);
    for (const k of ['"kind":"loading"', '"kind":"errored"', '"op":"pending"', '"op":"latest"', '"kind":"show"', '"kind":"for"', '"await":{'])
      if (json.includes(k)) f.push(k);
    if ((json.match(/"kind":"loading"/g) ?? []).length > 1) f.push('two loadings');
    return f;
  };
  const sc = JSON.parse(readFileSync(new URL('../slices/tracker-async/tracker-async.scenario.json', import.meta.url), 'utf8'));
  const tsx = readFileSync(new URL('../slices/tracker-async/tracker-async.tsx', import.meta.url), 'utf8');
  const plan = JSON.parse(readFileSync(new URL('../plan/tracker-async.plan.json', import.meta.url), 'utf8'));
  const v = sc.steps[1].value;
  const scripts: Record<string, ServerAnswer[]> = {
    idle: [{ host: 'loadIssues', call: 1, args: [], mode: 'idle', at: 0, value: v }],
    now: [{ host: 'loadIssues', call: 1, args: [], mode: 'now', value: v }],
    'idle-reject': [{ host: 'loadIssues', call: 1, args: [], mode: 'idle', at: 0, error: 'offline' }],
    'now-reject': [{ host: 'loadIssues', call: 1, args: [], mode: 'now', error: 'offline' }],
  };
  for (const [name, script] of Object.entries(scripts)) {
    const r = await solidServerAsync(tsx, ['assignIssue', 'loadIssues'], tmp + 'tracker-async-' + name, { script });
    if ('error' in r || !r.stream || 'error' in r.stream || !r.string || 'error' in r.string) throw new Error('tracker-async ' + name + ': ' + JSON.stringify(r).slice(0, 400));
    write('tracker-async-' + name, { name: 'tracker-async-' + name, plan, answers: r.stream.answers, events: r.stream.events, html: r.string.html, requests: r.string.requests });
  }
  for (let seed = start; seed < start + seeds && written < max + 4; seed++) {
    const c = generateAsync(seed), files = emitAsync(c);
    let plan: any;
    try { plan = resolvePlanV2(loadTsxModules('App.tsx', p => files[p], { async: true }), { async: true }); } catch { continue; }
    const r = await solidServerAsync(files['App.tsx'], c.hosts.map(h => h.name), tmp + 'async-seed-' + seed, { chooser: { seed, hosts: c.hosts } });
    if ('error' in r || !r.stream || 'error' in r.stream || !r.string || 'error' in r.string) throw new Error('seed ' + seed + ': ' + JSON.stringify(r).slice(0, 400));
    if (r.stream.status !== 'ended') continue;
    const kinds = streamForms(r.stream.events, r.stream.answers, plan);
    const fresh = kinds.filter(k => !covered.has(k));
    if (!fresh.length && written - 4 >= max / 2) continue;
    for (const k of kinds) covered.add(k);
    write('seed-' + seed, { seed, plan, answers: r.stream.answers, events: r.stream.events, html: r.string.html, requests: r.string.requests });
    console.log('seed', seed, fresh.join(', '));
  }
  console.log('wrote ' + written + ' programs to ' + out + '; covered ' + [...covered].sort().join(', '));
  process.exit(0);
}
// The slices: their canonical twins (ssr/ssr.test.ts).
const slice = (f: string) => readFileSync(new URL('../slices/' + f, import.meta.url), 'utf8');
for (const [name, tsx, plan, hosts] of [
  ['tracker', slice('tracker/tracker.tsx').replace('<b>{unassigned()} open</b>', '<b>{"" + unassigned()} open</b>'), 'tracker.plan.json', ['assignIssue']],
  ['like', slice('like/like.tsx').replace('>{shown()}</button>', '>{"" + shown()}</button>'), 'like.plan-v2.json', ['save']],
] as const) {
  const r = await solidServer(tsx, [...hosts], tmp + name);
  if ('error' in r) throw new Error(r.error);
  write(name, { name, plan: JSON.parse(readFileSync(new URL('../plan/' + plan, import.meta.url), 'utf8')), html: r.html });
}
for (let seed = start; seed < start + seeds && written < max + 2; seed++) {
  const c = generate(seed), files = emit(c);
  let plan: any;
  try { plan = resolvePlanV2(loadTsxModules('App.tsx', p => files[p])); } catch { continue; }
  const r = await solidServer(files['App.tsx'], c.hosts.map(h => h.name), tmp + 'seed-' + seed);
  if ('error' in r) throw new Error('seed ' + seed + ': ' + r.error);
  const kinds = [...Object.keys(planNodes(plan)), ...forms(r.compiled, r.html)];
  const fresh = kinds.filter(k => !covered.has(k));
  if (!fresh.length && covered.size && written >= max + 2) continue;
  if (!fresh.length && written - 2 >= max / 2) continue;
  for (const k of kinds) covered.add(k);
  write('seed-' + seed, { seed, plan, html: r.html });
  console.log('seed', seed, fresh.join(', '));
}
console.log('wrote ' + written + ' programs to ' + out + '; covered ' + [...covered].sort().join(', '));
