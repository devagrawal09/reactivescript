// The benchmark workloads, as data both runtimes read: a plan v2/v2.1 and the steps of one op.
// node workloads.mjs OUTDIR  writes OUTDIR/<name>.json for each workload.
//
// A workload: { name, plan, reps, fresh, init: [Step], op: [Step] }
//  - fresh=false: mount once, run init, then `reps` timed ops on the same app.
//  - fresh=true:  each op gets a new app: mount, init (untimed), op (timed). `mount` workloads time the mount itself.
// Steps (each followed by one turn: microtasks, then flush):
//  {t:"click", i}           the i-th live clickable, depth first
//  {t:"resolve", host, value}  settle the oldest pending request of host with value
//  {t:"jfb", op}            jfb's header buttons as host-side store writes on source "rows":
//                           run | runlots | add | update | clear | swap
//  {t:"mount"} {t:"dispose"} (only in workloads with mount:"manual")
import {writeFileSync, mkdirSync} from 'node:fs';
const lit = value => ({op: 'literal', value});
const read = source => ({op: 'read', source});
const local = name => ({op: 'local', name});
const get = (object, key) => ({op: 'get', object, key});
const add = (left, right) => ({op: 'add', left, right});
const eq = (left, right) => ({op: 'eq', left, right});
const cond = (test, then, otherwise) => ({op: 'cond', test, then, else: otherwise});
const text = value => ({kind: 'text', value});
const el = (tag, events, children) => ({kind: 'element', tag, events, children});
const onClick = steps => [{name: 'onClick', steps}];
const button = steps => el('button', onClick(steps), [text(lit('+'))]);
const write = (source, value, path) => path ? {op: 'write', source, path, value} : {op: 'write', source, value};
const plan = (o) => ({version: 2, component: 'B', hosts: [], sources: [], memos: [], actions: [], markup: [], ...o});
const signal = (name, v) => ({name, kind: 'signal', seed: lit(v)});
const forEach = (each, item, children) => ({kind: 'for', each, item, key: 'identity', children});
const record = fields => ({op: 'object', fields: Object.entries(fields).map(([key, value]) => ({key, value}))});
const bump = s => write(s, add(read(s), lit(1)));
const ne0 = s => ({op: 'ne', left: s, right: lit('')});

const W = [];
const w = (name, o) => W.push({name, fresh: false, init: [], ...o});

// ---- the five micro workloads of the first rounds (exact-vs-reactivescript/PERF.md) ----
const ROWS = 1000;
const rowsSeed = () => record({list: {op: 'array', items: Array.from({length: ROWS}, (_, i) => record({id: lit(i), label: lit(`row ${i}`), even: lit(i % 2 === 0)}))}});
w('counter', {reps: 20000, op: [{t: 'click', i: 0}],
  plan: plan({sources: [signal('n', 0)], markup: [el('div', [], [button([bump('n')]), el('span', [], [text(read('n'))])])]})});
w('fanout', {reps: 400, op: [{t: 'click', i: 0}],
  plan: plan({sources: [signal('x', 0)], memos: Array.from({length: 1000}, (_, i) => ({name: `d${i}`, value: add(read('x'), lit(i))})),
    markup: [el('div', [], [button([bump('x')]), ...Array.from({length: 1000}, (_, i) => el('span', [], [text(read(`d${i}`))]))])]})});
const selectPlan = () => plan({sources: [{name: 'rows', kind: 'store', seed: rowsSeed()}, signal('sel', -1)],
  markup: [el('div', [], [button([bump('sel')]),
    forEach(get(read('rows'), 'list'), 'r', [el('p', [], [text(add(cond(eq(get(local('r'), 'id'), read('sel')), lit('> '), lit('')), get(local('r'), 'label')))])])])]});
w('select', {reps: 400, op: [{t: 'click', i: 0}], plan: selectPlan()});
w('filter', {reps: 200, op: [{t: 'click', i: 0}],
  plan: plan({sources: [{name: 'rows', kind: 'store', seed: rowsSeed()}, signal('mode', 'all')],
    memos: [{name: 'visible', value: {op: 'filter', array: get(read('rows'), 'list'), param: 'r', body: {op: 'or', left: eq(read('mode'), lit('all')), right: get(local('r'), 'even')}}}],
    markup: [el('div', [], [button([write('mode', cond(eq(read('mode'), lit('all')), lit('even'), lit('all')))]),
      forEach(read('visible'), 'r', [el('p', [], [text(get(local('r'), 'label'))])])])]})});
