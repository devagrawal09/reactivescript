// The eval slice (docs/EVAL.md, "Gate"): slices/eval/, code strings that change over time. The program is written in
// RX (eval.rx), in Solid TSX with createEval (eval.tsx), and as its static twin (eval.static.tsx: every code string a
// native component, each eval site the keyed Show createEval is specified as). The evaluated legs must give the static
// twin's frames and full host log: createEval compiled by Solid's transform, the plan both frontends emit on
// solid-plan.ts, and (with RUST_PLAN_TRACE) the same plan on rust-solid's plan-trace with the host's eval table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emitPlans, runEvalProgram, evalTable } from '../eval/harness/run.ts';
import { injectInterfaces } from '../eval/inject.ts';
import { slice, sliceFiles, sliceHosts } from './eval/load.ts';

const rust = process.env.RUST_PLAN_TRACE;
const legs = rust ? ['static', 'eval-native', 'eval-plan', 'rust'] : ['static', 'eval-native', 'eval-plan'];

test('eval slice: eval.rx and eval.tsx emit one plan (eval.plan.json); its eval nodes carry the derived interfaces', () => {
  const emitted = emitPlans(sliceFiles());
  assert.ok('plan' in emitted, 'error' in emitted ? emitted.error : '');
  assert.equal(emitted.plan + '\n', slice('eval.plan.json'));
  const plan = JSON.parse(emitted.plan);
  const label = plan.memos.find((m: { name: string }) => m.name === 'label');
  assert.deepEqual({ op: label.value.op, type: label.value.type, interface: label.value.interface }, { op: 'eval', type: 'string', interface: 'read count: number' });
  const sites: { kind: string; bindings: unknown; interface: string; syntax: string }[] = [];
  const walk = (v: { kind: string; children?: unknown[] }) => { if (v.kind === 'eval') sites.push(v as never); (v.children ?? []).forEach(c => walk(c as never)); };
  plan.markup.forEach(walk);
  assert.deepEqual(sites.map(s => [s.syntax, s.bindings, s.interface]), [
    ['rx', [{ name: 'count', target: 'count' }, { name: 'bump', target: 'bump' }, { name: 'store', target: 'store' }, { name: 'save', target: 'save' }],
      'read count: number\naction bump(number)\naction store(number)\nhost save(number): string'],
    ['tsx', [{ name: 'n', target: 'count' }, { name: 'bump', target: 'bump' }], 'read n: number\naction bump(number)'],
  ]);
  // The frontend writes each derived interface into eval.tsx's createEval call, and changes nothing else.
  const injected = injectInterfaces('App.tsx', f => sliceFiles()[f]);
  assert.equal(injected.replace(/ interface: "(?:[^"\\]|\\.)*",?/g, '').replace(/, \{ \}\)/g, ')').replace(/\{  /g, '{ '), slice('eval.tsx'));
  assert.equal((injected.match(/interface: /g) ?? []).length, 3);
});

test('eval slice: the static twin, createEval, the plan and Rust give one result and one host log as code changes', async () => {
  const saved = JSON.parse(slice('eval.scenario.json'));
  // Recorded again on the static twin, the scenario's frames are the saved ones.
  const recorded = await runEvalProgram({ name: saved.name, files: sliceFiles(), hosts: sliceHosts, script: saved.steps }, { rust });
  assert.equal(recorded.status, 'agree', recorded.classes.join(', '));
  assert.deepEqual({ ...recorded.scenario, fixture: 'eval' }, saved);
  // Replayed: every leg equals the static twin, frames and full host log.
  const o = await runEvalProgram({ name: saved.name, files: sliceFiles(), hosts: sliceHosts, scenario: saved }, { rust });
  assert.equal(o.status, 'agree', o.classes.join(', '));
  assert.deepEqual(Object.keys(o.traces!), legs);
  for (const l of legs) assert.equal(JSON.stringify(o.traces![l as 'static']), JSON.stringify(o.traces!.static), l);
  assert.equal(o.traces!.static!.log.length, 363);
  assert.deepEqual((o.traces!.static!.result as { frames: string[] }).frames, saved.steps.map((s: { frame: string }) => s.frame));
  // The code strings did change: every program was evaluated, the empty one rendered nothing, and the host's table is
  // exactly what the plan leg compiled (eval.evals.json), each entry compiled again.
  const programs = JSON.parse(slice('programs.json')) as Record<string, string>;
  assert.deepEqual(o.table!.evals.map(e => e.code).sort(), Object.values(programs).sort());
  assert.equal(JSON.stringify(o.table, null, 2) + '\n', slice('eval.evals.json'));
  assert.deepEqual(evalTable(o.table!.evals.map(e => { const r: Record<string, unknown> = { ...e }; delete r.plan; delete r.refused; return r as never; })), o.table);
  const frames = saved.steps.map((s: { frame: string }) => s.frame);
  assert.ok(frames.some((f: string) => f.includes('clicks 1')) && frames.some((f: string) => f.includes('saved saving')) && frames.some((f: string) => f.includes('a21b21big')));
  assert.ok(frames.some((f: string) => /formulatenn is 21/.test(f)), 'the empty code string renders nothing');
});
