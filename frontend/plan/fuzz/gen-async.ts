// The plan v2.1 fuzz generator (plan/docs/PLAN-V2.md, "v2.1: async data", "Plan fuzz v2.1"): one seeded, deterministic
// program with Solid 2's async data, printed as Solid TSX (the async tier) and as RX, twin for twin, with its host
// declarations, plus a chooser that drives the scenario recording on native Solid. It is additive: gen.ts and its seeds
// are untouched (this module only reuses its printers, which gained the async cases), so the v2 fuzz's outputs are
// byte-identical.
//
// Programs are async trackers and vary: one or two async memos over pure hosts (a list of records, a scalar), with no
// argument or with a signal argument (a re-ask when it changes), sync memos over them, Loading and Errored in several
// nestings and positions (an element child, beside a static sibling, a Show branch, two Loadings under one Errored),
// isPending probes of async and derived memos, latest, row and scalar actions that declare affects, await a mutation
// host in a try, refresh before or after the await and write a status, actions that write an async memo's argument,
// plain refreshes outside the boundaries (racing the actions), a retry in the Errored fallback, and argument changes
// from plain handlers. The chooser clicks live targets and settles pending requests in any order: mutation requests
// resolve or reject, query requests resolve with fresh structured values, and reject only when every reader of the
// memo is inside an Errored (otherwise Solid halts: the run is invalid, not a verdict).
// A small share of programs (family "outside") carries one form outside plan v2.1 that both frontends accept; the
// v2.1 builder must refuse them.
import { rng } from '../../tsx/fuzz/gen.ts';
import { jsValue, pe, ps, pv, setter, TS_TYPE, type E, type S, type Ty, type V } from './gen.ts';
import type { HostSig } from './host.ts';
import { parseType } from '../../eval/interface.ts';
import { printType } from '../types.ts';

/** A host: a pure query (an async memo's) or a mutation (awaited in an action's try). `returns` is its .d.rx type. */
export type AsyncHost = { name: string; params: Ty[]; returns: string; pure: boolean; role: 'query' | 'mutate';
  /** A query whose every reader is inside an Errored: the chooser may reject its requests. */
  rejectable: boolean;
  /** A query's result: rows of these fields, or a scalar. */
  rows?: { name: string; ty: Ty }[]; scalar?: Ty };
export type AsyncDecl =
  | { k: 'signal'; name: string; v: string | number | boolean }
  | { k: 'amemo'; name: string; host: string; args: E[] }
  | { k: 'memo'; name: string; e: E }
  | { k: 'action'; name: string; params: [string, Ty][]; body: S[] };
export type AsyncCase = {
  seed: number; family: string;
  hosts: AsyncHost[]; decls: AsyncDecl[]; view: V;
  actions: { name: string }[];
  script: { seed: number; steps: number };
};

const titles = ['Crash', 'Slow', 'Typo', 'Docs', 'Leak', 'Build'];
const owners = ['', 'ana', 'bo', 'dev'];