w('mount', {reps: 40, fresh: true, mount: 'manual', op: [{t: 'mount'}, {t: 'dispose'}], plan: selectPlan()});

// ---- js-framework-benchmark, keyed: the nine ops with jfb's warmups ----
const jrow = () => {
  const id = get(local('r'), 'id');
  const others = {op: 'filter', array: get(read('rows'), 'list'), param: 'x', body: {op: 'ne', left: get(local('x'), 'id'), right: get(local('r'), 'id')}};
  return el('tr', [], [
    el('td', [], [text(cond(eq(id, read('sel')), lit('danger'), lit('-')))]),
    el('td', [], [text(get(local('r'), 'id'))]),
    el('td', [], [el('a', onClick([write('sel', get(local('r'), 'id'))]), [text(get(local('r'), 'label'))])]),
    el('td', [], [el('a', onClick([write('rows', others, [{key: 'list'}])]), [el('span', [], [])])]),
    el('td', [], [])]);
};
const jfbPlan = plan({sources: [{name: 'rows', kind: 'store', seed: record({list: {op: 'array', items: []}})}, signal('sel', -1)],
  markup: [el('tbody', [], [forEach(get(read('rows'), 'list'), 'r', [jrow()])])]});
const J = op => ({t: 'jfb', op});
const sel = row => ({t: 'click', i: 2 * row}), rem = row => ({t: 'click', i: 2 * row + 1});
const cycles = n => Array.from({length: n}, () => [J('run'), J('clear')]).flat();
const jfb = {
  run: [cycles(5), [J('run')]],
  replace: [Array(5).fill(J('run')), [J('run')]],
  update: [[J('run'), J('update'), J('update'), J('update')], [J('update')]],
  select: [[J('run'), sel(4)], [sel(1)]],
  swap: [[J('run'), ...Array(6).fill(J('swap'))], [J('swap')]],
  remove: [[J('run'), rem(8), rem(7), rem(6), rem(5), rem(4)], [rem(3)]],
  runlots: [cycles(5), [J('runlots')]],
  add: [[...cycles(5), J('run')], [J('add')]],
  clear: [[...cycles(5), J('run')], [J('clear')]],
};
for (const [op, [init, timed]] of Object.entries(jfb)) w(`jfb-${op}`, {reps: op === 'runlots' ? 5 : 30, fresh: true, init, op: timed, plan: jfbPlan});

// ---- new workloads ----
// A chain of 1,000 memos, each one more than the last; one text shows the end.
w('chain', {reps: 400, op: [{t: 'click', i: 0}],
  plan: plan({sources: [signal('x', 0)], memos: Array.from({length: 1000}, (_, i) => ({name: `m${i}`, value: add(read(i ? `m${i - 1}` : 'x'), lit(1))})),
    markup: [el('div', [], [button([bump('x')]), el('span', [], [text(read('m999'))])])]})});
// A diamond: 100 memos over x, one memo summing them pairwise in a tree, one text.
{
  const leaves = Array.from({length: 128}, (_, i) => ({name: `l${i}`, value: add(read('x'), lit(i))}));
  const memos = [...leaves]; let level = leaves.map(m => m.name), n = 0;
  while (level.length > 1) { const next = []; for (let i = 0; i < level.length; i += 2) { const name = `s${n++}`; memos.push({name, value: add(read(level[i]), read(level[i + 1]))}); next.push(name); } level = next; }
  w('diamond', {reps: 2000, op: [{t: 'click', i: 0}],
    plan: plan({sources: [signal('x', 0)], memos, markup: [el('div', [], [button([bump('x')]), el('span', [], [text(read(level[0]))])])]})});
}
// A store of 1,000 rows, each showing a leaf three records deep; each click writes one leaf (a different row each time).
{
  const items = Array.from({length: ROWS}, (_, i) => record({id: lit(i), meta: record({a: record({b: record({c: lit(0)})})})}));
  const leaf = r => get(get(get(get(r, 'meta'), 'a'), 'b'), 'c');
  const path = [{key: 'list'}, {index: read('k')}, {key: 'meta'}, {key: 'a'}, {key: 'b'}, {key: 'c'}];
  w('store-deep', {reps: 900, op: [{t: 'click', i: 0}],
    plan: plan({sources: [{name: 'rows', kind: 'store', seed: record({list: {op: 'array', items}})}, signal('k', 0)],
      markup: [el('div', [], [button([write('rows', add(read('k'), lit(1)), path), bump('k')]),
        forEach(get(read('rows'), 'list'), 'r', [el('p', [], [text(add(get(local('r'), 'id'), add(lit(':'), leaf(local('r')))))])])])]})});
}
// 1,000 rows each holding a Show over one flag: a click swaps every row's branch (1,000 child owners made and disposed).
w('rows-show', {reps: 100, op: [{t: 'click', i: 0}],
  plan: plan({sources: [{name: 'rows', kind: 'store', seed: rowsSeed()}, signal('on', true)],
    markup: [el('div', [], [button([write('on', {op: 'not', value: read('on')})]),
      forEach(get(read('rows'), 'list'), 'r', [el('p', [], [{kind: 'show', when: read('on'), children: [el('b', [], [text(get(local('r'), 'label'))])], fallback: [el('i', [], [text(lit('-'))])]}])])])]})});
