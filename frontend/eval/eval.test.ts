// docs/EVAL.md: refusals, the error boundary, the eval site's checks, and the eval fuzz on every leg. The slice itself
// is slices/eval.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { compileEval } from './compile.ts';
import { compileNative, emitPlans, runEvalProgram } from './harness/run.ts';
import { generateEval, generateEvalAsync } from './fuzz/gen.ts';
import { RUST_UNSUPPORTED_CLASS } from '../plan/fuzz/run.ts';
import { runEvalSeed } from './fuzz/run.ts';
import { loadTsxModules } from '../tsx/modules.ts';
import { resolvePlanV2 } from '../plan/resolve-v2.ts';
import { parseInterface, printInterface } from './interface.ts';
import { buildTsx } from '../tsx/build.ts';

const rust = process.env.RUST_PLAN_TRACE;
const IFACE = 'read count: number\nstore db: { list: { id: number, title: string }[] }\naction bump(number)\nhost save(number): string';
const refused = (code: string, syntax: 'rx' | 'tsx' = 'rx', extra: object = {}) => {
  const r = compileEval({ code, interface: IFACE, syntax, ...extra });
  assert.ok(!r.ok, 'accepted: ' + code);
  return r.diagnostics;
};

test('eval refusals: out-of-subset code, ambient scope, a write to a read-only binding, an ordinary async callback', () => {
  // Accepted, for contrast: the code's own state, reads of every binding kind, a bound action, an inferred action.
  for (const [syntax, code] of [
    ['rx', 'source n := 1;\n<p onClick={() => { bump(n) }}>{"" + (n + count + db.list.length)}</p>'],
    ['rx', 'source shown = count;\n<p onClick={() => { optimistic shown := 5; try { let r = await save(count); } catch (e) {} }}>{"" + shown}</p>'],
    ['tsx', 'const [n, setN] = createSignal(1);\nreturn (<p onClick={() => bump(n())}>{"" + (n() + count() + db.list.length)}</p>);'],
  ] as const) { const r = compileEval({ code, interface: IFACE, syntax }); assert.ok(r.ok, syntax + ': ' + JSON.stringify(!r.ok && r.diagnostics)); }
  // Out of the subset: an operator plan v2 lacks, and a constant text hole Solid's compiler would fold.
  assert.deepEqual(refused('<p>{"" + (count * 2)}</p>'), [{ code: 'PLAN', message: 'unsupported operator *' }]);
  assert.equal(refused('<p>{"" + (false ? count : 7)}</p>')[0].code, 'PLAN');
  assert.equal(refused('return (<p>{"" + (count() * 2)}</p>);', 'tsx')[0].code, 'PLAN');
  // Ambient scope: only the bindings and the code's own declarations are in scope, not the enclosing component's
  // other names, not globals, not the module.
  for (const name of ['secret', 'Math', 'window', 'setCount', 'App'])
    assert.deepEqual(refused('<p>{"" + ' + name + '}</p>').map(d => [d.code, d.line]), [['UNBOUND', 1]], name);
  assert.match(refused('source n := 1;\n<p>{"" + n}</p>\n<b>{"" + other}</b>')[0].message, /other is not declared here/);
  assert.deepEqual(refused('<p>{"" + eval}</p>').map(d => d.code), ['EVAL_SITE']);
  assert.equal(refused('source n := 1;\n<p>{"" + n}</p>\n<b>{"" + other}</b>')[0].line, 3);
  assert.equal(refused('return (<p>{"" + secret()}</p>);', 'tsx')[0].code, 'TSX');
  assert.equal(refused('<p>x</p>\n}\nexport component Evil() {\n<p>y</p>')[0].code, 'PLAN');
  assert.ok(refused('<p>x</p>\n}\nimport { x } from "./other";\ncomponent E() {\n<p>y</p>').length);
  // Writes to read-only bindings: a value, a store path, a guess; TSX through the hidden setter.
  for (const code of ['<p onClick={() => { count := 3 }}>x</p>', '<p onClick={() => { db.list[0].title := "z" }}>x</p>',
    'action a() { optimistic count := 1; }\n<p onClick={() => { a() }}>x</p>'])
    assert.deepEqual(refused(code).map(d => [d.code, d.message.split(':')[0]]), [['READ_ONLY', 'writing the read-only binding ' + (code.includes('db') ? 'db' : 'count')]], code);
  assert.deepEqual(refused('source n := 1;\naction a() { n := 2; count := 1; }\n<p onClick={() => { a() }}>x</p>').map(d => [d.code, d.line]), [['READ_ONLY', 2]]);
  assert.equal(refused('return (<p onClick={() => $evalSet0(3)}>x</p>);', 'tsx')[0].code, 'READ_ONLY');
  // Ordinary async callbacks (issue #20): RX's await in a handler that is not an inferred action; TSX's async arrow.
  assert.deepEqual(refused('<p onClick={() => { let r = await save(1); }}>x</p>').map(d => d.code), ['ASYNC_CALLBACK']);
  assert.match(refused('<p onClick={() => { let r = await save(1); }}>x</p>')[0].message, /issues\/20/);
  assert.deepEqual(refused('return (<p onClick={async () => { await save(1); }}>x</p>);', 'tsx').map(d => [d.code, d.line]), [['ASYNC_CALLBACK', 1]]);
  // Types: strict refuses what a consumer would fail on at run time; lenient runs it with warnings; a value eval's
  // declared type is a contract in either mode.
  assert.deepEqual(refused('<p>{"" + (count + true)}</p>').map(d => d.code), ['TYPE']);
  assert.equal(refused('<ul>{for r in db.list { <li>{"" + r.owner}</li> }}</ul>')[0].code, 'TYPE');
  assert.equal(refused('<p onClick={() => { bump("x") }}>x</p>')[0].code, 'TYPE');
  const lenient = compileEval({ code: '<p>{"" + (count + true)}</p>', interface: IFACE, check: 'lenient' });
  assert.ok(lenient.ok && lenient.warnings.length === 1 && lenient.warnings[0].code === 'TYPE');
  assert.equal(refused('count + 1', 'rx', { type: 'string' })[0].code, 'TYPE');
  assert.equal(refused('count + 1', 'rx', { type: 'string', check: 'lenient' })[0].code, 'TYPE');
  const value = compileEval({ code: '"n=" + count', interface: IFACE, type: 'string' });
  assert.ok(value.ok && value.plan.value && !value.plan.markup.length);
  // Malformed requests are refused as INTERFACE.
  assert.equal(compileEval({ code: '<p>x</p>', interface: 'read count number' }).ok, false);
  assert.equal(compileEval({ code: '<p>x</p>', interface: IFACE, syntax: 'yield' as never }).ok, false);
});