export function generateAsync(seed: number): AsyncCase {
  const r = rng(seed * 6007 + 101);
  const families = ['list', 'list', 'scalar', 'two', 'two', 'args', 'nested', 'outside'];
  const family = families[r.int(families.length)];
  let lambdas = 0;
  const lam = () => 'x' + lambdas++;
  const hosts: AsyncHost[] = [];
  const decls: AsyncDecl[] = [];
  const src = (name: string): E => ({ k: 'src', name });
  const lit = (v: string | number | boolean): E => ({ k: 'lit', v });

  // ---- signals: the status line, maybe an argument for a query (a page or a mode), maybe a flag for a Show
  const signals: { name: string; ty: Ty; v: string | number | boolean }[] = [{ name: 'status', ty: 'str', v: '' }];
  const withArg = family === 'args' || r.chance(0.25);
  const argTy: Ty = r.chance(0.6) ? 'int' : 'str';
  if (withArg) signals.push(argTy === 'int' ? { name: 'page', ty: 'int', v: 1 } : { name: 'mode', ty: 'str', v: 'all' });
  const flag = family === 'nested' || r.chance(0.15);
  if (flag) signals.push({ name: 'shown', ty: 'bool', v: true });
  for (const s of signals) decls.push({ k: 'signal', name: s.name, v: s.v });
  const arg = withArg ? signals[1] : undefined;

  // ---- queries: a list of records and/or a scalar, each an async memo over a pure host
  const wantList = family !== 'scalar', wantScalar = family === 'scalar' || family === 'two' || (family !== 'list' && r.chance(0.3));
  const listName = r.pick(['issues', 'rows', 'items']);
  const fields = [{ name: 'id', ty: 'int' as Ty }, { name: 'title', ty: 'str' as Ty }, { name: 'owner', ty: 'str' as Ty },
    ...(r.chance(0.4) ? [{ name: 'n', ty: 'int' as Ty }] : []), ...(r.chance(0.3) ? [{ name: 'done', ty: 'bool' as Ty }] : [])];
  const query = (name: string, scalar?: Ty): AsyncHost => {
    // An argument, when there is one, is read by the first query only (its re-ask on change), or by both.
    const takes = !!arg && (hosts.length === 0 || r.chance(0.4));
    const h: AsyncHost = { name, params: takes ? [arg!.ty] : [], pure: true, role: 'query', rejectable: false,
      returns: scalar ? TS_TYPE[scalar] : '{ ' + fields.map(f => f.name + ': ' + TS_TYPE[f.ty]).join(', ') + ' }[]',
      ...(scalar ? { scalar } : { rows: fields }) };
    hosts.push(h);
    return h;
  };
  const argExpr = (): E => arg!.ty === 'int' ? (r.chance(0.7) ? src(arg!.name) : { k: 'bin', op: '+', l: src(arg!.name), r: lit(1) }) : src(arg!.name);
  let list: { memo: string; host: AsyncHost } | undefined, scalar: { memo: string; host: AsyncHost; ty: Ty } | undefined;
  if (wantList) {
    const h = query('load' + listName[0].toUpperCase() + listName.slice(1));
    decls.push({ k: 'amemo', name: listName, host: h.name, args: h.params.length ? [argExpr()] : [] });
    list = { memo: listName, host: h };
  }
  if (wantScalar) {
    const ty: Ty = r.chance(0.7) ? 'int' : 'str';
    const h = query(ty === 'int' ? 'loadTotal' : 'loadNote', ty);
    const name = ty === 'int' ? 'total' : 'note';
    decls.push({ k: 'amemo', name, host: h.name, args: h.params.length ? [argExpr()] : [] });
    scalar = { memo: name, host: h, ty };
  }

  // A chained query: its argument is the scalar async memo (a re-ask whenever that lands with a new value).
  let extra: string | undefined;
  if (scalar && scalar.ty === 'int' && r.chance(0.3)) {
    const h = query('loadExtra', 'str');
    h.params = ['int'];
    extra = 'extra';
    decls.push({ k: 'amemo', name: extra, host: h.name, args: [src(scalar.memo)] });
  }

  // ---- sync memos over the async ones: an open count, a visible filter, a scalar label, a sum of two
  let open: string | undefined, visible: string | undefined, label: string | undefined;
  if (list && r.chance(0.5)) {
    const p = lam();
    open = 'open';
    decls.push({ k: 'memo', name: open, e: { k: 'len', a: { k: 'filter', a: src(list.memo), p, body: { k: 'bin', op: '==', l: { k: 'get', o: { k: 'local', name: p }, key: 'owner' }, r: lit('') } } } });
  }
  const modeSignal = arg?.name === 'mode';
  if (list && r.chance(0.3)) {
    const p = lam();
    visible = 'visible';
    const row: E = { k: 'local', name: p };
    const test: E = modeSignal && r.chance(0.5)
      ? { k: 'bin', op: '||', l: { k: 'bin', op: '==', l: src('mode'), r: lit('all') }, r: { k: 'bin', op: '==', l: { k: 'get', o: row, key: 'owner' }, r: lit('') } }
      : { k: 'bin', op: '!=', l: { k: 'get', o: row, key: 'owner' }, r: lit(r.pick(['ana', 'bo', 'zed'])) };
    decls.push({ k: 'memo', name: visible, e: { k: 'filter', a: src(list.memo), p, body: test } });
  }
  if (scalar && r.chance(0.4)) {
    label = 'label';
    decls.push({ k: 'memo', name: label, e: { k: 'bin', op: '+', l: lit(r.pick(['n=', '#', 'v '])), r: src(scalar.memo) } });
  }
  let both: string | undefined;
  if (list && scalar && scalar.ty === 'int' && r.chance(0.3)) {
    const p = lam();
    both = 'both';
    decls.push({ k: 'memo', name: both, e: { k: 'bin', op: '+', l: { k: 'len', a: { k: 'filter', a: src(list.memo), p, body: { k: 'bin', op: '!=', l: { k: 'get', o: { k: 'local', name: p }, key: 'owner' }, r: lit('') } } }, r: src(scalar.memo) } });
  }

  // ---- mutation hosts and actions
  const mutate = (params: Ty[], returns: Ty): string => {
    const h: AsyncHost = { name: 'h' + hosts.filter(x => x.role === 'mutate').length, params, returns: TS_TYPE[returns], pure: false, role: 'mutate', rejectable: true, scalar: returns };
    hosts.push(h);
    return h.name;
  };
  const asyncMemos = [list?.memo, scalar?.memo, extra].filter((x): x is string => !!x);
  const actions: AsyncDecl[] = [];
  const refreshes = (): S[] => {
    const out: S[] = [];
    for (const m of asyncMemos) if (r.chance(m === asyncMemos[0] ? 0.85 : 0.5)) out.push({ k: 'refresh', name: m });
    return out;
  };
  // A row action: affects the list (usually), then await a mutation in a try, refresh (after the await, or sometimes
  // before it), write the status; the catch writes a failure.
  const rowAction = (name: string) => {
    const id: E = { k: 'local', name: 'id' };
    const body: S[] = [];
    if (r.chance(0.8)) body.push({ k: 'affects', name: r.chance(0.8) || !scalar ? list!.memo : scalar.memo });
    if (scalar && r.chance(0.2)) body.push({ k: 'affects', name: scalar.memo });
    const bind = 'got' + actions.length;
    const inner: S[] = [];
    const early = r.chance(0.2);
    const re = refreshes();
    if (early) inner.push(...re);
    inner.push({ k: 'await', bind, host: mutate(['int'], 'str'), args: [id] });
    if (!early) inner.push(...re);
    if (arg && arg.ty === 'int' && r.chance(0.2)) inner.push({ k: 'set', name: arg.name, e: { k: 'bin', op: '+', l: { k: 'local', name: 'id' }, r: lit(0) } });
    inner.push({ k: 'set', name: 'status', e: { k: 'bin', op: '+', l: { k: 'bin', op: '+', l: { k: 'bin', op: '+', l: lit(r.pick(['Assigned #', 'ok ', '#'])), r: id }, r: lit(' to ') }, r: { k: 'local', name: bind } } });
    body.push({ k: 'try', body: inner, handler: [{ k: 'set', name: 'status', e: { k: 'bin', op: '+', l: lit(r.pick(['Could not assign #', 'fail '])), r: id } }] });
    actions.push({ k: 'action', name, params: [['id', 'int']], body });
  };
  // A scalar action: affects the scalar (maybe), awaits, refreshes, writes the status.
  const scalarAction = (name: string) => {
    const body: S[] = [];
    if (r.chance(0.7)) body.push({ k: 'affects', name: scalar!.memo });
    const bind = 'got' + actions.length;
    const ret: Ty = r.chance(0.5) ? 'int' : 'str';
    // Sometimes the action awaits the scalar's own pure query host (a request numbered with the memo's), not a mutation.
    const own = !scalar!.host.params.length && r.chance(0.25);
    const inner: S[] = [{ k: 'await', bind, host: own ? scalar!.host.name : mutate([], ret), args: [] }, { k: 'refresh', name: scalar!.memo }];
    if (list && r.chance(0.3)) inner.push({ k: 'refresh', name: list.memo });
    inner.push({ k: 'set', name: 'status', e: { k: 'bin', op: '+', l: lit('bumped '), r: { k: 'local', name: bind } } });
    body.push({ k: 'try', body: inner, handler: [{ k: 'set', name: 'status', e: lit(r.pick(['failed', 'oops'])) }] });
    actions.push({ k: 'action', name, params: [], body });
  };
  // An argument action: awaits, then writes the async memo's argument (held until the action lands: the re-ask
  // follows the landing).
  const argAction = (name: string) => {
    const bind = 'got' + actions.length;
    const inner: S[] = [{ k: 'await', bind, host: mutate([], arg!.ty), args: [] }, { k: 'set', name: arg!.name, e: { k: 'local', name: bind } }];
    actions.push({ k: 'action', name, params: [], body: [{ k: 'try', body: inner, handler: [{ k: 'set', name: 'status', e: lit('stuck') }] }] });
  };
  const rowActions: string[] = [];
  if (list) for (let i = 0, n = 1 + (r.chance(0.3) ? 1 : 0); i < n; i++) { const a = ['claim', 'take'][i]; rowAction(a); rowActions.push(a); }
  const bumpName = scalar && r.chance(0.7) ? 'bump' : undefined;
  if (bumpName) scalarAction(bumpName);
  const turnName = arg && r.chance(0.35) ? 'turn' : undefined;
  if (turnName) argAction(turnName);
  // An action with no await: affects and refresh in one transaction, which lands with the refreshed value.
  const reaskName = r.chance(0.2) ? 'reask' : undefined;
  if (reaskName) { const m = r.pick(asyncMemos); actions.push({ k: 'action', name: reaskName, params: [], body: [...(r.chance(0.7) ? [{ k: 'affects', name: m } as S] : []), { k: 'refresh', name: m }] }); }
  decls.push(...actions);

  // ---- markup: the readers of each async memo, inside boundaries
  const hostOf = (memo: string): AsyncHost => {
    const d = decls.find(d => d.k === 'amemo' && d.name === memo) as { host: string } | undefined;
    return hosts.find(h => h.name === d?.host) ?? (() => { throw new Error('no query for ' + memo); })();
  };
  // The outside family's one form, `*` or `-` over an async memo's (or a derived memo's) integer: inside the first
  // readers built, so that every leg renders it once content has shown.
  let outside: V | undefined = family !== 'outside' ? undefined : { k: 'el', tag: 'q', kids: [{ k: 'hole', ty: 'int', e: { k: 'bin', op: r.chance(0.5) ? '*' : '-', r: { k: 'lit', v: 2 },
    l: open ? src(open) : { k: 'len', a: src(list!.memo) } } }] };   // the outside family always has a list
  const takeOutside = (): V[] => { const q = outside; outside = undefined; return q ? [q] : []; };
  const hole = (e: E, ty: Ty): V => ({ k: 'hole', e, ty });
  const probe = (memo: string): V => {
    const e: E = list && scalar && scalar.ty === 'int' && r.chance(0.2) ? { k: 'bin', op: '+', l: { k: 'len', a: src(list.memo) }, r: src(scalar.memo) } : src(memo);
    return { k: 'el', tag: 'b', kids: [hole({ k: 'cond', c: { k: 'pending', e }, t: lit(r.pick(['saving', 'busy'])), f: lit('ready') }, 'str')] };
  };
  const listReaders = (): V[] => {
    const out: V[] = [];
    if (r.chance(0.7)) out.push(probe(r.chance(0.8) || !open ? list!.memo : open!));
    out.push(...takeOutside());
    if (open && r.chance(0.7)) out.push({ k: 'el', tag: 'small', kids: [hole(src(open), 'int'), { k: 'text', s: ' open' }] });
    const item = 'issue', it: E = { k: 'local', name: item };
    const rowKids: V[] = [hole({ k: 'get', o: it, key: 'title' }, 'str'), { k: 'text', s: ': ' }, hole({ k: 'bin', op: '||', l: { k: 'get', o: it, key: 'owner' }, r: lit('nobody') }, 'str')];
    if (fields.some(f => f.name === 'n') && r.chance(0.5)) rowKids.push({ k: 'el', tag: 'i', kids: [hole({ k: 'get', o: it, key: 'n' }, 'int')] });
    if (fields.some(f => f.name === 'done') && r.chance(0.6)) rowKids.push({ k: 'show', c: { k: 'get', o: it, key: 'done' }, then: [{ k: 'el', tag: 's', kids: [{ k: 'text', s: 'done' }] }], else: [] });
    if (scalar && scalar.ty === 'int' && r.chance(0.25)) {
      const cell: V = { k: 'loading', fallback: [{ k: 'el', tag: 'i', kids: [{ k: 'text', s: 't' }] }], body: [{ k: 'el', tag: 's', kids: [hole(both && r.chance(0.5) ? src(both) : { k: 'bin', op: '+', l: { k: 'get', o: it, key: 'id' }, r: src(scalar.memo) }, 'int')] }] };
      rowKids.push(r.chance(0.4) ? { k: 'errored', fallback: [{ k: 'el', tag: 'del', kids: [{ k: 'text', s: 'x' }] }], body: [cell], err: r.chance(0.5) } : cell);
    }
    for (const a of rowActions) rowKids.push({ k: 'el', tag: 'button', click: [{ k: 'call', action: a, args: [{ k: 'get', o: it, key: 'id' }] }], kids: [{ k: 'text', s: a === 'claim' ? 'take' : 'mine' }] });
    const each = visible && r.chance(0.7) ? src(visible) : src(list!.memo);
    const rows: V = { k: 'for', each, item, body: [{ k: 'el', tag: 'p', kids: rowKids }] };
    // Sometimes a Show over the list's length, with a fallback (show.when reads the async memo).
    // Sometimes a Show over the list's length (and maybe not pending: a condition the compiler memoizes), or a Loading
    // of its own around the rows (nested in the block's Loading).
    const gt: E = { k: 'bin', op: '>', l: { k: 'len', a: each }, r: lit(0) };
    const shape = r.int(10);
    if (shape < 3) out.push({ k: 'show', c: shape === 0 ? { k: 'bin', op: '&&', l: { k: 'not', e: { k: 'pending', e: src(list!.memo) } }, r: gt } : gt, then: [rows], else: r.chance(0.7) ? [{ k: 'el', tag: 'i', kids: [{ k: 'text', s: 'Nothing here' }] }] : [] });
    else if (shape === 3) out.push({ k: 'loading', fallback: [{ k: 'el', tag: 'i', kids: [{ k: 'text', s: 'rows' }] }], body: [rows] });
    else out.push(rows);
    if (both && r.chance(0.5)) out.push({ k: 'el', tag: 'small', kids: [hole(src(both), 'int'), { k: 'text', s: ' both' }] });
    return out;
  };
  const scalarReaders = (): V[] => {
    const out: V[] = [];
    const s = scalar!;
    const value: E = r.chance(0.2) ? { k: 'latest', e: src(s.memo) } : src(s.memo);
    out.push({ k: 'el', tag: 'u', kids: [hole(value, s.ty)] });
    out.push(...takeOutside());
    if (label && r.chance(0.7)) out.push({ k: 'el', tag: 'code', kids: [hole(r.chance(0.2) ? { k: 'latest', e: src(label) } : src(label), 'str')] });
    if (extra) out.push({ k: 'el', tag: 'var', kids: [hole(src(extra), 'str')] });
    if (r.chance(0.5)) out.push(probe(r.chance(0.7) || !label ? s.memo : label));
    if (bumpName && r.chance(0.6)) out.push({ k: 'el', tag: 'button', click: [{ k: 'call', action: bumpName, args: [] }], kids: [{ k: 'text', s: 'bump' }] });
    return out;
  };
  const loadingFallback = (): V[] => r.chance(0.85) ? [{ k: 'el', tag: 'i', kids: [{ k: 'text', s: r.pick(['Loading', 'Loading issues', 'wait']) }] }]
    : [{ k: 'el', tag: 'i', kids: [{ k: 'text', s: 'Loading' }] }, { k: 'el', tag: 'sub', kids: [{ k: 'text', s: 'soon' }] }];
  const erroredFallback = (memos: string[]): V[] => {
    const retry: S[] = memos.map(m => ({ k: 'refresh', name: m }));
    const kids: V[] = [{ k: 'text', s: r.pick(['Could not load', 'failed']) }];
    if (r.chance(0.85)) kids.push({ k: 'el', tag: 'button', click: retry, kids: [{ k: 'text', s: 'retry' }] });
    return [{ k: 'el', tag: 'p', kids }];
  };
  // One boundary structure for a set of readers: Errored > Loading (as the slice) or Loading > Errored. The RX checker
  // requires an Errored above every reader of an async memo (UNHANDLED_FAILURE: a pure host may fail), so there is no
  // Loading-only structure, and every query is rejectable.
  const guard = (memos: string[], readers: V[], shape = r.pick(['EL', 'EL', 'LE'] as const)): V => {
    const loading: V = { k: 'loading', fallback: loadingFallback(), body: readers };
    for (const m of memos) hostOf(m).rejectable = true;
    const err = r.chance(0.6);
    if (shape === 'EL') return { k: 'errored', fallback: erroredFallback(memos), body: [loading], err };
    return { k: 'loading', fallback: loadingFallback(), body: [{ k: 'errored', fallback: erroredFallback(memos), body: readers, err }] };
  };
  const blocks: V[] = [];
  if (list && scalar && (family === 'two' && r.chance(0.5))) {
    // Two Loadings under one Errored: one retry refreshes both.
    const memos = [list.memo, scalar.memo, ...(extra ? [extra] : [])];
    for (const m of memos) hostOf(m).rejectable = true;
    blocks.push({ k: 'errored', fallback: erroredFallback(memos), err: r.chance(0.5), body: [
      { k: 'loading', fallback: loadingFallback(), body: scalarReaders() },
      { k: 'loading', fallback: loadingFallback(), body: listReaders() }] });
  } else {
    if (scalar) blocks.push(guard(extra ? [scalar.memo, extra] : [scalar.memo], scalarReaders()));
    if (list) blocks.push(guard([list.memo], listReaders()));
  }
  // Positions: an element child of the section, inside a div beside a static sibling, or a Show branch (the boundary
  // is disposed and created again while requests are in flight).
  const placed: V[] = blocks.map(b => {
    if (flag && r.chance(0.6)) {
      const other: V[] = r.chance(0.5) ? [{ k: 'el', tag: 'i', kids: [{ k: 'text', s: 'hidden' }] }] : [];
      return { k: 'el', tag: 'div', kids: [r.chance(0.7) ? { k: 'show', c: src('shown'), then: [b], else: other } : { k: 'show', c: src('shown'), then: other.length ? other : [{ k: 'el', tag: 'i', kids: [{ k: 'text', s: 'off' }] }], else: [b] }] };
    }
    const where = r.int(10);
    if (where < 3) return { k: 'el', tag: 'div', kids: where === 0 ? [b, { k: 'text', s: 'end' }] : where === 1 ? [{ k: 'el', tag: 'h2', kids: [{ k: 'text', s: 'List' }] }, b] : [b] };
    return b;
  });
  // Controls outside the boundaries (plain handlers): a re-ask that races the actions, an argument change, the flag.
  const controls: V[] = [];
  if (r.chance(0.5)) controls.push({ k: 'el', tag: 'button', click: asyncMemos.filter((_, i) => i === 0 || r.chance(0.5)).map(m => ({ k: 'refresh', name: m }) as S), kids: [{ k: 'text', s: 'refetch' }] });
  if (arg) controls.push({ k: 'el', tag: 'button', click: [{ k: 'set', name: arg.name, e: arg.ty === 'int' ? { k: 'bin', op: '+', l: src(arg.name), r: lit(1) } : { k: 'cond', c: { k: 'bin', op: '==', l: src(arg.name), r: lit('all') }, t: lit('open'), f: lit('all') } }],
    kids: arg.ty === 'int' ? [{ k: 'text', s: 'next' }] : [{ k: 'text', s: 'Filter: ' }, hole(src(arg.name), 'str')] });
  if (flag) controls.push({ k: 'el', tag: 'button', click: [{ k: 'set', name: 'shown', e: { k: 'not', e: src('shown') } }], kids: [{ k: 'text', s: 'toggle' }] });
  if (turnName) controls.push({ k: 'el', tag: 'button', click: [{ k: 'call', action: turnName, args: [] }], kids: [{ k: 'text', s: 'turn' }] });
  if (rowActions.length && r.chance(0.3)) controls.push({ k: 'el', tag: 'button', click: [{ k: 'call', action: rowActions[0], args: [lit(1 + r.int(3))] }, ...(r.chance(0.4) ? [{ k: 'refresh', name: r.pick(asyncMemos) } as S] : [])], kids: [{ k: 'text', s: 'first' }] });
  if (reaskName) controls.push({ k: 'el', tag: 'button', click: [{ k: 'call', action: reaskName, args: [] }], kids: [{ k: 'text', s: 'reask' }] });
  const middle = [...controls, ...placed];
  for (let i = middle.length - 1; i > 0; i--) { const j = r.int(i + 1); [middle[i], middle[j]] = [middle[j], middle[i]]; }
  const section: V = { k: 'el', tag: 'section', kids: [...middle, { k: 'el', tag: 'em', kids: [hole(src('status'), 'str')] }] };
  const view: V = r.chance(0.1) ? { k: 'errored', fallback: erroredFallback(asyncMemos), body: [section], err: r.chance(0.5) } : section;
  return { seed, family, hosts, decls, view, actions: actions.map(a => ({ name: (a as { name: string }).name })), script: { seed: seed * 37 + 11, steps: 6 + r.int(14) } };
}