// Many small roots: mount, flush and dispose a one-signal app.
w('roots', {reps: 2000, fresh: true, mount: 'manual', op: [{t: 'mount'}, {t: 'dispose'}],
  plan: plan({sources: [signal('n', 0)], markup: [el('div', [], [button([bump('n')]), el('span', [], [text(read('n'))])])]})});

// ---- async (plan v2.1) ----
// An action per row: guess the row's assignee (optimistic map), await the host, write the store, land. 200 rows.
{
  const N = 200;
  const items = Array.from({length: N}, (_, i) => record({id: lit(i), title: lit(`issue ${i}`), assignee: lit('')}));
  const idx = {op: 'findIndex', array: get(read('issues'), 'list'), param: 'x', body: eq(get(local('x'), 'id'), local('id'))};
  const claim = {name: 'claim', params: ['id'], steps: [
    {op: 'optimistic', source: 'shown', updater: {param: 'list', body: {op: 'map', array: local('list'), param: 'x',
      body: cond(eq(get(local('x'), 'id'), local('id')), record({id: get(local('x'), 'id'), title: get(local('x'), 'title'), assignee: lit('me')}), local('x'))}}},
    {op: 'await', host: 'assign', args: [local('id')], bind: '$await0'},
    write('issues', local('$await0'), [{key: 'list'}, {index: idx}, {key: 'assignee'}])]};
  w('async-action', {reps: 150, op: [{t: 'click', i: 0}, {t: 'resolve', host: 'assign', value: 'dev'}],
    plan: plan({hosts: [{name: 'assign', params: ['number'], returns: 'string'}],
      sources: [{name: 'issues', kind: 'store', seed: record({list: {op: 'array', items}})}, {name: 'shown', kind: 'optimistic', seed: get(read('issues'), 'list')}],
      actions: [claim],
      markup: [el('div', [], [forEach({op: 'filter', array: read('shown'), param: 'x', body: eq(get(local('x'), 'assignee'), lit(''))}, 'issue', [el('p', [], [
        text(get(local('issue'), 'title')), text(lit(': ')), text({op: 'or', left: get(local('issue'), 'assignee'), right: lit('nobody')}),
        el('button', onClick([{op: 'call', action: 'claim', args: [get(local('issue'), 'id')]}]), [text(lit('take'))])])])])]})});
}
// An async memo over a page signal, under Loading, 50 rows a page, a pending probe: a click asks for the next page.
{
  const page = Array.from({length: 50}, (_, i) => ({id: i, title: `t${i}`}));
  w('async-memo', {reps: 200, init: [{t: 'resolve', host: 'load', value: page}], op: [{t: 'click', i: 0}, {t: 'resolve', host: 'load', value: page}],
    plan: {...plan({hosts: [{name: 'load', params: ['number'], returns: '{ id: number, title: string }[]', pure: true}],
      sources: [signal('p', 0)], memos: [{name: 'items', await: {host: 'load', args: [read('p')]}}],
      markup: [el('div', [], [button([bump('p')]),
        {kind: 'loading', fallback: [el('i', [], [text(lit('Loading'))])], children: [el('section', [], [
          el('b', [], [text(cond({op: 'pending', value: read('items')}, lit('…'), lit('ok')))]),
          forEach(read('items'), 'it', [el('p', [], [text(get(local('it'), 'title'))])])])]}])]}), version: 2.1}});
}