test('eval sites: the checker verifies the binding object, the options and the interface', () => {
  const rx = (body: string, decls = '') => 'import { save } from "./api";\nexport default component App() {\n  source count := 0;\n  source code := "<p>x</p>";\n  action bump(n: number) { count := count + n; }\n' + decls + body + '\n}\n';
  const plan = (src: string, tsx = false) => {
    const files: Record<string, string> = { [tsx ? 'App.tsx' : 'App.rx']: src, 'api.d.rx': 'export fn save(n: number): string\n' };
    try { return JSON.stringify(resolvePlanV2(loadTsxModules(tsx ? 'App.tsx' : 'App.rx', p => files[p]))); } catch (e) { return 'refused: ' + (e as Error).message; }
  };
  assert.doesNotMatch(plan(rx('  <div>{eval(code, { count, bump, save })}</div>')), /^refused/);
  for (const [body, why] of [
    ['  <div>{eval(code, { c: count + 1 })}</div>', /a name in scope/],
    ['  <div>{eval(code, { ...count })}</div>', /no spreads/],
    ['  <div>{eval(code, count)}</div>', /object literal/],
    ['  <div>{eval(code, { nope })}</div>', /not a source, memo, action or host import/],
    ['  <div>{eval(code, { count, count })}</div>', /twice/],
    ['  {eval(code, { count })}', /component position/],
    ['  <div>{if count > 0 { <b>x</b> } else { <i>y</i> }}{eval(code, { count }, { preserve: true })}</div>', /preserve .* deferred/],
    ['  <div>{eval(code, { count }, { place: "server" })}</div>', /place .* deferred/],
    ['  <div>{eval(code, { count }, { syntax: "yield" })}</div>', /"yield" is deferred/],
    ['  <div>{eval(code, { count }, { interface: "read count: string" })}</div>', /differs from the one derived/],
    ['  <div onClick={() => { bump(eval(code, { count })) }}>x</div>', /markup child or the whole value of a typed equation/],
    ['  <div>{"" + eval(code, { count })}</div>', /markup child or the whole value of a typed equation/],
  ] as const) assert.match(plan(rx(body)), why, body);
  assert.match(plan(rx('  <div>{for r in [1, 2] { <b>{eval(code, { r })}</b> }}</div>')), /not a source, memo, action or host import/);
  assert.match(plan(rx('  <div>x</div>', '  label = eval(code, { count });\n')), /declares its type/);
  assert.doesNotMatch(plan(rx('  <div>{label}</div>', '  label: string = eval(code, { count });\n')), /^refused/);
  // An explicit interface equal to the derived one (any order, parameter names allowed) is accepted.
  assert.doesNotMatch(plan(rx('  <div>{eval(code, { bump, count }, { interface: "action bump(n: number); read count: number" })}</div>')), /^refused/);
  // TSX: setters and props are not bindings; a value createEval declares its type.
  const tsx = (body: string, setup = '') => 'import { action, createSignal } from "solid-js";\nimport { createEval } from "reactivescript-tsx/eval";\nexport default function App() {\n  const [count, setCount] = createSignal(0);\n  const [code, setCode] = createSignal("<p>x</p>");\n' + setup + '  return (' + body + ');\n}\n';
  assert.doesNotMatch(plan(tsx('<div>{createEval(() => code(), { count })}</div>'), true), /^refused/);
  assert.match(plan(tsx('<div>{createEval(() => code(), { setCount })}</div>'), true), /a setter is not a binding/);
  assert.match(plan(tsx('<div>x</div>', '  const v = createEval(() => code(), { count });\n'), true), /declares \{ type/);
  assert.throws(() => loadTsxModules('App.tsx', p => p === 'App.tsx' ? 'import { evalCode } from "reactivescript-tsx/eval";\nexport default function App() { return <p/>; }\n' : undefined), /createEval/);
  // The upstream compiler has no lowering for eval sites: building one is refused, not compiled as text.
  const files: Record<string, string> = { 'App.rx': rx('  <div>{eval(code, { count })}</div>'), 'api.d.rx': 'export fn save(n: number): string\n' };
  assert.throws(() => buildTsx('App.rx', p => files[p]), /eval sites run on the plan/);
  // The interface grammar round-trips in canonical form.
  assert.equal(printInterface(parseInterface('read a: number; store s: { l: { x: boolean }[] }; action f(id: number, s: string); host h(): string')),
    'read a: number\nstore s: { l: { x: boolean }[] }\naction f(number, string)\nhost h(): string');
});

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
function native(tsx: string, script: unknown[]): Promise<{ frames?: string[]; error?: string }> {
  const dir = mkdtempSync(here('../.out/') + 'eval-boundary-');
  writeFileSync(dir + '/app.mts', compileNative(tsx, 'App.tsx'));
  writeFileSync(dir + '/api.mjs', '\n');
  return new Promise(resolve => {
    const w = new Worker(here('../plan/fuzz/leg.ts'), { workerData: { leg: 'native', entry: dir + '/app.mts', hosts: [], actions: [], script, catchUncaught: true }, execArgv: ['--experimental-strip-types', '--conditions=browser', '--disable-warning=ExperimentalWarning'] });
    w.once('message', m => { void w.terminate(); rmSync(dir, { recursive: true, force: true }); resolve(m.result); });
    w.once('error', e => { rmSync(dir, { recursive: true, force: true }); resolve({ error: String(e) }); });
  });
}

test('eval error boundary: a refusal reaches Errored as a typed EvalRefused, and valid code recovers it', async () => {
  // Errored is outside the TSX frontend's subset, so this program passes its interface itself; createEval checks the
  // bindings against it and compiles each code string at run time.
  mkdirSync(here('../.out/'), { recursive: true });
  const app = (code: string, shown = '"refused " + err().name + " " + err().diagnostics.map((d) => d.code + (d.line ? " line " + d.line : "")).join(", ")') => `import { createSignal, Errored } from "solid-js";
import { createEval } from "reactivescript-tsx/eval";
export default function App() {
  const [code, setCode] = createSignal(${JSON.stringify(code)});
  const [count, setCount] = createSignal(1);
  return (<section>
    <button onClick={() => setCode('<p>{"" + secret}</p>')}>bad</button>
    <button onClick={() => setCode('<p onClick={() => { count := 2 }}>x</p>')}>write</button>
    <button onClick={() => setCode('<p>{"fine " + count}</p>')}>good</button>
    <button onClick={() => setCount(count() + 1)}>inc</button>
    <Errored fallback={(err, reset) => <b onClick={reset}>{${shown}}</b>}>
      <div>{createEval(() => code(), { count }, { interface: "read count: number" })}</div>
    </Errored>
  </section>);
}
`;
  const click = (text: string) => ({ type: 'click', target: { text, index: 0 } });
  const r = await native(app('<p>{"ok " + count}</p>'), [{ type: 'mount' }, click('bad'), click('inc'), click('good'), click('inc'), click('write'), click('refused EvalRefused READ_ONLY line 1'), click('good')]);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.frames, [
    'badwritegoodincok 1',
    'badwritegoodincrefused EvalRefused UNBOUND line 1',
    'badwritegoodincrefused EvalRefused UNBOUND line 1',
    'badwritegoodincfine 2',
    'badwritegoodincfine 3',
    'badwritegoodincrefused EvalRefused READ_ONLY line 1',
    'badwritegoodincrefused EvalRefused READ_ONLY line 1',
    'badwritegoodincfine 3',
  ]);
  // A refused first code reaches the boundary at mount.
  const first = await native(app('<p>{"" + (count * 2)}</p>'), [{ type: 'mount' }, click('good')]);
  assert.deepEqual(first.frames, ['badwritegoodincrefused EvalRefused PLAN', 'badwritegoodincfine 1']);
  // Without a boundary the refusal fails the run with its diagnostics (never a rendered frame).
  const bare = await native(app('<p>ok</p>').replace(/<Errored[^]*?>\n(.*)\n *<\/Errored>/, '$1'), [{ type: 'mount' }, click('bad')]);
  assert.match(bare.error!, /^step 1: reactivity halted: EvalRefused: eval refused: UNBOUND \(line 1\)/);
  // The runtime refuses calls the checker would: no interface, bindings that are not the interface's, deferred options.
  const call = (args: string) => app('<p>ok</p>', 'err().diagnostics[0].code + ": " + err().diagnostics[0].message').replace('createEval(() => code(), { count }, { interface: "read count: number" })', 'createEval(' + args + ')');
  for (const [args, why] of [
    ['() => code(), { count }', /needs its binding interface/],
    ['() => code(), { count, extra: count }, { interface: "read count: number" }', /are not the interface/],
    ['() => code(), { count: 1 }, { interface: "read count: number" }', /is an accessor/],
    ['() => code(), { count }, { interface: "read count: number", preserve: true }', /preserve .* deferred/],
  ] as const) {
    const out = await native(call(args), [{ type: 'mount' }]);
    assert.match(out.frames?.[0] ?? out.error ?? '', /^badwritegoodincINTERFACE: /, args);
    assert.match(out.frames![0], why, args);
  }
});