// ------------------------------------------------------------------------------------------------ the chooser

type Scalar = string | number | boolean;
const VALUES: Record<Ty, Scalar[]> = { int: [0, 1, 2, 3, 5], str: ['dev', 'ana', 'bo', '', 'me'], bool: [true, false] };
type Value = Scalar | Value[] | { [k: string]: Value };
/** Picks each step from the live clickables and pending requests, as gen.ts's chooser does: `steps` clicks or
 *  settlements, then every pending request is settled, in random order. A mutation request may reject (it is awaited
 *  in a try); a query request only when its host is rejectable. A query resolves with a fresh list of 0..4 records
 *  (distinct ids) or a scalar. */
export function chooserFor(c: AsyncCase) {
  const r = rng(c.script.seed);
  let n = 0;
  const value = (h: AsyncHost): Value => {
    if (h.scalar) return r.pick(VALUES[h.scalar]);
    const ids = [1, 2, 3, 4, 5].filter(() => r.chance(0.55)).slice(0, 4);
    return ids.map(id => Object.fromEntries(h.rows!.map(f => [f.name, f.name === 'id' ? id : f.name === 'title' ? titles[(id + r.int(2)) % titles.length]
      : f.name === 'owner' ? r.pick(owners) : f.ty === 'int' ? r.int(4) : f.ty === 'bool' ? r.chance(0.5) : r.pick(VALUES.str)])));
  };
  return (live: { clickables: { target: { text: string; parent?: string; index: number } }[]; pending: { host: string; call: number; args: Scalar[] }[] }) => {
    const draining = n >= c.script.steps;
    n++;
    const settle = () => {
      const q = r.pick(live.pending);
      const h = c.hosts.find(h => h.name === q.host)!;
      if (h.rejectable && r.chance(h.role === 'query' ? 0.2 : 0.3)) return { type: 'reject' as const, host: q.host, call: q.call, args: q.args, error: r.pick(['offline', 'denied']) };
      return { type: 'resolve' as const, host: q.host, call: q.call, args: q.args, value: value(h) };
    };
    if (draining) return live.pending.length ? settle() : null;
    if (live.pending.length && (r.chance(0.45) || !live.clickables.length)) return settle();
    if (!live.clickables.length) return null;
    return { type: 'click' as const, target: r.pick(live.clickables).target };
  };
}