// ---- coverage round: the gaps the first suite left (PERF.md, "Coverage matrix") ----
const lt = (left, right) => ({op: 'lt', left, right});
const ge = (left, right) => ({op: 'ge', left, right});
const and = (left, right) => ({op: 'and', left, right});
const not = value => ({op: 'not', value});
const len = array => ({op: 'length', array});
const filter = (array, param, body) => ({op: 'filter', array, param, body});
const map = (array, param, body) => ({op: 'map', array, param, body});
const show = (when, children, fallback = []) => ({kind: 'show', when, children, fallback});
const span = v => el('span', [], [text(v)]);
const buttons = list => list.map(steps => button(steps));
const sum = xs => xs.length === 1 ? xs[0] : add(sum(xs.slice(0, xs.length >> 1)), sum(xs.slice(xs.length >> 1)));
const toggle = s => write(s, not(read(s)));

// Equality: a write of the value a signal already holds, read by 1,000 texts. Nothing downstream may run.
w('same-write', {reps: 5000, op: [{t: 'click', i: 0}],
  plan: plan({sources: [signal('n', 0)], markup: [el('div', [], [button([write('n', read('n'))]), ...Array.from({length: 1000}, () => span(read('n')))])]})});
// Equality at a memo: x changes, the memo `x >= 0` recomputes to the same true; its 1,000 readers must not rerun.
w('memo-equal', {reps: 5000, op: [{t: 'click', i: 0}],
  plan: plan({sources: [signal('x', 0)], memos: [{name: 'pos', value: ge(read('x'), lit(0))}],
    markup: [el('div', [], [button([bump('x')]), ...Array.from({length: 1000}, (_, i) => span(cond(read('pos'), lit(`y${i}`), lit(`n${i}`))))])]})});
// Dynamic dependencies: 500 memos read a or b by a flag; each click flips the flag (every memo drops one source and gains the other).
w('branch-flip', {reps: 400, op: [{t: 'click', i: 0}],
  plan: plan({sources: [signal('on', true), signal('a', 0), signal('b', 100)],
    memos: Array.from({length: 500}, (_, i) => ({name: `m${i}`, value: add(cond(read('on'), read('a'), read('b')), lit(i))})),
    markup: [el('div', [], [button([toggle('on')]), ...Array.from({length: 500}, (_, i) => span(read(`m${i}`)))])]})});
// The untaken branch: the same 500 memos stay on `a`; a click writes `b`, which no memo reads any more.
w('branch-stale', {reps: 5000, init: [{t: 'click', i: 0}, {t: 'click', i: 0}], op: [{t: 'click', i: 1}],
  plan: plan({sources: [signal('on', true), signal('a', 0), signal('b', 100)],
    memos: Array.from({length: 500}, (_, i) => ({name: `m${i}`, value: add(cond(read('on'), read('a'), read('b')), lit(i))})),
    markup: [el('div', [], [button([toggle('on')]), button([bump('b')]), ...Array.from({length: 500}, (_, i) => span(read(`m${i}`)))])]})});
// Fan-in: one memo over 1,000 signals; each click writes a different one.
{
  const N = 1000;
  w('fanin', {reps: 2000, op: [{t: 'click', i: 0}],
    plan: plan({sources: [...Array.from({length: N}, (_, i) => signal(`s${i}`, i)), signal('k', 0)],
      memos: [{name: 'total', value: sum(Array.from({length: N}, (_, i) => read(`s${i}`)))}],
      markup: [el('div', [], [button([bump('s0'), bump(`s${N - 1}`)]), span(read('total'))])]})});
}
// jfb at 10 rows: per-operation overhead when the work is small, as in most real updates.
for (const [op, [init, timed]] of Object.entries(jfb)) if (op !== 'runlots') {
  const ten = s => s.t === 'jfb' && (s.op === 'run' || s.op === 'add') ? {...s, n: 10} : s;
  w(`jfb10-${op}`, {reps: 300, fresh: true, init: init.map(ten), op: timed.map(ten), plan: jfbPlan});
}
// Select at 100,000 rows: one click changes two rows' markers; the cost must not grow with the table.
{
  const N = 100_000;
  w('select-100k', {reps: 50, op: [{t: 'click', i: 0}], logCheck: false,
    plan: plan({sources: [{name: 'rows', kind: 'store', seed: record({list: {op: 'array', items: []}})}, signal('sel', -1)],
      markup: [el('div', [], [button([bump('sel')]), forEach(get(read('rows'), 'list'), 'r', [el('p', [], [text(cond(eq(get(local('r'), 'id'), read('sel')), lit('>'), lit('-')))])])])]}),
    init: [{t: 'jfb', op: 'run', n: N}]});
  // ids start at 1 from the jfb data, so sel 0 marks nothing; the first click marks row 0 (id 1).
}
// A list of strings: every item replaced (new strings, so every row is new under identity keys).
w('scalars', {reps: 200, op: [{t: 'click', i: 0}],
  plan: plan({sources: [{name: 'xs', kind: 'signal', seed: {op: 'array', items: Array.from({length: 1000}, (_, i) => lit(`s${i}`))}}],
    markup: [el('div', [], [button([write('xs', map(read('xs'), 'x', add(local('x'), lit('!'))))]), forEach(read('xs'), 'x', [el('p', [], [text(local('x'))])])])]})});