test('eval fuzz: the static twin, createEval, the plan and Rust agree on generated programs (seeds 1..8)', async () => {
  const legs = rust ? ['static', 'eval-native', 'eval-plan', 'rust'] : ['static', 'eval-native', 'eval-plan'];
  const seen = new Set<string>();
  for (let seed = 1; seed <= 8; seed++) {
    assert.deepEqual(generateEval(seed), generateEval(seed));
    const o = await runEvalSeed(seed, { rust });
    assert.ok(o.status === 'agree' || o.status === 'refused', 'seed ' + seed + ': ' + o.status + ' ' + o.classes.join(', ') + ' ' + (o.detail ?? ''));
    seen.add(o.status + ' ' + o.mode);
    if (o.status === 'refused') {
      // Refused code is the plan fuzz's refusal of the same program, and every eval leg fails with it.
      assert.ok(o.baseRefusal && o.detail!.endsWith(': ' + o.baseRefusal));
      continue;
    }
    assert.deepEqual(Object.keys(o.traces!), legs);
    for (const l of legs) assert.equal(JSON.stringify(o.traces![l as 'static']), JSON.stringify(o.traces!.static), 'seed ' + seed + ' ' + l);
    assert.ok(o.traces!.static!.log.length > 50 && 'frames' in o.traces!.static!.result);
    const emitted = emitPlans(generateEval(seed).files);
    assert.ok('plan' in emitted && JSON.stringify(JSON.parse(emitted.plan)) === JSON.stringify(o.plan));
  }
  assert.ok(seen.has('agree split') && seen.has('agree whole') && seen.has('refused split'), [...seen].join(', '));
});

