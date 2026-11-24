// The todo code is accepted by the eval checker against the page's interface, and refused code stays refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileEval } from '../../../frontend/eval/compile.ts';
import { EDITOR_INTERFACE, INTERFACE } from '../src/interface.ts';

const TODO = readFileSync(new URL('../src/todo.rx', import.meta.url), 'utf8');

test('todo.rx checks against the interface', () => {
  const r = compileEval({ code: TODO, interface: INTERFACE });
  assert.deepEqual(r.ok ? [] : r.diagnostics, []);
});

test('writing the server list from the code is refused', () => {
  const r = compileEval({ code: TODO.replace('let ok = await addTodo(text);', 'db.list[0].done := true;'), interface: INTERFACE });
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.diagnostics.some(d => d.code === 'READ_ONLY'));
});

test('editor.rx checks against the editor interface (plan v2.2: attributes and the input event)', () => {
  const r = compileEval({ code: readFileSync(new URL('../src/editor.rx', import.meta.url), 'utf8'), interface: EDITOR_INTERFACE });
  assert.deepEqual(r.ok ? [] : r.diagnostics, []);
  assert.equal(r.ok && r.plan.version, 2.2);
});

test('an event is read through target.value, typed', () => {
  const r = compileEval({ code: '<textarea onInput={e => { edit(e) }}></textarea>', interface: EDITOR_INTERFACE });
  assert.ok(!r.ok && r.diagnostics.some(d => d.code === 'TYPE'));
});
