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

test('the draft input and its guard: the add button is disabled on an empty draft (Enter clicks it only when enabled)', () => {
  assert.match(TODO, /<input value=\{draft\}/);
  assert.match(TODO, /<button disabled=\{draft == ""\} onClick=\{\(\) => \{ add\(draft\) \}\}>/);
});

test('a guard written as an if statement in a handler is refused (plan v2 has no conditional step)', () => {
  const r = compileEval({ code: TODO.replace('onClick={() => { add(draft) }}', 'onClick={() => { if (draft != "") { add(draft) } }}'), interface: INTERFACE });
  assert.ok(!r.ok && r.diagnostics.some(d => /unsupported step sif/.test(d.message)));
});

// Each snippet declares its bindings in a header (`// @eval`, then `// @bind <declaration>` lines) for the IDE; the
// host's interface is the contract, and the header must say the same.
import { parseInterface, sameInterface } from '../../../frontend/eval/interface.ts';
import { EDITOR_INTERFACE as EDITOR_I, INVENTORY_INTERFACE as INVENTORY_I, INTERFACE as TODO_I } from '../src/interface.ts';
const header = (text: string) => {
  const lines = text.split('\n');
  assert.equal(lines[0], '// @eval');
  return lines.slice(1).filter(l => l.startsWith('// @bind ')).map(l => l.slice('// @bind '.length)).join('\n');
};
for (const [file, iface] of [['todo.rx', TODO_I], ['editor.rx', EDITOR_I], ['inventory.rx', INVENTORY_I]] as const)
  test(file + '\'s @bind header is the host\'s interface', () => {
    const text = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
    assert.ok(sameInterface(parseInterface(header(text)), parseInterface(iface)));
  });