test('eval harness: a leg that differs from the static twin is divergent, never agreement', async () => {
  // The static twin shows a different number than the code: the evaluated legs differ, and the harness says so.
  const files: Record<string, string> = {
    'App.rx': 'export default component App() {\n  source n := 1;\n  <main>{eval("<p>{\\"\\" + n}</p>", { n })}</main>\n}\n',
    'App.tsx': 'import { createSignal } from "solid-js";\nimport { createEval } from "reactivescript-tsx/eval";\nexport default function App() {\n  const [n, setN] = createSignal(1);\n  return (<main>{createEval(() => "<p>{\\"\\" + n}</p>", { n })}</main>);\n}\n',
    'Static.tsx': 'import { createSignal, Show } from "solid-js";\nexport default function App() {\n  const [n, setN] = createSignal(1);\n  function Inner() { return <p>{"" + (n() + 1)}</p>; }\n  return (<main>{(() => <Show when={"x"} keyed>{() => <Inner />}</Show>)()}</main>);\n}\n',
    'api.d.rx': '',
  };
  const o = await runEvalProgram({ name: 'divergent', files, hosts: [], script: [{ type: 'mount' } as never] }, { rust });
  assert.equal(o.status, 'divergent');
  assert.ok(o.classes.includes('eval-native: result') && o.classes.includes('eval-plan: result'), o.classes.join(', '));
});

