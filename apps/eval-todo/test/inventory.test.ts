// The inventory admin is accepted by the eval checker against its interface; the v2.2 event is typed per element; and
// each refusal FINDINGS.md quotes is still what the checker says (if one starts passing, the finding is stale).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileEval } from '../../../frontend/eval/compile.ts';
import { bindEval } from '../../../frontend/eval/runtime.ts';
import * as strings from '../../../frontend/upstream/ref/compile/string-renderer.ts';
import { INVENTORY_INTERFACE } from '../src/interface.ts';

const INVENTORY = readFileSync(new URL('../src/inventory.rx', import.meta.url), 'utf8');
const diagnostics = (code: string, iface = 'read n: number\naction go(string)') => {
  const r = compileEval({ code, interface: iface });
  return r.ok ? [] : r.diagnostics.map(d => d.code + ': ' + d.message);
};

test('inventory.rx checks against its interface, as a v2.2 plan', () => {
  const r = compileEval({ code: INVENTORY, interface: INVENTORY_INTERFACE });
  assert.deepEqual(r.ok ? [] : r.diagnostics, []);
  assert.equal(r.ok && r.plan.version, 2.2);
});

test('writing the server store from the inventory code is refused', () => {
  const r = compileEval({ code: INVENTORY.replace('let ok = await removeItem(id);', 'inv.items[0].qty := 1;'), interface: INVENTORY_INTERFACE });
  assert.ok(!r.ok && r.diagnostics.some(d => d.code === 'READ_ONLY'));
});

test('the event: an <input> has value and checked, a <select> or <textarea> value only, any other element neither', () => {
  assert.deepEqual(diagnostics('source b := false; <input type="checkbox" checked={b} onChange={e => { b := e.target.checked }} />'), []);
  assert.deepEqual(diagnostics('source s := ""; <select value={s} onChange={e => { s := e.currentTarget.value }}><option value="a">a</option></select>'), []);
  assert.match(diagnostics('source b := false; <select onChange={e => { b := e.target.checked }}></select>').join(), /TYPE: select onChange: no field checked/);
  assert.match(diagnostics('source s := ""; <div onClick={e => { s := e.target.value }}>{s}</div>').join(), /TYPE: div onClick: no field value/);
  assert.match(diagnostics('source s := ""; <input onKeyDown={e => { s := e.key }} />').join(), /TYPE: input onKeyDown: no field key/);
});

test('an attribute is set after the element\'s children are in place (a <select>\'s value needs its options)', () => {
  const calls: string[] = [];
  const renderer = {
    ...strings,
    setProp(node: { tag: string; children: unknown[]; props: Record<string, unknown> }, name: string, value: unknown) {
      calls.push(node.tag + ' ' + name + '=' + value + ' with ' + node.children.length + ' children');
      node.props[name] = value;
    },
  } as never;
  const createEval = bindEval({ renderer });
  const root = { kind: 'el', tag: 'root', children: [], props: {} };
  const code = 'source s := "b"; <select value={s} onChange={e => { s := e.target.value }}><option value="a">a</option><option value="b">b</option></select>';
  const dispose = strings.render(() => createEval(() => code, {}, { interface: '' }), root);
  assert.deepEqual(calls.filter(c => c.startsWith('select')), ['select value=b with 2 children']);
  dispose?.();
});

// FINDINGS.md's repros, each with the refusal it quotes.
const refusals: [string, string, RegExp][] = [
  ['an if statement in a handler', 'source s := ""; <button onClick={() => { if (s != "") { go(s) } }}>go</button>', /PLAN: unsupported step sif/],
  ['the markup if spelling in a handler', 'source s := ""; <button onClick={() => { if s != "" { go(s) } }}>go</button>', /PARSE: .*expected '\}'/],
  ['a negative literal', 'x = n == -1; <p>{x ? "a" : "b"}</p>', /PLAN: unsupported operator -/],
  ['a string comparison', 'source a := "x"; <p>{a < "y" ? "a" : "b"}</p>', /TYPE: .*comparison of string and string/],
  ['indexOf of a value', 'source l := ["a"]; <p>{"" + indexOf(l, "a")}</p>', /PLAN: a builtin or updater takes one \(x\) => expression/],
  ['a substring test', 'source a := "abc"; <p>{"" + a.includes("b")}</p>', /PLAN: unsupported call/],
  ['sort', 'source l := [2, 1]; <p>{"" + sort(l, x => x).length}</p>', /UNBOUND: .*sort is not declared/],
  ['a sum', 'source l := [1, 2]; <p>{"" + reduce(l, x => x)}</p>', /UNBOUND: .*reduce is not declared/],
  ['an object spread', 'source base := [{ a: 1, b: 2 }]; source l = base; action f() { guess l := xs => map(xs, x => { ...x, a: 2 }); } <p>{"" + l.length}</p>', /PLAN: object spreads are outside plan v2/],
  ['a component tag', '<Row />', /CHECK: .*<Row> is not a component declared here/],
  ['an action calling an action', 'source c := 0; action a() { c := c + 1; } action b() { a(); } <button onClick={() => { b() }}>b</button>', /PLAN: an action calling an action/],
];
for (const [what, code, want] of refusals)
  test('finding: ' + what + ' is refused', () => assert.match(diagnostics(code).join(' | '), want));
