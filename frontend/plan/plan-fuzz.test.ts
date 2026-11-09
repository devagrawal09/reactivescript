// The plan fuzz (docs/PLAN-V2.md, "Plan fuzz"): generated programs inside the plan v2 subset, run on native Solid,
// compiled RX, the plan built by solid-plan.ts and (with RUST_PLAN_TRACE) the Rust consumer, comparing results and full
// host logs. The gate also runs seeds 1..100 through scripts/plan-fuzz.ts (verify-pinned.sh, baselines/plan-fuzz.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { emit, generate } from './fuzz/gen.ts';
import { pathsInSetter, runCase, runProgram, UPSTREAM_RX, UPSTREAM_RX_PATH } from './fuzz/run.ts';
import { loadTsxModules } from '../tsx/modules.ts';
import { resolvePlanV2 } from './resolve-v2.ts';

const rust = process.env.RUST_PLAN_TRACE;
const legs = rust ? ['native', 'rx', 'plan', 'rust'] : ['native', 'rx', 'plan'];

test('plan fuzz: generation is deterministic, and the TSX and RX twins emit one plan or one refusal', () => {
  for (let seed = 1; seed <= 12; seed++) {
    assert.deepEqual(generate(seed), generate(seed));
    const files = emit(generate(seed));
    const plans = ['App.rx', 'App.tsx'].map(name => {
      const set = loadTsxModules(name, p => p === name ? files[name] : files[p]);
      try { return JSON.stringify(resolvePlanV2(set)); } catch (e) { return 'refused: ' + (e as Error).message; }
    });
    assert.equal(plans[1], plans[0], 'seed ' + seed);
  }
});

test('plan fuzz: native Solid, compiled RX, the plan and Rust give one result and one host log (seeds 1..12)', async () => {
  for (let seed = 1; seed <= 12; seed++) {
    const o = await runCase(generate(seed), { rust });
    assert.ok(o.status === 'agree' || o.status === 'refused', 'seed ' + seed + ': ' + o.status + ' ' + o.classes.join(', '));
    if (o.status === 'refused') continue;
    assert.deepEqual(Object.keys(o.traces!), legs);
    for (const l of legs) assert.equal(JSON.stringify(o.traces![l as 'native']), JSON.stringify(o.traces!.native), 'seed ' + seed + ' ' + l);
    assert.ok(o.traces!.native!.log.length > 50 && 'frames' in o.traces!.native!.result);
  }
});

test('plan fuzz: a program the emitter refuses counts as refused with its diagnostic, never as agreement', async () => {
  const seeds: number[] = [];
  for (let seed = 1; seeds.length < 3; seed++) if (generate(seed).family === 'outside') seeds.push(seed);
  for (const seed of seeds) {
    const o = await runCase(generate(seed), { rust });
    assert.equal(o.status, 'refused', 'seed ' + seed);
    assert.match(o.detail!, /^unsupported operator [*-]$|^a text hole with a constant value/);
    assert.equal(o.plan, undefined);
    assert.deepEqual(Object.keys(o.traces!), ['native', 'rx'], 'no plan legs for a refused program');
  }
});

test('plan fuzz: the tracker gives native Solid\'s host log once its number hole inserts a string', async () => {
  const slice = (f: string) => readFileSync(fileURLToPath(new URL('../slices/tracker/' + f, import.meta.url)), 'utf8');
  const scenario = JSON.parse(slice('tracker.scenario.json'));
  const run = (tsx: string) => runProgram({ seed: 0, family: 'tracker', files: { 'App.tsx': tsx, 'App.rx': slice('tracker.rx'), 'api.d.rx': slice('api.d.rx') }, hosts: scenario.host, actions: ['claim'], scenario }, { rust });
  const idiomatic = slice('tracker.tsx');
  const coerced = idiomatic.replace('<b>{unassigned()} open</b>', '<b>{"" + unassigned()} open</b>');
  assert.notEqual(coerced, idiomatic);
  const exact = await run(coerced);
  assert.equal(exact.status, 'agree', exact.classes.join(', '));
  assert.deepEqual(Object.keys(exact.traces!), legs);
  assert.equal(exact.traces!.native!.log.length, 453);
  // `{unassigned()}` inserts the number itself: the host is given 2, not "2". Frames agree; the log differs exactly at
  // that hole's text values, nowhere else.
  const native = await run(idiomatic);
  assert.deepEqual(native.traces!.native!.result, exact.traces!.native!.result);
  const a = native.traces!.native!.log, b = exact.traces!.native!.log;
  assert.equal(a.length, b.length);
  const differing = a.map((e, i) => [e, b[i]] as const).filter(([x, y]) => JSON.stringify(x) !== JSON.stringify(y));
  assert.ok(differing.length > 0);
  // The same entry with the hole's text as a string: createTextNode/replaceText's value, and text nodes in a tree.
  const texts = (t: any): unknown => t.length === 2 ? [t[0], typeof t[1] === 'number' ? String(t[1]) : t[1]] : [t[0], t[1], t[2].map(texts)];
  for (const [x, y] of differing as [any, any][]) {
    assert.ok(['createTextNode', 'replaceText', 'tree'].includes(x[0]), JSON.stringify(x));
    const z = x[0] === 'tree' ? ['tree', texts(x[1])] : x[0] === 'createTextNode' ? [x[0], String(x[1]), x[2]] : [x[0], x[1], String(x[2])];
    assert.deepEqual(z, y);
  }
});

test('plan fuzz: an RX-only difference is upstream only when a probe of that one lowering removes it', async () => {
  assert.equal(pathsInSetter('w$s.path(["a", f(i)], v + 1); x.path(a, b); w$t.path(k);'),
    'w$s.pathIn(() => (["a", f(i)]), () => (v + 1)); x.path(a, b); w$t.path(k);');
  for (const [seed, cls] of [[117, UPSTREAM_RX], [138, UPSTREAM_RX_PATH]] as const) {
    const o = await runCase(generate(seed), { rust });
    assert.equal(o.status, 'upstream', 'seed ' + seed + ': ' + o.classes.join(', '));
    assert.deepEqual(o.classes, [cls]);
    assert.notEqual(JSON.stringify(o.traces!.rx), JSON.stringify(o.traces!.native), 'RX itself differs');
    for (const l of legs.filter(l => l !== 'rx')) assert.equal(JSON.stringify(o.traces![l as 'native']), JSON.stringify(o.traces!.native), l);
  }
});