// Plan v2.1 (docs/EVAL.md, "Async data"): evaluated code may load data through a pure host binding, with Loading,
// Errored, isPending, latest, refresh and affects, and an enclosing v2.1 program may hold eval sites.
const AIFACE = 'read page: number\npure host loadRows(number): { id: number, title: string }[]\nhost save(number): string';
test('eval v2.1: pure host bindings, async code in RX and TSX, v2 plans byte for byte, and its refusals', () => {
  // The interface grammar: `pure host` with a structured result, printed canonically and compared by type.
  const ds = parseInterface('pure host loadRows(n: number): {id: number,title: string}[]\nhost save(number): string');
  assert.equal(printInterface(ds), 'pure host loadRows(number): { id: number, title: string }[]\nhost save(number): string');
  assert.throws(() => parseInterface('host save(number): strin'), /type: number, string, boolean/);
  const rx = 'rows = await loadRows(page);\nsource status := "";\naction take(id: number) {\n  affects rows;\n  try {\n    let r = await save(id);\n    refresh rows;\n    status := r;\n  } catch (e) {\n    status := "failed";\n  }\n}\n' +
    '<div>{errored fallback { <p>failed<button onClick={() => { refresh rows }}>retry</button></p> } { loading fallback { <i>wait</i> } { <b>{(pending? rows) ? "saving" : "ready"}</b>{for row in rows { <p>{row.title}<button onClick={() => { take(row.id) }}>take</button></p> }} } }}<em>{status}</em></div>';
  const tsx = 'const rows = createMemo(() => loadRows(page()));\nconst [status, setStatus] = createSignal("");\nconst take = action(function* (id: number) {\n  affects(rows);\n  try {\n    const r: string = yield save(id);\n    refresh(rows);\n    setStatus(r);\n  } catch (e) {\n    setStatus("failed");\n  }\n});\n' +
    'return (<div><Errored fallback={() => <p>failed<button onClick={() => refresh(rows)}>retry</button></p>}><Loading fallback={<i>wait</i>}><b>{"" + (isPending(() => rows()) ? "saving" : "ready")}</b><For each={rows()}>{(row) => <p>{row.title}<button onClick={() => take(row.id)}>take</button></p>}</For></Loading></Errored><em>{status()}</em></div>);';
  const plans = ([['rx', rx], ['tsx', tsx]] as const).map(([syntax, code]) => { const r = compileEval({ code, interface: AIFACE, syntax }); assert.ok(r.ok, syntax + ': ' + JSON.stringify(!r.ok && r.diagnostics)); return r.ok ? r.plan : undefined; });
  assert.deepEqual(plans[1], plans[0], 'RX and TSX code compile to one plan');
  assert.equal(plans[0]!.version, 2.1);
  assert.deepEqual(plans[0]!.hosts, [{ name: 'loadRows', params: ['number'], returns: '{ id: number, title: string }[]', pure: true }, { name: 'save', params: ['number'], returns: 'string' }]);
  assert.deepEqual(plans[0]!.memos, [{ name: 'rows', await: { host: 'loadRows', args: [{ op: 'read', source: 'page' }] } }]);
  // Code without async forms keeps its v2 plan; a pure or structured host binding alone makes it v2.1.
  const plain = compileEval({ code: '<p>{"" + count}</p>', interface: IFACE });
  assert.ok(plain.ok && plain.plan.version === 2);
  const hosted = compileEval({ code: '<p>{"" + page}</p>', interface: AIFACE });
  assert.ok(hosted.ok && hosted.plan.version === 2.1);
  // Refusals: an impure host in reactive scope (the checker's IO-2), a refresh of a binding (READ_ONLY), a read of the
  // async memo in a handler, a type error over the structured result.
  const no = (code: string, iface = AIFACE) => { const r = compileEval({ code, interface: iface }); assert.ok(!r.ok, code); return r.diagnostics.map(d => d.code + ' ' + d.message).join('; '); };
  assert.match(no('rows = await loadRows(page);\n<div>{errored fallback { <p>x</p> } { loading fallback { <i>w</i> } { <b>{"" + rows.length}</b> } }}</div>', AIFACE.replace('pure host', 'host')), /IO_IN_REACTIVE/);
  assert.equal(no('<p onClick={() => { refresh page }}>x</p>'), 'CHECK INVALID_REFRESH_TARGET: page has no question to re-ask');
  assert.match(no('rows = await loadRows(page);\nsource s := 0;\n<div>{errored fallback { <p>x</p> } { loading fallback { <i>w</i> } { <b onClick={() => { s := rows.length }}>{"" + s}</b> } }}</div>'), /async memo is read only in reactive contexts/);
  assert.match(no('rows = await loadRows(page);\n<div>{errored fallback { <p>x</p> } { loading fallback { <i>w</i> } { <ul>{for row in rows { <li>{row.owner}</li> }}</ul> } }}</div>'), /^TYPE markup: no field owner in \{ id: number, title: string \}$/);
});

