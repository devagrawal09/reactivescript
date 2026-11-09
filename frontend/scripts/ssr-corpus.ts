// npm run ssr-corpus -- --start S --seeds N [--max M] --out DIR
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
