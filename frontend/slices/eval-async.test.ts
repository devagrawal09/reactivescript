// The async eval slice (docs/EVAL.md, "Async data"): slices/eval-async/, plan v2.1 inside and around evaluated code.
// One code string loads its own data through a pure host binding (an async memo, Errored, Loading, isPending, affects,
// refresh after an await); one reads the enclosing component's async memo through a read binding, under the enclosing
// Errored; one is TSX-syntax code with an async memo of its own. The code switches while a request is pending (the
// subtree is disposed and the request settled after), the enclosing memo rejects and is retried, the code's own memo
// rejects and is retried, and a mutation rejects. The evaluated legs (createEval, the plan both frontends emit on
// solid-plan.ts) and Rust's plan-trace with the host's eval table must give the static twin's frames and full host log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emitPlans, evalTable, runEvalProgram } from '../eval/harness/run.ts';
import { injectInterfaces } from '../eval/inject.ts';
import { RUST_UNSUPPORTED_CLASS } from '../plan/fuzz/run.ts';
import { slice, sliceFiles, sliceHosts } from './eval-async/load.ts';

const rust = process.env.RUST_PLAN_TRACE;

test('eval-async slice: eval-async.rx and eval-async.tsx emit one v2.1 plan (eval-async.plan.json) with pure host and async memo bindings', () => {
  const emitted = emitPlans(sliceFiles(), true);
  assert.ok('plan' in emitted, 'error' in emitted ? emitted.error : '');
  assert.equal(emitted.plan + '\n', slice('eval-async.plan.json'));
  const plan = JSON.parse(emitted.plan);
  assert.equal(plan.version, 2.1);
  assert.deepEqual(plan.memos, [{ name: 'list', await: { host: 'loadIssues', args: [] } }]);
  const sites: { kind: string; bindings: unknown; interface: string; syntax: string }[] = [];
  const walk = (v: { kind: string; children?: unknown[] }) => { if (v.kind === 'eval') sites.push(v as never); (v.children ?? []).forEach(c => walk(c as never)); };
  plan.markup.forEach(walk);
  assert.deepEqual(sites.map(s => [s.syntax, s.bindings, s.interface]), [
    ['rx', [{ name: 'list', target: 'list' }, { name: 'loadIssues', target: 'loadIssues' }, { name: 'assignIssue', target: 'assignIssue' }],
      'read list: { id: number, title: string, owner: string }[]\npure host loadIssues(): { id: number, title: string, owner: string }[]\nhost assignIssue(number): string'],
    ['tsx', [{ name: 'loadIssues', target: 'loadIssues' }], 'pure host loadIssues(): { id: number, title: string, owner: string }[]'],
  ]);
  // The enclosing Errored around the first site is in the plan; the frontend writes each derived interface into
  // eval-async.tsx's createEval calls and changes nothing else.
  assert.ok(JSON.stringify(plan.markup).includes('"kind":"errored"'));
  const injected = injectInterfaces('App.tsx', f => sliceFiles()[f], { async: true });
  assert.equal(injected.replace(/, \{ interface: "(?:[^"\\]|\\.)*" \}\)/g, ')').replace(/ interface: "(?:[^"\\]|\\.)*",/g, ''), slice('eval-async.tsx'));
  assert.equal((injected.match(/interface: /g) ?? []).length, 2);
});

test('eval-async slice: the static twin, createEval, the plan and Rust give one result and one host log as code changes', async () => {
  const saved = JSON.parse(slice('eval-async.scenario.json'));
  assert.equal(saved.version, 2.1);
  // Recorded again on the static twin, the scenario's frames are the saved ones.
  const recorded = await runEvalProgram({ name: saved.name, files: sliceFiles(), hosts: sliceHosts, script: saved.steps, async: true }, { rust });
  assert.equal(recorded.status, 'agree', recorded.classes.join(', '));
  assert.deepEqual({ ...recorded.scenario, fixture: 'eval-async' }, saved);
  // Replayed: every leg equals the static twin, frames and full host log, Rust's plan-trace included (a refusal of
  // the v2.1 plans, rust-unsupported, fails).
  const o = await runEvalProgram({ name: saved.name, files: sliceFiles(), hosts: sliceHosts, scenario: saved, async: true }, { rust });
  assert.equal(o.status, 'agree', o.classes.join(', '));
  assert.ok(!o.classes.includes(RUST_UNSUPPORTED_CLASS), 'a Rust refusal of the version is not agreement');
  assert.deepEqual(o.classes, []);
  assert.deepEqual(Object.keys(o.traces!), rust ? ['static', 'eval-native', 'eval-plan', 'rust'] : ['static', 'eval-native', 'eval-plan']);
  for (const l of rust ? ['eval-native', 'eval-plan', 'rust'] as const : ['eval-native', 'eval-plan'] as const) assert.equal(JSON.stringify(o.traces![l]), JSON.stringify(o.traces!.static), l);
  assert.equal(o.traces!.static!.log.length, 295);
  const frames = saved.steps.map((s: { frame: string }) => s.frame);
  assert.deepEqual((o.traces!.static!.result as { frames: string[] }).frames, frames);
  // Every code string was evaluated, each to a v2.1 plan (an async memo, or a pure host binding), and the table is
  // exactly what the plan leg compiled (eval-async.evals.json), each entry compiled again.
  const programs = JSON.parse(slice('programs.json')) as Record<string, string>;
  assert.deepEqual(o.table!.evals.map(e => e.code).sort(), Object.values(programs).sort());
  assert.ok(o.table!.evals.every(e => 'plan' in e && e.plan.version === 2.1));
  assert.equal(JSON.stringify(o.table, null, 2) + '\n', slice('eval-async.evals.json'));
  assert.deepEqual(evalTable(o.table!.evals.map(e => { const r: Record<string, unknown> = { ...e }; delete r.plan; delete r.refused; return r as never; })), o.table);
  // What the frames show: the code's own Loading, its pending indicator, the enclosing memo read through a binding (its
  // Loading, then its rejection in the enclosing Errored and the retry), the code's own rejection and retry, a rejected
  // mutation, and the TSX-syntax code's count.
  for (const want of ['reloadLoadingcounting', 'savingCrash: nobodytake', 'outer loading', 'idleDocs3 issues', 'list failedagain', 'idleDocsLeak', 'Could not loadretry', 'Could not assign #2', 'reload3 issues'])
    assert.ok(frames.some((f: string) => f.includes(want)), want);
});