// Store append: each op adds one row at the end of a store list of 1,000 (grows by one per rep). A plan handler
// cannot append (a path index past the end is refused, and there is no concat), so the host appends, as jfb's add.
w('store-push', {reps: 500, op: [{t: 'append', source: 'rows', key: 'list', value: {id: -1, label: 'new row', even: true}}],
  plan: plan({sources: [{name: 'rows', kind: 'store', seed: rowsSeed()}],
    markup: [el('div', [], [span(len(get(read('rows'), 'list'))),
      forEach(get(read('rows'), 'list'), 'r', [el('p', [], [text(get(local('r'), 'label'))])])])]})});
// Errored over an async memo: odd clicks reject the load (fallback), even clicks resolve it (children again).
{
  const page = Array.from({length: 20}, (_, i) => ({id: i, title: `t${i}`}));
  w('errored', {reps: 100, init: [{t: 'resolve', host: 'load', value: page}],
    op: [{t: 'click', i: 0}, {t: 'reject', host: 'load', error: 'boom'}, {t: 'click', i: 0}, {t: 'resolve', host: 'load', value: page}],
    plan: {...plan({hosts: [{name: 'load', params: ['number'], returns: '{ id: number, title: string }[]', pure: true}],
      sources: [signal('p', 0)], memos: [{name: 'items', await: {host: 'load', args: [read('p')]}}],
      markup: [el('div', [], [button([bump('p')]),
        {kind: 'errored', fallback: [el('i', [], [text(lit('failed'))])], children: [{kind: 'loading', fallback: [el('i', [], [text(lit('Loading'))])], children: [
          forEach(read('items'), 'it', [el('p', [], [text(get(local('it'), 'title'))])])]}]}])]}), version: 2.1}});
}
// Overlapping actions and a held write. Shared plan: 200 issues, claim = optimistic + await + store write; a counter outside.
{
  const N = 200;
  const items = Array.from({length: N}, (_, i) => record({id: lit(i), title: lit(`issue ${i}`), assignee: lit('')}));
  const idx = {op: 'findIndex', array: get(read('issues'), 'list'), param: 'x', body: eq(get(local('x'), 'id'), local('id'))};
  const claim = {name: 'claim', params: ['id'], steps: [
    {op: 'optimistic', source: 'shown', updater: {param: 'list', body: map(local('list'), 'x',
      cond(eq(get(local('x'), 'id'), local('id')), record({id: get(local('x'), 'id'), title: get(local('x'), 'title'), assignee: lit('me')}), local('x')))}},
    {op: 'await', host: 'assign', args: [local('id')], bind: '$await0'},
    write('issues', local('$await0'), [{key: 'list'}, {index: idx}, {key: 'assignee'}])]};
  const p = plan({hosts: [{name: 'assign', params: ['number'], returns: 'string'}],
    sources: [{name: 'issues', kind: 'store', seed: record({list: {op: 'array', items}})}, {name: 'shown', kind: 'optimistic', seed: get(read('issues'), 'list')}, signal('n', 0)],
    actions: [claim],
    markup: [el('div', [], [button([bump('n')]), span(read('n')),
      forEach(filter(read('shown'), 'x', eq(get(local('x'), 'assignee'), lit(''))), 'issue', [el('p', [], [
        text(get(local('issue'), 'title')),
        el('button', onClick([{op: 'call', action: 'claim', args: [get(local('issue'), 'id')]}]), [text(lit('take'))])])])])]});
  // Two claims in flight at once (the second row is first once the optimistic map hides the first), then both land.
  w('async-overlap', {reps: 90, op: [{t: 'click', i: 1}, {t: 'click', i: 1}, {t: 'resolve', host: 'assign', value: 'dev'}, {t: 'resolve', host: 'assign', value: 'ana'}], plan: p});
  // A plain write while a claim is pending, then the claim lands.
  w('held-write', {reps: 150, op: [{t: 'click', i: 1}, {t: 'click', i: 0}, {t: 'resolve', host: 'assign', value: 'dev'}], plan: p});
}
// App-shaped: a chat thread (the t3code shape). 200 messages with author, text and an edited mark; a streaming draft.
{
  const N = 200;
  const msgs = Array.from({length: N}, (_, i) => record({id: lit(i), author: lit(i % 3 ? 'agent' : 'user'), text: lit(`message ${i} `.repeat(4)), edited: lit(i % 7 === 0)}));
  const chat = plan({sources: [{name: 'thread', kind: 'store', seed: record({msgs: {op: 'array', items: msgs}})}, signal('draft', '')],
    memos: [{name: 'mine', value: len(filter(get(read('thread'), 'msgs'), 'm', eq(get(local('m'), 'author'), lit('user'))))},
      {name: 'streaming', value: ne0(read('draft'))}],
    markup: [el('main', [], [
      el('header', [], [text(add(read('mine'), lit(' sent')))]),
      forEach(get(read('thread'), 'msgs'), 'm', [el('article', [], [
        el('b', [], [text(get(local('m'), 'author'))]),
        el('p', [], [text(get(local('m'), 'text'))]),
        show(get(local('m'), 'edited'), [el('small', [], [text(lit('(edited)'))])])])]),
      show(read('streaming'), [el('article', [], [el('b', [], [text(lit('agent'))]), el('p', [], [text(read('draft'))])])]),
      button([write('draft', add(read('draft'), lit('tok ')))]),
      button([write('draft', lit(''))])])]});
  w('chat-stream', {reps: 2000, op: [{t: 'click', i: 0}], plan: chat});
  // Send: the host appends the finished message (as a server event would), and the draft clears.
  w('chat-send', {reps: 300, op: [{t: 'click', i: 0}, {t: 'append', source: 'thread', key: 'msgs', value: {id: -1, author: 'agent', text: 'tok ', edited: false}}, {t: 'click', i: 1}], plan: chat});
}
// App-shaped: a form of 20 fields, each with a validity memo, an all-valid memo and a dirty count; a click types into one field.
{
  const F = 20;
  const fields = Array.from({length: F}, (_, i) => `f${i}`);
  w('form', {reps: 2000, op: [{t: 'click', i: 7}],
    plan: plan({sources: fields.map(f => signal(f, '')),
      memos: [...fields.map(f => ({name: `${f}ok`, value: ne0(read(f))})),
        {name: 'valid', value: fields.map(f => read(`${f}ok`)).reduce((a, b) => and(a, b))},
        {name: 'dirty', value: sum(fields.map(f => cond(read(`${f}ok`), lit(1), lit(0))))}],
      markup: [el('form', [], [...fields.map(f => el('label', [], [button([write(f, add(read(f), lit('a')))]), span(read(f)), show(not(read(`${f}ok`)), [el('em', [], [text(lit('required'))])])])),
        span(add(read('dirty'), lit(' filled'))), el('button', [], [text(cond(read('valid'), lit('Submit'), lit('Fill all fields')))])])]})});
}
// App-shaped: a dashboard. 1,000 rows of {cat, value}; five per-category counts above a threshold and the rows above it.
{
  const N = 1000, cats = ['a', 'b', 'c', 'd', 'e'];
  const items = Array.from({length: N}, (_, i) => record({id: lit(i), cat: lit(cats[i % 5]), value: lit((i * 37) % 100)}));
  const over = r => ge(get(r, 'value'), read('t'));
  w('dashboard', {reps: 200, op: [{t: 'click', i: 0}],
    plan: plan({sources: [{name: 'data', kind: 'store', seed: record({rows: {op: 'array', items}})}, signal('t', 0)],
      memos: [{name: 'shown', value: filter(get(read('data'), 'rows'), 'r', over(local('r')))},
        ...cats.map(c => ({name: `n_${c}`, value: len(filter(read('shown'), 'r', eq(get(local('r'), 'cat'), lit(c))))}))],
      markup: [el('div', [], [button([write('t', cond(lt(read('t'), lit(90)), add(read('t'), lit(10)), lit(0)))]),
        ...cats.map(c => span(read(`n_${c}`))),
        forEach(read('shown'), 'r', [el('p', [], [text(get(local('r'), 'id')), text(lit(' ')), text(get(local('r'), 'value'))])])])]})});
}

