// Plan v2.3, composition (PLAN-V2.md, "v2.3: composition"): element attributes, components of the entry's module,
// their props and children. The plan fuzz (plan-fuzz.test.ts) checks that every leg runs these forms as native Solid does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadTsxModules } from '../tsx/modules.ts';
import { resolvePlanV2 } from './resolve-v2.ts';

const plan = (src: string, compose = true) => resolvePlanV2(loadTsxModules('App.tsx', p => (p === 'App.tsx' ? src : undefined), { compose }), { compose });
const app = (components: string, view: string) => `import { createSignal } from "solid-js";

${components}

export default function App() {
  const [s, setS] = createSignal("a");
  return ${view};
}
`;
const badge = `function Badge(props: { label: string; onPick: (x: number) => void }) {
  return <li class="badge" title={props.label} onClick={() => props.onPick(2)}>{"" + props.label}</li>;
}`;

test('plan v2.3: a program with no composition form emits the same plan with the option on', () => {
  const tsx = fileURLToPath(new URL('../slices/like/like.tsx', import.meta.url));
  const read = (p: string) => { try { return readFileSync(p, 'utf8'); } catch { return undefined; } };
  assert.deepEqual(resolvePlanV2(loadTsxModules(tsx, read, { compose: true }), { compose: true }), resolvePlanV2(loadTsxModules(tsx, read)));
});

test('plan v2.3: a static attribute is a literal, a dynamic one an expression, both in source order', () => {
  const p = plan(app('', '<p class="x" title={s()} data-n={2}>w</p>'));
  assert.equal(p.version, 2.3);
  assert.deepEqual(p.markup[0], { kind: 'element', tag: 'p', attrs: [
    { name: 'class', value: { op: 'literal', value: 'x' } },
    { name: 'title', value: { op: 'read', source: 's' } },
    { name: 'data-n', value: { op: 'literal', value: 2 } },
  ], events: [], children: [{ kind: 'text', value: { op: 'literal', value: 'w' } }] });
});

test('plan v2.3: a component declares its props by use and reads them with prop', () => {
  const p = plan(app(badge, '<ul><Badge label={s()} onPick={(x: number) => setS("p" + x)} /></ul>'));
  const [c] = p.components!;
  assert.deepEqual(c.props, [{ name: 'label', kind: 'value' }, { name: 'onPick', kind: 'function' }]);
  const li = c.markup[0];
  assert.ok(li.kind === 'element');
  assert.deepEqual(li.attrs!.map(a => a.name), ['class', 'title', 'onClick']);
  assert.deepEqual(li.attrs![1], { name: 'title', value: { op: 'prop', name: 'label' } });
  assert.deepEqual(li.attrs![2], { name: 'onClick', steps: [{ op: 'call', prop: 'onPick', args: [{ op: 'literal', value: 2 }] }] });
});

test('plan v2.3: a site passes a value prop as an expression and a callback with its parameters', () => {
  const p = plan(app(badge, '<ul><Badge label={s()} onPick={(x: number) => setS("p" + x)} /></ul>'));
  const ul = p.markup[0];
  assert.ok(ul.kind === 'element');
  assert.deepEqual(ul.children[0], { kind: 'component', name: 'Badge', props: [
    { name: 'label', value: { op: 'read', source: 's' } },
    { name: 'onPick', handler: { params: ['x'], steps: [{ op: 'write', source: 's', value: { op: 'add', left: { op: 'literal', value: 'p' }, right: { op: 'local', name: 'x' } } }] } },
  ] });
});

test('plan v2.3: children are a children view in the component and views at the site', () => {
  const panel = 'function Panel(props: { children: JSX.Element }) {\n  return <section>{props.children}</section>;\n}';
  const p = plan(app(panel, '<div><Panel><b>k</b></Panel></div>'));
  assert.deepEqual(p.components![0].markup[0], { kind: 'element', tag: 'section', events: [], children: [{ kind: 'children' }] });
  const div = p.markup[0];
  assert.ok(div.kind === 'element' && div.children[0].kind === 'component');
  assert.deepEqual(div.children[0].children, [{ kind: 'element', tag: 'b', events: [], children: [{ kind: 'text', value: { op: 'literal', value: 'k' } }] }]);
});

test('plan v2.3: a component the entry never applies is left out of the plan', () => {
  const unused = 'function Unused(props: { x: string }) {\n  return <p>{"" + props.x}</p>;\n}';
  const p = plan(app(badge + '\n\n' + unused, '<ul><Badge label={s()} onPick={(x: number) => setS("p" + x)} /></ul>'));
  assert.deepEqual(p.components!.map(c => c.name), ['Badge']);
});

test('plan v2.3: without the compose option a second component is refused', () => {
  assert.throws(() => plan(app(badge, '<ul><Badge label={s()} onPick={(x: number) => setS("p" + x)} /></ul>'), false));
});

// The TSX subset refuses these two before the plan does; RX (and the React frontend) reach the plan's own check.
const rxPlan = (src: string) => resolvePlanV2(loadTsxModules('App.rx', p => (p === 'App.rx' ? src : undefined)), { compose: true });

test('plan v2.3: a component that applies itself is refused', () => {
  assert.throws(() => rxPlan('component Loop(props) {\n  <span><Loop n={props.n} /></span>\n}\n\nexport default component App() {\n  <div><Loop n={1} /></div>\n}\n'),
    /recursive components are outside plan v2.3: App -> Loop -> Loop/);
});

test('plan v2.3: a site that omits a prop the component reads is refused', () => {
  assert.throws(() => rxPlan('component Pair(props) {\n  <p>{props.label}{props.extra}</p>\n}\n\nexport default component App() {\n  <div><Pair label={"a"} /></div>\n}\n'),
    /reads the prop extra, which a site does not pass/);
});
