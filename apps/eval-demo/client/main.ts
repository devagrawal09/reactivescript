// The page: the bindings, the evaluated result of the selected history entry, its errors, and the history.
import { createRoot, createSignal, createMemo, Errored, For, Loading, Show } from 'solid-js';
import { bindEval, compileOrThrow, EvalRefused } from '../../../frontend/eval/runtime.ts';
import type { EvalCompile, Renderer } from '../../../frontend/plan/solid-plan.ts';
import { INTERFACE } from '../src/interface.ts';
import type { Diagnostic, Entry } from '../src/history.ts';
import { renderer, h } from './dom.ts';
import { createBindings } from './bindings.ts';

// RX code is checked and compiled here in the page (frontend → pinned checker → plan). TSX lowering needs Oxc, a native
// module, so TSX code runs from the plan the server compiled when it was posted (the host's eval table, as on Rust).
const serverPlans = new Map<string, Entry>();
const tableKey = (code: string, type?: string) => JSON.stringify([code, type ?? null]);
const compile: EvalCompile = req => {
  if (req.syntax === 'rx') return compileOrThrow(req);
  const e = serverPlans.get(tableKey(req.code, req.type));
  if (e?.plan) return e.plan as ReturnType<EvalCompile>;
  throw new EvalRefused(e?.diagnostics.length ? e.diagnostics : [{ code: 'INTERFACE', message: 'no server plan for this TSX code' }]);
};
const createEval = bindEval({ renderer: renderer as unknown as Renderer, compile });
const remember = (e: Entry) => { if (e.syntax === 'tsx') serverPlans.set(tableKey(e.code, e.type), e); };
const C = renderer.createComponent as (c: unknown, p: object) => Node;

function diagnosticsOf(err: unknown): Diagnostic[] {
  const e = err as Partial<EvalRefused> & { message?: string };
  return Array.isArray(e?.diagnostics) ? e.diagnostics : [{ code: 'RUNTIME', message: String(e?.message ?? err) }];
}
const errorPanel = (title: string, ds: Diagnostic[]) => h('div', { class: 'errors' }, h('h3', {}, title),
  h('ul', {}, ds.map(d => h('li', {}, h('b', {}, d.code), d.line !== undefined ? ' line ' + d.line : '', ': ' + d.message))));

createRoot(() => {
  const b = createBindings();
  const bindings = { count: b.count, increment: b.increment, todos: b.todos, addTodo: b.addTodo, toggleTodo: b.toggleTodo, fetchUser: b.fetchUser };

  const [entries, setEntries] = createSignal<Entry[]>([]);
  const [selectedId, setSelectedId] = createSignal<number | undefined>(undefined);
  const [follow, setFollow] = createSignal(true);
  const [live, setLive] = createSignal(false);
  const selected = createMemo(() => entries().find(e => e.id === selectedId()));

  const events = new EventSource('/events');
  events.onopen = () => setLive(true);
  events.onerror = () => setLive(false);
  events.addEventListener('history', ev => {
    const list = JSON.parse((ev as MessageEvent).data) as Entry[];
    list.forEach(remember);
    setEntries(list);
    if (follow() || selectedId() === undefined) setSelectedId(list.at(-1)?.id);
  });
  events.addEventListener('entry', ev => {
    const e = JSON.parse((ev as MessageEvent).data) as Entry;
    remember(e);
    setEntries(list => [...list, e]);
    if (follow()) setSelectedId(e.id);
  });
  const step = (d: number) => {
    const list = entries(), i = list.findIndex(e => e.id === selectedId());
    const next = list[Math.min(list.length - 1, Math.max(0, i + d))];
    if (next) { setFollow(false); setSelectedId(next.id); }
  };

  // One evaluation per entry: a new entry disposes the old code's subtree (its own state) and keeps the bindings'.
  const result = (e: Entry) => {
    const options = { interface: INTERFACE, syntax: e.syntax, ...(e.type ? { type: e.type } : {}) };
    if (e.type) {
      const value = createEval(() => e.code, bindings, options) as () => unknown;
      return h('output', { class: 'value' }, () => JSON.stringify(value()));
    }
    return h('div', { class: 'markup' }, () => createEval(() => e.code, bindings, options));
  };

  const page = h('main', {},
    h('header', {}, h('h1', {}, 'ReactiveScript eval'), h('span', { class: () => live() ? 'live on' : 'live' }, () => live() ? 'live' : 'offline')),
    h('section', { class: 'bindings' }, h('h2', {}, 'Bindings'),
      h('p', {}, 'count = ', () => String(b.count()), ' ', h('button', { onClick: () => b.increment() }, 'increment')),
      h('ul', {}, () => C(For, { get each() { return b.todos.list; }, children: (t: { id: number; text: string; done: boolean }) =>
        h('li', { class: () => t.done ? 'done' : '' }, () => t.text) })),
      h('pre', { class: 'iface' }, INTERFACE)),
    h('section', { class: 'result' }, h('h2', {}, 'Result'),
      h('p', { class: 'muted' }, 'New code replaces the old evaluation: its own state starts fresh, the bindings keep theirs.'),
      () => C(Show, { get when() { return selected(); }, keyed: true, get fallback() { return h('p', { class: 'muted' }, 'Nothing posted yet. POST code to /eval.'); },
        children: (e: Entry) => h('div', {},
          h('p', { class: 'muted' }, '#' + e.id + ' · ' + e.syntax + (e.type ? ' · value: ' + e.type : ' · markup')),
          h('pre', { class: 'code' }, e.code),
          C(Errored, { fallback: (err: () => unknown) => errorPanel(e.ok ? 'Runtime error' : 'Refused by the checker', diagnosticsOf(err())),
            get children() { return C(Loading, { get fallback() { return h('p', { class: 'muted' }, 'Loading…'); }, get children() { return result(e); } }); } })) })),
    h('section', { class: 'history' }, h('h2', {}, 'History'),
      h('p', {}, h('button', { onClick: () => step(-1) }, '◀ back'), ' ', h('button', { onClick: () => step(1) }, 'forward ▶'), ' ',
        h('label', {}, h('input', { type: 'checkbox', checked: () => follow(), onChange: (ev: Event) => setFollow((ev.target as HTMLInputElement).checked) }), ' follow latest')),
      h('ol', {}, () => C(For, { get each() { return entries().slice().reverse(); }, children: (e: Entry) =>
        h('li', { class: () => (e.id === selectedId() ? 'sel ' : '') + (e.ok ? 'ok' : 'bad') },
          h('button', { onClick: () => { setFollow(false); setSelectedId(e.id); } }, () => '#' + e.id + ' ' + e.code.split('\n')[0].slice(0, 60))) }))));
  document.getElementById('app')!.append(page);
});