// ---- coverage round 2: runtime paths the first coverage report found unreached (PERF.md, "Coverage") ----
// Nested control flow: each of 200 rows is a fragment of three children with a Show inside a Show, so the
// renderer flattens nested arrays and nested dynamic children; the two buttons flip the outer and inner flags.
w('nested-flow', {reps: 200, op: [{t: 'click', i: 0}, {t: 'click', i: 1}],
  plan: plan({sources: [{name: 'rows', kind: 'store', seed: record({list: {op: 'array', items: Array.from({length: 200}, (_, i) => record({id: lit(i), label: lit(`row ${i}`)}))}})}, signal('on', true), signal('deep', true)],
    markup: [el('div', [], [button([toggle('on')]), button([toggle('deep')]),
      forEach(get(read('rows'), 'list'), 'r', [span(get(local('r'), 'label')),
        show(read('on'), [span(get(local('r'), 'id')), show(read('deep'), [span(lit('d'))], [span(lit('x'))])], [span(lit('-'))]),
        span(lit('!'))])])]})});
{
  const page = Array.from({length: 50}, (_, i) => ({id: i, title: `t${i}`}));
  const hosts = [{name: 'load', params: ['number'], returns: '{ id: number, title: string }[]', pure: true}];
  const rows = forEach(read('items'), 'it', [el('p', [], [text(get(local('it'), 'title'))])]);
  const pendingMark = el('b', [], [text(cond({op: 'pending', value: read('items')}, lit('…'), lit('ok')))]);
  // refresh(items) from a plain handler: the same page refetched, under Loading with a pending probe.
  w('refresh', {reps: 200, init: [{t: 'resolve', host: 'load', value: page}], op: [{t: 'click', i: 0}, {t: 'resolve', host: 'load', value: page}],
    plan: {...plan({hosts, sources: [signal('p', 0)], memos: [{name: 'items', await: {host: 'load', args: [read('p')]}}],
      markup: [el('div', [], [button([{op: 'refresh', source: 'items'}]),
        {kind: 'loading', fallback: [el('i', [], [text(lit('Loading'))])], children: [el('section', [], [pendingMark, rows])]}])]}), version: 2.1}});
  // affects(items) in an action that awaits a save, then moves the page: items is marked pending from the click until the action lands.
  w('affects', {reps: 150, init: [{t: 'resolve', host: 'load', value: page}],
    op: [{t: 'click', i: 0}, {t: 'resolve', host: 'save', value: 1}, {t: 'resolve', host: 'load', value: page}],
    plan: {...plan({hosts: [...hosts, {name: 'save', params: ['number'], returns: 'number'}], sources: [signal('p', 0)],
      memos: [{name: 'items', await: {host: 'load', args: [read('p')]}}],
      actions: [{name: 'next', params: [], steps: [{op: 'affects', source: 'items'}, {op: 'await', host: 'save', args: [read('p')], bind: '$a'}, bump('p')]}],
      markup: [el('div', [], [el('button', onClick([{op: 'call', action: 'next', args: []}]), [text(lit('next'))]),
        {kind: 'loading', fallback: [el('i', [], [text(lit('Loading'))])], children: [el('section', [], [pendingMark, rows])]}])]}), version: 2.1}});
  // A boundary per row: 100 rows, each an Errored around a Loading around a read of the async memo.
  w('row-boundaries', {reps: 100, init: [{t: 'resolve', host: 'load', value: page}], op: [{t: 'click', i: 0}, {t: 'resolve', host: 'load', value: page}],
    plan: {...plan({hosts, sources: [signal('p', 0), {name: 'ids', kind: 'signal', seed: {op: 'array', items: Array.from({length: 100}, (_, i) => lit(i))}}],
      memos: [{name: 'items', await: {host: 'load', args: [read('p')]}}],
      markup: [el('div', [], [button([bump('p')]),
        forEach(read('ids'), 'i', [{kind: 'errored', fallback: [span(lit('failed'))], children: [{kind: 'loading', fallback: [span(lit('…'))],
          children: [span(add(local('i'), len(read('items'))))]}]}])])]}), version: 2.1}});
}