test('eval fuzz v2.1: the static twin, createEval, the plan and Rust agree on generated async programs (seeds 1..8)', async () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 8; seed++) {
    assert.deepEqual(generateEvalAsync(seed), generateEvalAsync(seed));
    const o = await runEvalSeed(seed, { rust, async: true });
    seen.add(o.status + ' ' + o.mode);
    if (o.status === 'refused') { assert.ok(o.baseRefusal && o.detail!.endsWith(': ' + o.baseRefusal)); continue; }
    // Rust consumes the v2.1 plans with the host's eval table: compared like every other leg.
    assert.equal(o.status, 'agree', 'seed ' + seed + ': ' + o.classes.join(', ') + ' ' + (o.detail ?? ''));
    assert.ok(!o.classes.includes(RUST_UNSUPPORTED_CLASS), 'a Rust refusal of the version is not agreement');
    assert.deepEqual(o.classes, []);
    assert.deepEqual(Object.keys(o.traces!), rust ? ['static', 'eval-native', 'eval-plan', 'rust'] : ['static', 'eval-native', 'eval-plan']);
    for (const l of rust ? ['eval-native', 'eval-plan', 'rust'] as const : ['eval-native', 'eval-plan'] as const) assert.equal(JSON.stringify(o.traces![l]), JSON.stringify(o.traces!.static), 'seed ' + seed + ' ' + l);
    assert.equal(o.scenario!.version, 2.1);
  }
  assert.ok([...seen].some(k => k.endsWith('split')) && [...seen].some(k => k.endsWith('whole')), [...seen].join(', '));
});