// ------------------------------------------------------------------------------------------------ printing

/** The scenario's host signatures: `returns` printed canonically (plan/types.ts printType), as the plan prints it. */
export const asyncHostSigs = (c: AsyncCase): HostSig[] => c.hosts.map(h => ({ name: h.name, parameters: h.params.map(p => TS_TYPE[p] as 'number' | 'string' | 'boolean'), returns: printType(parseType(h.returns)), async: true }));

/** The program's files: App.tsx (Solid, the async tier), App.rx and api.d.rx. */
export function emitAsync(c: AsyncCase): Record<string, string> {
  const tsx = { tsx: true }, rx = { tsx: false };
  const json = JSON.stringify(c);
  const used = (k: string) => json.includes('"k":"' + k + '"');
  const imports = ['createMemo', ...(c.decls.some(d => d.k === 'action') ? ['action'] : []), 'createSignal', ...(used('for') ? ['For'] : []), ...(used('show') ? ['Show'] : []),
    ...(used('loading') ? ['Loading'] : []), ...(used('errored') ? ['Errored'] : []), ...(used('pending') ? ['isPending'] : []), ...(used('latest') ? ['latest'] : []),
    ...(used('refresh') ? ['refresh'] : []), ...(used('affects') ? ['affects'] : [])].sort();
  const hostImport = 'import { ' + c.hosts.map(h => h.name).join(', ') + ' } from "./api";';
  const t: string[] = ['import { ' + imports.join(', ') + ' } from "solid-js";', hostImport, '', 'export default function App() {'];
  const x: string[] = [hostImport, '', 'export default component App() {'];
  const hostsAsGen = c.hosts.map(h => ({ name: h.name, params: h.params, returns: (h.scalar ?? 'str') as Ty, caught: true, role: 'row' as const }));
  for (const d of c.decls) {
    if (d.k === 'signal') { t.push('  const [' + d.name + ', ' + setter(d.name) + '] = createSignal(' + jsValue(d.v) + ');'); x.push('  source ' + d.name + ' := ' + jsValue(d.v) + ';'); }
    else if (d.k === 'amemo') {
      t.push('  const ' + d.name + ' = createMemo(() => ' + d.host + '(' + d.args.map(a => pe(a, tsx)).join(', ') + '));');
      x.push('  ' + d.name + ' = await ' + d.host + '(' + d.args.map(a => pe(a, rx)).join(', ') + ');');
    } else if (d.k === 'memo') { t.push('  const ' + d.name + ' = createMemo(() => ' + pe(d.e, tsx) + ');'); x.push('  ' + d.name + ' = ' + pe(d.e, rx) + ';'); }
    else {
      t.push('  const ' + d.name + ' = action(function* (' + d.params.map(([p, ty]) => p + ': ' + TS_TYPE[ty]).join(', ') + ') {', ...d.body.flatMap(s => ps(s, tsx, hostsAsGen, '    ')), '  });');
      x.push('  action ' + d.name + '(' + d.params.map(([p, ty]) => p + ': ' + TS_TYPE[ty]).join(', ') + ') {', ...d.body.flatMap(s => ps(s, rx, hostsAsGen, '    ')), '  }');
    }
  }
  t.push('  return (', '    ' + pv(c.view, tsx, hostsAsGen), '  );', '}');
  x.push('', '  ' + pv(c.view, rx, hostsAsGen), '}');
  const api = c.hosts.map(h => 'export ' + (h.pure ? 'pure ' : '') + 'fn ' + h.name + '(' + h.params.map((p, i) => 'a' + i + ': ' + TS_TYPE[p]).join(', ') + '): ' + h.returns).join('\n') + '\n';
  return { 'App.tsx': t.join('\n') + '\n', 'App.rx': x.join('\n') + '\n', 'api.d.rx': api };
}