// ---- plan v2.3 composition: components, props, children, attributes (needs the plan-v2-composition branch) ----
{
  const prop = name => ({op: 'prop', name});
  const comp = (name, props, children) => ({kind: 'component', name, props, ...(children ? {children} : {})});
  const v23 = o => ({...plan(o), version: 2.3});
  // Row: one table row as a component, the selected mark as a class attribute (jfb's real shape), a select callback.
  const Row = {name: 'Row', props: [{name: 'id', kind: 'value'}, {name: 'label', kind: 'value'}, {name: 'selected', kind: 'value'}, {name: 'onSelect', kind: 'function'}],
    sources: [], memos: [], actions: [],
    markup: [{kind: 'element', tag: 'tr', events: [], attrs: [{name: 'class', value: cond(prop('selected'), lit('danger'), lit(''))}], children: [
      el('td', [], [text(prop('id'))]),
      el('td', [], [el('a', onClick([{op: 'call', prop: 'onSelect', args: [prop('id')]}]), [text(prop('label'))])])]}]};
  const table = v23({sources: [{name: 'rows', kind: 'store', seed: rowsSeed()}, signal('sel', -1)],
    markup: [el('div', [], [button([bump('sel')]), el('tbody', [], [forEach(get(read('rows'), 'list'), 'r', [comp('Row', [
      {name: 'id', value: get(local('r'), 'id')}, {name: 'label', value: get(local('r'), 'label')},
      {name: 'selected', value: eq(get(local('r'), 'id'), read('sel'))},
      {name: 'onSelect', handler: {params: ['id'], steps: [write('sel', local('id'))]}}])])])])],
    components: [Row]});
  // Select through props: the header button moves the selection; two rows' class attribute changes.
  w('compose-select', {reps: 400, op: [{t: 'click', i: 0}], plan: table});
  // Select through a callback prop, from inside a row component.
  w('compose-callback', {reps: 400, op: [{t: 'click', i: 1}, {t: 'click', i: 3}], plan: table});
  // Mount and dispose 1,000 row components.
  w('compose-mount', {reps: 40, fresh: true, mount: 'manual', op: [{t: 'mount'}, {t: 'dispose'}], plan: table});
  // Card: children passed through a component, under a Show the parent toggles; 200 cards with a title prop.
  const Card = {name: 'Card', props: [{name: 'title', kind: 'value'}, {name: 'children', kind: 'children'}], sources: [], memos: [], actions: [],
    markup: [el('section', [], [el('h2', [], [text(prop('title'))]), {kind: 'children'}])]};
  w('compose-children', {reps: 200, op: [{t: 'click', i: 0}],
    plan: v23({sources: [{name: 'rows', kind: 'store', seed: rowsSeed()}, signal('open', true)],
      markup: [el('div', [], [button([toggle('open')]), forEach(filter(get(read('rows'), 'list'), 'r', lt(get(local('r'), 'id'), lit(200))), 'r', [
        comp('Card', [{name: 'title', value: get(local('r'), 'label')}], [show(read('open'), [el('p', [], [text(get(local('r'), 'id'))])], [el('i', [], [text(lit('closed'))])])])])])],
      components: [Card]})});
  // Nested components three deep passing one value prop down; each click changes it (prop getters chained).
  const Leaf = {name: 'Leaf', props: [{name: 'v', kind: 'value'}], sources: [], memos: [], actions: [], markup: [el('b', [], [text(prop('v'))])]};
  const Mid = {name: 'Mid', props: [{name: 'v', kind: 'value'}], sources: [], memos: [], actions: [], markup: [el('i', [], [comp('Leaf', [{name: 'v', value: add(prop('v'), lit(1))}])])]};
  const Top = {name: 'Top', props: [{name: 'v', kind: 'value'}], sources: [], memos: [], actions: [], markup: [el('u', [], [comp('Mid', [{name: 'v', value: add(prop('v'), lit(1))}])])]};
  w('compose-deep', {reps: 400, op: [{t: 'click', i: 0}],
    plan: v23({sources: [signal('x', 0)], markup: [el('div', [], [button([bump('x')]),
      ...Array.from({length: 300}, (_, i) => comp('Top', [{name: 'v', value: add(read('x'), lit(i))}]))])], components: [Leaf, Mid, Top]})});
}

const out = process.argv[2];
if (out) { mkdirSync(out, {recursive: true}); for (const x of W) writeFileSync(`${out}/${x.name}.json`, JSON.stringify(x)); console.log(W.map(x => x.name).join(' ')); }
export default W;
