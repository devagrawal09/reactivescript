// The plan fuzz generator (plan/docs/PLAN-V2.md, "Plan fuzz"): one seeded, deterministic program inside the plan v2
// subset, printed as genuine Solid TSX and as RX (the same program, twin for twin), with its host declarations, plus a
// chooser that drives the scenario recording on native Solid. Programs are tracker-shaped and vary: a store with a row
// list and scalar fields, optimistic sources over a store path or a signal (guessed by updaters or values),
// filter/map/length/indexOf memos, Show/For with identity-keyed rows (Show in rows, For in Show), per-row actions with
// one or two awaits, try/catch, strings and concatenation, plain handlers (filter toggles, store and signal writes) and
// handlers that write and call. The chooser clicks live targets and settles pending requests in any order, resolving or
// (when the await is inside a try) rejecting them, so actions overlap and settle out of order, filters toggle while
// actions are pending, one row is claimed twice, and the store changes under a live guess.
// A small share of programs (family "outside") carries one form outside the plan subset; the emitter must refuse them.
import { rng } from '../../tsx/fuzz/gen.ts';

/** Babel's confident evaluation (plan/resolve-v2.ts `confident`), over this generator's expressions. */
function confident(e: E): { ok: true; v: unknown } | { ok: false } {
  const no = { ok: false } as const;
  if (e.k === 'lit') return { ok: true, v: e.v };
  if (e.k === 'not') { const x = confident(e.e); return x.ok ? { ok: true, v: !x.v } : no; }
  if (e.k === 'cond') { const c = confident(e.c); return c.ok ? confident(c.v ? e.t : e.f) : no; }
  if (e.k !== 'bin') return no;
  const l = confident(e.l);
  if (e.op === '&&' || e.op === '||') return !l.ok ? no : (e.op === '&&' ? !l.v : l.v) ? l : confident(e.r);
  const r = confident(e.r);
  if (!l.ok || !r.ok) return no;
  const a = l.v as any, b = r.v as any;
  const v = e.op === '+' ? a + b : e.op === '==' ? a === b : e.op === '!=' ? a !== b : e.op === '<' ? a < b : e.op === '<=' ? a <= b : e.op === '>' ? a > b : e.op === '>=' ? a >= b : undefined;
  return v === undefined ? no : { ok: true, v };
}

export type Ty = 'int' | 'str' | 'bool';
export type E =
  | { k: 'lit'; v: number | string | boolean }
  | { k: 'src'; name: string }                 // a signal, memo or optimistic source: RX `x`, TSX `x()`
  | { k: 'store'; name: string }               // a store root: RX and TSX `s` (TSX `d` inside a setStore draft)
  | { k: 'local'; name: string }
  | { k: 'get'; o: E; key: string }
  | { k: 'len'; a: E }
  | { k: 'filter' | 'map' | 'find'; a: E; p: string; body: E }
  | { k: 'bin'; op: '+' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||' | '*' | '-'; l: E; r: E }
  | { k: 'not'; e: E }
  | { k: 'cond'; c: E; t: E; f: E }
  | { k: 'rec'; fields: [string, E][] };
export type Seg = { key: string } | { index: E };
export type S =
  | { k: 'set'; name: string; e: E }
  | { k: 'path'; store: string; path: Seg[]; e: E }
  | { k: 'guess'; name: string; p?: string; body?: E; value?: E }
  | { k: 'await'; bind: string; host: string; args: E[] }
  | { k: 'try'; body: S[]; handler: S[] }
  | { k: 'call'; action: string; args: E[] };
export type V =
  | { k: 'el'; tag: string; click?: S[]; kids: V[] }
  | { k: 'text'; s: string }
  | { k: 'hole'; e: E; ty: Ty }
  | { k: 'show'; c: E; then: V[]; else: V[] }
  | { k: 'for'; each: E; item: string; body: V[] };
export type Decl =
  | { k: 'signal'; name: string; v: string | number | boolean }
  | { k: 'store'; name: string; v: Record<string, unknown> }
  | { k: 'optimistic'; name: string; e: E }
  | { k: 'memo'; name: string; e: E }
  | { k: 'action'; name: string; params: [string, Ty][]; body: S[] };
/** role: the first await of a row action (its argument is the row id), a second await, or a scalar action's await. */
export type Host = { name: string; params: Ty[]; returns: Ty; caught: boolean; role: 'row' | 'second' | 'scalar' };
export type Case = {
  seed: number; family: string;
  hosts: Host[]; decls: Decl[]; view: V;
  actions: { name: string }[];
  script: { seed: number; steps: number };
};

export const TS_TYPE: Record<Ty, string> = { int: 'number', str: 'string', bool: 'boolean' };
const HOST_TYPE: Record<Ty, 'number' | 'string' | 'boolean'> = { int: 'number', str: 'string', bool: 'boolean' };

// ------------------------------------------------------------------------------------------------ generation

type Field = { name: string; ty: Ty };
type Scope = {
  scalars: { e: E; ty: Ty }[];        // readable scalar expressions (sources, memos, store fields, locals' fields)
  lists: E[];                          // readable row lists
  row?: E;                             // a row in scope (lambda parameter or row item)
};

export function generate(seed: number): Case {
  const r = rng(seed * 7919 + 17);
  const families = ['tracker', 'tracker', 'scalar', 'mixed', 'mixed', 'strings', 'rows', 'outside'];
  const family = families[r.int(families.length)];
  let lambdas = 0;
  const lam = () => 'x' + lambdas++;

  // ---- the store: a row list with ids and a few fields, maybe scalar fields beside it
  const pool: Field[] = [{ name: 'owner', ty: 'str' }, { name: 'n', ty: 'int' }, { name: 'done', ty: 'bool' }, { name: 'tag', ty: 'str' }];
  const extra = pool.filter(f => r.chance(0.55) || family === 'rows' && f.name === 'done');
  if (!extra.length) extra.push(pool[r.int(pool.length)]);
  const fields: Field[] = [{ name: 'id', ty: 'int' }, { name: 'title', ty: 'str' }, ...extra];
  const titles = ['Crash', 'Slow', 'Typo', 'Docs', 'Leak', 'Build'];
  const owners = ['', 'ana', '', 'bo', 'me'];
  const rows = Array.from({ length: 2 + r.int(3) }, (_, i) => Object.fromEntries(fields.map(f => [f.name,
    f.name === 'id' ? i + 1 : f.name === 'title' ? titles[(i + r.int(2)) % titles.length] + (r.chance(0.3) ? ' ' + (i + 1) : '')
      : f.ty === 'str' ? owners[r.int(owners.length)] : f.ty === 'int' ? r.int(4) : r.chance(0.5)])));
  const storeName = r.pick(['issues', 'db', 'items']);
  const scalarFields: Field[] = [];
  if (family === 'scalar' || r.chance(0.4)) scalarFields.push({ name: 'total', ty: 'int' });
  if (r.chance(0.3)) scalarFields.push({ name: 'note', ty: 'str' });
  const storeSeed: Record<string, unknown> = { list: rows };
  for (const f of scalarFields) storeSeed[f.name] = f.ty === 'int' ? r.int(3) : 'n/a';
  const store: E = { k: 'store', name: storeName };
  const list: E = { k: 'get', o: store, key: 'list' };

  // ---- signals
  const decls: Decl[] = [{ k: 'store', name: storeName, v: storeSeed }];
  const signals: { name: string; ty: Ty; v: string | number | boolean }[] = [{ name: 'mode', ty: 'str', v: 'all' }, { name: 'status', ty: 'str', v: '' }];
  if (r.chance(0.5) || family === 'scalar') signals.push({ name: 'count', ty: 'int', v: r.int(3) });
  if (r.chance(0.35)) signals.push({ name: 'flag', ty: 'bool', v: r.chance(0.5) });
  if (family === 'strings') signals.push({ name: 'label', ty: 'str', v: 'L' });

  // ---- optimistic sources: the shown list over the store list, and maybe a scalar over a store field or a signal
  // Row actions guess the shown list; without one, an unguessed derived source would be an async question (outside
  // plan v2), so the memos read the store list itself.
  const nRow = family === 'scalar' ? r.int(2) : family === 'rows' ? 2 + r.int(2) : 1 + (r.chance(0.35) ? 1 : 0);
  const shownName = 'shown';
  if (nRow) decls.push({ k: 'optimistic', name: shownName, e: list });
  const shown: E = nRow ? { k: 'src', name: shownName } : list;
  let scalarOpt: { name: string; ty: 'int'; base: { store: true; field: string } | { store: false; signal: string } } | undefined;
  const intSignals = signals.filter(s => s.ty === 'int');
  if (family === 'scalar' || family === 'mixed' || r.chance(0.3)) {
    const fromStore = scalarFields.some(f => f.name === 'total') && (!intSignals.length || r.chance(0.5));
    if (fromStore) scalarOpt = { name: 'shownTotal', ty: 'int', base: { store: true, field: 'total' } };
    else if (intSignals.length) scalarOpt = { name: 'shownCount', ty: 'int', base: { store: false, signal: intSignals[0].name } };
    if (scalarOpt) decls.push({ k: 'optimistic', name: scalarOpt.name, e: scalarOpt.base.store ? { k: 'get', o: store, key: scalarOpt.base.field } : { k: 'src', name: scalarOpt.base.signal } });
  }
  // Declaration order (TSX and RX alike): the store, the signals, the optimistic sources, the memos, the actions.
  decls.splice(1, 0, ...signals.map(s => ({ k: 'signal' as const, name: s.name, v: s.v })));

  // ---- typed expressions
  const reactiveScalars = (): { e: E; ty: Ty }[] => [
    ...signals.map(s => ({ e: { k: 'src', name: s.name } as E, ty: s.ty })),
    ...scalarFields.map(f => ({ e: { k: 'get', o: store, key: f.name } as E, ty: f.ty })),
    ...(scalarOpt ? [{ e: { k: 'src', name: scalarOpt.name } as E, ty: 'int' as Ty }] : []),
    ...memoScalars,
  ];
  const memoScalars: { e: E; ty: Ty }[] = [];
  const memoLists: E[] = [];
  const lit = (ty: Ty): E => ({ k: 'lit', v: ty === 'int' ? r.int(4) : ty === 'str' ? r.pick(['', 'me', 'ana', 'x', 'all', 'open']) : r.chance(0.5) });
  const fieldOf = (row: E, ty: Ty): E | undefined => {
    const fs = fields.filter(f => f.ty === ty);
    return fs.length ? { k: 'get', o: row, key: r.pick(fs).name } : undefined;
  };
  const ex = (ty: Ty, sc: Scope, depth: number): E => {
    const leaves: (() => E | undefined)[] = [() => lit(ty)];
    const scal = sc.scalars.filter(s => s.ty === ty);
    if (scal.length) leaves.push(() => r.pick(scal).e, () => r.pick(scal).e);
    if (sc.row) leaves.push(() => fieldOf(sc.row!, ty), () => fieldOf(sc.row!, ty));
    if (ty === 'int' && sc.lists.length) leaves.push(() => ({ k: 'len', a: r.pick(sc.lists) }));
    const leaf = (): E => { for (;;) { const e = r.pick(leaves)(); if (e) return e; } };
    if (depth <= 0 || r.chance(0.3)) return leaf();
    const d = depth - 1;
    if (ty === 'int') {
      const forms: (() => E)[] = [() => ({ k: 'bin', op: '+', l: ex('int', sc, d), r: ex('int', sc, d) }), () => ({ k: 'cond', c: ex('bool', sc, d), t: ex('int', sc, d), f: ex('int', sc, d) })];
      if (sc.lists.length) forms.push(() => { const p = lam(); return { k: 'len', a: { k: 'filter', a: r.pick(sc.lists), p, body: ex('bool', { ...sc, row: { k: 'local', name: p } }, d) } }; },
        () => { const p = lam(); return { k: 'find', a: r.pick(sc.lists), p, body: ex('bool', { ...sc, row: { k: 'local', name: p } }, d) }; });
      return r.pick(forms)();
    }
    if (ty === 'str') {
      const forms: (() => E)[] = [
        () => ({ k: 'bin', op: '+', l: ex('str', sc, d), r: ex(r.chance(0.5) ? 'str' : 'int', sc, d) }),
        () => ({ k: 'bin', op: '||', l: ex('str', sc, d), r: ex('str', sc, d) }),
        () => ({ k: 'cond', c: ex('bool', sc, d), t: ex('str', sc, d), f: ex('str', sc, d) }),
      ];
      return r.pick(forms)();
    }
    const forms: (() => E)[] = [
      () => { const t: Ty = r.pick(['int', 'str']); return { k: 'bin', op: r.pick(['==', '!=']), l: ex(t, sc, d), r: ex(t, sc, d) }; },
      () => ({ k: 'bin', op: r.pick(['<', '<=', '>', '>=']), l: ex('int', sc, d), r: ex('int', sc, d) }),
      () => ({ k: 'not', e: ex('bool', sc, d) }),
      () => ({ k: 'bin', op: r.pick(['&&', '||']), l: ex('bool', sc, d), r: ex('bool', sc, d) }),
    ];
    return r.pick(forms)();
  };
  const reads = (e: E): boolean => e.k === 'src' || e.k === 'store' || e.k === 'local' ||
    (e.k === 'get' && reads(e.o)) || (e.k === 'len' && reads(e.a)) || ((e.k === 'filter' || e.k === 'map' || e.k === 'find') && (reads(e.a) || reads(e.body))) ||
    (e.k === 'bin' && (reads(e.l) || reads(e.r))) || (e.k === 'not' && reads(e.e)) || (e.k === 'cond' && (reads(e.c) || reads(e.t) || reads(e.f))) ||
    (e.k === 'rec' && e.fields.some(([, v]) => reads(v)));
  /** A reactive expression that reads something, and that Solid's compiler cannot fold to a constant (a constant one
   *  would be static text or a constant memo; plan/resolve-v2.ts refuses a hole the compiler folds). */
  const reading = (ty: Ty, sc: Scope, depth: number): E => {
    for (let i = 0; i < 12; i++) { const e = ex(ty, sc, depth); if (reads(e) && !confident(e).ok) return e; }
    const scal = sc.scalars.filter(s => s.ty === ty);
    if (scal.length) return r.pick(scal).e;
    return ty === 'int' ? { k: 'len', a: sc.lists[0] ?? shown } : ty === 'str' ? { k: 'bin', op: '+', l: { k: 'lit', v: '#' }, r: { k: 'len', a: sc.lists[0] ?? shown } } : { k: 'bin', op: '>', l: { k: 'len', a: sc.lists[0] ?? shown }, r: { k: 'lit', v: 0 } };
  };

  // ---- memos: a filter of the shown list (the visible rows), a length, maybe an indexOf, a map, a scalar
  const decl = (d: Decl) => decls.push(d);
  const top = (): Scope => ({ scalars: reactiveScalars(), lists: [shown, ...memoLists] });
  {
    const p = lam();
    const pred = (): E => {
      const row: E = { k: 'local', name: p };
      const own = fields.find(f => f.name === 'owner') ?? fields.find(f => f.ty === 'str' && f.name !== 'title');
      const base: E = own ? { k: 'bin', op: '==', l: { k: 'get', o: row, key: own.name }, r: { k: 'lit', v: '' } }
        : ex('bool', { scalars: [], lists: [], row }, 1);
      if (r.chance(0.6)) return { k: 'bin', op: '||', l: { k: 'bin', op: '==', l: { k: 'src', name: 'mode' }, r: { k: 'lit', v: 'all' } }, r: base };
      return ex('bool', { scalars: reactiveScalars(), lists: [], row }, 2);
    };
    decl({ k: 'memo', name: 'visible', e: { k: 'filter', a: shown, p, body: pred() } });
    memoLists.push({ k: 'src', name: 'visible' });
  }
  {
    const p = lam();
    decl({ k: 'memo', name: 'open', e: { k: 'len', a: { k: 'filter', a: shown, p, body: ex('bool', { scalars: [], lists: [], row: { k: 'local', name: p } }, 1 + r.int(2)) } } });
    memoScalars.push({ e: { k: 'src', name: 'open' }, ty: 'int' });
  }
  if (r.chance(0.4)) {
    const p = lam();
    decl({ k: 'memo', name: 'firstAt', e: { k: 'find', a: shown, p, body: ex('bool', { scalars: [], lists: [], row: { k: 'local', name: p } }, 1) } });
    memoScalars.push({ e: { k: 'src', name: 'firstAt' }, ty: 'int' });
  }
  if (r.chance(0.35) || family === 'strings') {
    const p = lam();
    decl({ k: 'memo', name: 'names', e: { k: 'map', a: shown, p, body: { k: 'bin', op: '+', l: { k: 'get', o: { k: 'local', name: p }, key: 'title' }, r: { k: 'lit', v: r.pick(['!', ':', '/']) } } } });
    memoScalars.push({ e: { k: 'len', a: { k: 'src', name: 'names' } }, ty: 'int' });
  }
  if (r.chance(0.5)) {
    const ty: Ty = r.pick(['int', 'str', 'bool']);
    decl({ k: 'memo', name: 'derived', e: reading(ty, top(), 2) });
    memoScalars.push({ e: { k: 'src', name: 'derived' }, ty });
  }

  // ---- hosts and actions
  const hosts: Host[] = [];
  const host = (params: Ty[], returns: Ty, caught: boolean, role: Host['role']) => { const h = { name: 'h' + hosts.length, params, returns, caught, role }; hosts.push(h); return h.name; };
  const actions: Decl[] = [];
  const mutable = fields.filter(f => f.name !== 'id' && f.name !== 'title' || f.name === 'title' && family === 'strings');
  const failText = (id?: E): E => id ? { k: 'bin', op: '+', l: { k: 'lit', v: r.pick(['Could not assign #', 'fail ', 'x']) }, r: id } : { k: 'lit', v: r.pick(['failed', 'oops']) };
  const indexOf = (id: E): E => { const p = lam(); return { k: 'find', a: list, p, body: { k: 'bin', op: '==', l: { k: 'get', o: { k: 'local', name: p }, key: 'id' }, r: id } }; };
  // A row action: guess the shown list (the claimed row becomes a fresh record), then await a host and write the store.
  const rowAction = (name: string) => {
    const id: E = { k: 'local', name: 'id' };
    const f = r.pick(mutable.length ? mutable : fields.filter(x => x.name !== 'id'));
    const p = lam(), q = lam();
    const row: E = { k: 'local', name: q };
    const guessed = (fd: Field): E => fd.name === f.name
      ? (f.ty === 'str' ? { k: 'lit', v: r.pick(['me', 'mine', '?']) } : f.ty === 'int' ? { k: 'bin', op: '+', l: { k: 'get', o: row, key: f.name }, r: { k: 'lit', v: 1 } } : { k: 'not', e: { k: 'get', o: row, key: f.name } })
      : { k: 'get', o: row, key: fd.name };
    const body: S[] = [];
    const guessFirst = r.chance(0.85);
    const guess: S = { k: 'guess', name: shownName, p, body: { k: 'map', a: { k: 'local', name: p }, p: q, body: { k: 'cond', c: { k: 'bin', op: '==', l: { k: 'get', o: row, key: 'id' }, r: id }, t: { k: 'rec', fields: fields.map(fd => [fd.name, guessed(fd)]) }, f: row } } };
    if (guessFirst) body.push(guess);
    const caught = true; // an await outside a try is UNCAUGHT_ACTION_FAILURE
    const inner: S[] = [];
    const writtenSignals = new Set<string>();
    if (r.chance(0.25)) { inner.push({ k: 'set', name: 'status', e: { k: 'bin', op: '+', l: { k: 'lit', v: 'saving #' }, r: id } }); writtenSignals.add('status'); }
    const bind = 'got' + actions.length;
    inner.push({ k: 'await', bind, host: host(['int'], f.ty, caught, 'row'), args: [id] });
    if (!guessFirst) inner.push(guess);
    inner.push({ k: 'path', store: storeName, path: [{ key: 'list' }, { index: indexOf(id) }, { key: f.name }], e: { k: 'local', name: bind } });
    if (r.chance(0.3)) {
      // A second await in the same action.
      const b2 = 'again' + actions.length;
      const t: Ty = scalarFields.length && r.chance(0.5) ? scalarFields[0].ty : 'str';
      inner.push({ k: 'await', bind: b2, host: host(['int'], t, caught, 'second'), args: [r.chance(0.5) ? id : { k: 'lit', v: r.int(3) }] });
      if (t === 'str' && !writtenSignals.has('status')) { inner.push({ k: 'set', name: 'status', e: { k: 'bin', op: '+', l: { k: 'local', name: b2 }, r: id } }); writtenSignals.add('status'); }
      else if (scalarFields.length && scalarFields[0].ty === t) inner.push({ k: 'path', store: storeName, path: [{ key: scalarFields[0].name }], e: { k: 'local', name: b2 } });
    }
    if (!writtenSignals.has('status') && r.chance(0.6)) { inner.push({ k: 'set', name: 'status', e: { k: 'lit', v: '' } }); writtenSignals.add('status'); }
    if (caught) body.push({ k: 'try', body: inner, handler: [{ k: 'set', name: 'status', e: failText(r.chance(0.7) ? id : undefined) }] });
    else body.push(...inner);
    actions.push({ k: 'action', name, params: [['id', 'int']], body });
  };
  // A scalar action: guess a scalar optimistic source, await, write its base.
  const scalarAction = (name: string) => {
    if (!scalarOpt) return;
    const body: S[] = [];
    const caught = true;
    if (r.chance(0.7)) { const p = lam(); body.push({ k: 'guess', name: scalarOpt.name, p, body: { k: 'bin', op: '+', l: { k: 'local', name: p }, r: { k: 'lit', v: 1 + r.int(2) } } }); }
    else body.push({ k: 'guess', name: scalarOpt.name, value: { k: 'lit', v: 5 + r.int(3) } });
    const bind = 'got' + actions.length;
    const inner: S[] = [{ k: 'await', bind, host: host([], 'int', caught, 'scalar'), args: [] }];
    inner.push(scalarOpt.base.store ? { k: 'path', store: storeName, path: [{ key: scalarOpt.base.field }], e: { k: 'local', name: bind } } : { k: 'set', name: scalarOpt.base.signal, e: { k: 'local', name: bind } });
    if (caught) body.push({ k: 'try', body: inner, handler: [{ k: 'set', name: 'status', e: failText() }] });
    else body.push(...inner);
    actions.push({ k: 'action', name, params: [], body });
  };
  const rowActions: string[] = [];
  for (let i = 0; i < nRow; i++) { const n = ['claim', 'take', 'grab'][i]; rowAction(n); rowActions.push(n); }
  let scalarActionName: string | undefined;
  if (scalarOpt) { scalarAction('bump'); scalarActionName = 'bump'; }
  decls.push(...actions);

  // ---- markup
  const stringy = (sc: Scope): V => {
    const ty: Ty = r.chance(0.5) ? 'str' : 'int';
    return { k: 'hole', e: reading(ty, sc, 2), ty };
  };
  const kids: V[] = [];
  // The filter toggle (a plain handler that writes and reads mode).
  kids.push({ k: 'el', tag: 'button', click: [{ k: 'set', name: 'mode', e: { k: 'cond', c: { k: 'bin', op: '==', l: { k: 'src', name: 'mode' }, r: { k: 'lit', v: 'all' } }, t: { k: 'lit', v: 'open' }, f: { k: 'lit', v: 'all' } } }], kids: [{ k: 'text', s: 'Filter: ' }, { k: 'hole', e: { k: 'src', name: 'mode' }, ty: 'str' }] });
  kids.push({ k: 'el', tag: 'b', kids: [{ k: 'hole', e: { k: 'src', name: 'open' }, ty: 'int' }, { k: 'text', s: ' open' }] });
  // The rows.
  const item = 'issue';
  const itemE: E = { k: 'local', name: item };
  const rowKids: V[] = [{ k: 'hole', e: { k: 'get', o: itemE, key: 'title' }, ty: 'str' }, { k: 'text', s: ': ' }];
  const second = fields.find(f => f.name !== 'id' && f.name !== 'title');
  if (second) rowKids.push(second.ty === 'str' ? { k: 'hole', e: { k: 'bin', op: '||', l: { k: 'get', o: itemE, key: second.name }, r: { k: 'lit', v: 'nobody' } }, ty: 'str' }
    : second.ty === 'int' ? { k: 'hole', e: { k: 'get', o: itemE, key: second.name }, ty: 'int' }
      : { k: 'show', c: { k: 'get', o: itemE, key: second.name }, then: [{ k: 'el', tag: 's', kids: [{ k: 'text', s: 'done' }] }], else: [{ k: 'el', tag: 'u', kids: [{ k: 'text', s: 'todo' }] }] });
  if (r.chance(0.3)) rowKids.push({ k: 'el', tag: 'i', kids: [stringy({ scalars: [], lists: [], row: itemE })] });
  if (fields.some(f => f.name === 'done') && second?.name !== 'done' && (family === 'rows' || r.chance(0.4)))
    rowKids.push({ k: 'show', c: { k: 'get', o: itemE, key: 'done' }, then: [{ k: 'el', tag: 's', kids: [{ k: 'text', s: 'ok' }] }], else: [] });
  for (const a of rowActions) {
    const label = a === 'claim' ? 'take' : a === 'take' ? 'mine' : a;
    const click: S[] = [];
    if (r.chance(0.15)) click.push({ k: 'set', name: 'status', e: { k: 'lit', v: '' } });
    click.push({ k: 'call', action: a, args: [{ k: 'get', o: itemE, key: 'id' }] });
    rowKids.push({ k: 'el', tag: 'button', click, kids: [{ k: 'text', s: label }] });
  }
  if (family === 'rows' || r.chance(0.35)) {
    // A plain store write from a row: the row's own record (it may be guessed) changes under a live guess.
    const f = mutable.find(x => x.ty === 'int') ?? mutable.find(x => x.ty === 'str');
    if (f) rowKids.push({ k: 'el', tag: 'button', click: [{ k: 'path', store: storeName, path: [{ key: 'list' }, { index: indexOf({ k: 'get', o: itemE, key: 'id' }) }, { key: f.name }], e: f.ty === 'int' ? { k: 'bin', op: '+', l: { k: 'get', o: itemE, key: f.name }, r: { k: 'lit', v: 1 } } : { k: 'lit', v: 'zed' } }], kids: [{ k: 'text', s: 'edit' }] });
  }
  const rowView: V = { k: 'el', tag: 'p', kids: rowKids };
  // A row is one element, or sometimes two (an array of templates per row).
  const rowBody: V[] = r.chance(0.2) ? [rowView, { k: 'el', tag: 'small', kids: [{ k: 'hole', e: { k: 'get', o: itemE, key: 'id' }, ty: 'int' }] }] : [rowView];
  const forView: V = { k: 'for', each: { k: 'src', name: 'visible' }, item, body: rowBody };
  kids.push({ k: 'show', c: { k: 'bin', op: '>', l: { k: 'len', a: { k: 'src', name: 'visible' } }, r: { k: 'lit', v: 0 } }, then: [forView], else: r.chance(0.8) ? [{ k: 'el', tag: 'i', kids: [{ k: 'text', s: 'Nothing to triage' }] }] : [] });
  if (scalarOpt && scalarActionName) kids.push({ k: 'el', tag: 'div', kids: [{ k: 'hole', e: { k: 'src', name: scalarOpt.name }, ty: 'int' }, { k: 'el', tag: 'button', click: [{ k: 'call', action: scalarActionName, args: [] }], kids: [{ k: 'text', s: 'bump' }] }] });
  // A store write under a live guess: change the first row's field, or a scalar field, from a plain handler.
  if (r.chance(0.6)) {
    const f = mutable[r.int(mutable.length)] ?? fields[1];
    const value: E = f.ty === 'str' ? { k: 'lit', v: r.pick(['zoe', '', 'ana']) } : f.ty === 'int' ? { k: 'lit', v: r.int(5) } : { k: 'lit', v: r.chance(0.5) };
    kids.push({ k: 'el', tag: 'button', click: [{ k: 'path', store: storeName, path: [{ key: 'list' }, { index: { k: 'lit', v: r.int(rows.length) } }, { key: f.name }], e: value }], kids: [{ k: 'text', s: 'poke' }] });
  }
  if (intSignals.length && r.chance(0.6)) {
    const s = intSignals[0].name;
    kids.push({ k: 'el', tag: 'button', click: [{ k: 'set', name: s, e: { k: 'bin', op: '+', l: { k: 'src', name: s }, r: { k: 'lit', v: 1 } } }], kids: [{ k: 'text', s: 'inc' }] });
  }
  if (scalarFields.some(f => f.name === 'total') && r.chance(0.5))
    kids.push({ k: 'el', tag: 'button', click: [{ k: 'path', store: storeName, path: [{ key: 'total' }], e: { k: 'bin', op: '+', l: { k: 'get', o: store, key: 'total' }, r: { k: 'lit', v: 2 } } }], kids: [{ k: 'text', s: 'add' }] });
  if (signals.some(s => s.name === 'flag') && r.chance(0.7))
    kids.push({ k: 'el', tag: 'button', click: [{ k: 'set', name: 'flag', e: { k: 'not', e: { k: 'src', name: 'flag' } } }], kids: [{ k: 'text', s: 'flip' }] });
  if (rowActions.length && r.chance(0.3))
    kids.push({ k: 'el', tag: 'button', click: [{ k: 'set', name: 'status', e: { k: 'lit', v: 'go' } }, { k: 'call', action: rowActions[0], args: [{ k: 'lit', v: 1 + r.int(rows.length) }] }], kids: [{ k: 'text', s: 'first' }] });
  for (let i = r.int(3); i > 0; i--) kids.push({ k: 'el', tag: r.pick(['span', 'small', 'code']), kids: [stringy(top())] });
  if (r.chance(0.3)) {
    // A second list, over an inline filter of the shown rows (For's each is then a getter with a lambda).
    const p = lam(), it = 'row';
    const each: E = { k: 'filter', a: shown, p, body: ex('bool', { scalars: reactiveScalars(), lists: [], row: { k: 'local', name: p } }, 1 + r.int(2)) };
    kids.push({ k: 'el', tag: 'ul', kids: [{ k: 'for', each, item: it, body: [{ k: 'el', tag: 'li', kids: [{ k: 'hole', e: { k: 'get', o: { k: 'local', name: it }, key: 'title' }, ty: 'str' }, { k: 'text', s: '#' }, { k: 'hole', e: { k: 'get', o: { k: 'local', name: it }, key: 'id' }, ty: 'int' }] }] }] });
  }
  if (r.chance(0.4)) kids.push({ k: 'show', c: reading('bool', top(), 2), then: r.chance(0.3) ? [{ k: 'el', tag: 'mark', kids: [stringy(top())] }, { k: 'el', tag: 'sub', kids: [{ k: 'text', s: 'and' }] }] : [{ k: 'el', tag: 'mark', kids: [stringy(top())] }], else: r.chance(0.5) ? [{ k: 'el', tag: 'del', kids: [{ k: 'text', s: 'none' }] }, { k: 'el', tag: 'ins', kids: [stringy(top())] }] : [] });
  kids.push({ k: 'el', tag: 'em', kids: [{ k: 'hole', e: { k: 'src', name: 'status' }, ty: 'str' }] });
  if (family === 'outside') {
    // One form outside the plan subset that both frontends accept, which the emitter must refuse: multiplication,
    // subtraction, or a text hole Solid's compiler folds to a constant (a dead read). (Template strings and optional
    // chaining are outside the TSX frontend itself.)
    const form = r.int(3);
    const e: E = form === 0 ? { k: 'bin', op: '*', l: { k: 'src', name: 'open' }, r: { k: 'lit', v: 2 } }
      : form === 1 ? { k: 'bin', op: '-', l: { k: 'src', name: 'open' }, r: { k: 'lit', v: 1 } }
      : { k: 'cond', c: { k: 'lit', v: false }, t: { k: 'len', a: shown }, f: { k: 'lit', v: 7 } };
    kids.push({ k: 'el', tag: 'q', kids: [{ k: 'hole', e, ty: 'int' }] });
  }
  // Shuffle the middle children a little (the filter button stays first, status last).
  const middle = kids.slice(1, -1);
  for (let i = middle.length - 1; i > 0; i--) { const j = r.int(i + 1); [middle[i], middle[j]] = [middle[j], middle[i]]; }
  const view: V = { k: 'el', tag: 'section', kids: [kids[0], ...middle, kids[kids.length - 1]] };
  return {
    seed, family, hosts, decls, view,
    actions: actions.map(a => ({ name: (a as { name: string }).name })),
    script: { seed: seed * 31 + 7, steps: 4 + r.int(11) },
  };
}

// ------------------------------------------------------------------------------------------------ the chooser

const VALUES: Record<Ty, (Scalar)[]> = { int: [0, 1, 2, 3, 5], str: ['dev', 'ana', 'bo', '', 'me'], bool: [true, false] };
type Scalar = string | number | boolean;
/** Picks each scenario step from the live clickables and pending requests: `steps` clicks or settlements, then every
 *  pending request is settled, in random order. A request is rejected only when its await is inside a try. */
export function chooserFor(c: Case) {
  const r = rng(c.script.seed);
  let n = 0;
  return (live: { clickables: { target: { text: string; parent?: string; index: number } }[]; pending: { host: string; call: number; args: Scalar[] }[] }) => {
    const draining = n >= c.script.steps;
    n++;
    const settle = () => {
      const q = r.pick(live.pending);
      const h = c.hosts.find(h => h.name === q.host)!;
      if (h.caught && r.chance(0.3)) return { type: 'reject' as const, host: q.host, call: q.call, args: q.args, error: r.pick(['offline', 'denied']) };
      return { type: 'resolve' as const, host: q.host, call: q.call, args: q.args, value: r.pick(VALUES[h.returns]) };
    };
    if (draining) return live.pending.length ? settle() : null;
    if (live.pending.length && (r.chance(0.4) || !live.clickables.length)) return settle();
    if (!live.clickables.length) return null;
    // Prefer row buttons and the filter toggle; any live clickable may be chosen.
    const t = r.pick(live.clickables).target;
    return { type: 'click' as const, target: t };
  };
}

// ------------------------------------------------------------------------------------------------ printing

const quote = (s: string) => JSON.stringify(s);
export type Pr = { tsx: boolean; draft?: string };
export function pe(e: E, c: Pr): string {
  switch (e.k) {
    case 'lit': return typeof e.v === 'string' ? quote(e.v) : String(e.v);
    case 'src': return c.tsx ? e.name + '()' : e.name;
    case 'store': return c.tsx && c.draft ? c.draft : e.name;
    case 'local': return e.name;
    case 'get': return /^\d+$/.test(e.key) ? pe(e.o, c) + '[' + e.key + ']' : pe(e.o, c) + '.' + e.key;
    case 'len': return pe(e.a, c) + '.length';
    case 'filter': case 'map': case 'find': {
      const body = e.body.k === 'rec' ? '(' + pe(e.body, c) + ')' : pe(e.body, c);
      if (c.tsx) return pe(e.a, c) + '.' + (e.k === 'find' ? 'findIndex' : e.k) + '((' + e.p + ') => ' + body + ')';
      return (e.k === 'find' ? 'indexOf' : e.k) + '(' + pe(e.a, c) + ', ' + e.p + ' => ' + body + ')';
    }
    case 'bin': {
      const op = c.tsx ? (e.op === '==' ? '===' : e.op === '!=' ? '!==' : e.op) : e.op;
      return '(' + pe(e.l, c) + ' ' + op + ' ' + pe(e.r, c) + ')';
    }
    case 'not': return '!' + pe(e.e, c);
    case 'cond': return '(' + pe(e.c, c) + ' ? ' + pe(e.t, c) + ' : ' + pe(e.f, c) + ')';
    case 'rec': return '{ ' + e.fields.map(([k, v]) => k + ': ' + pe(v, c)).join(', ') + ' }';
  }
}
export const setter = (name: string) => 'set' + name[0].toUpperCase() + name.slice(1);
export function ps(s: S, c: Pr, hosts: Host[], indent: string): string[] {
  switch (s.k) {
    case 'set': return [indent + (c.tsx ? setter(s.name) + '(' + pe(s.e, c) + ');' : s.name + ' := ' + pe(s.e, c) + ';')];
    case 'path': {
      if (!c.tsx) return [indent + s.store + s.path.map(p => 'key' in p ? '.' + p.key : '[' + pe(p.index, c) + ']').join('') + ' := ' + pe(s.e, c) + ';'];
      const d = { ...c, draft: 'draft' };
      return [indent + setter(s.store) + '((draft) => {', indent + '  draft' + s.path.map(p => 'key' in p ? '.' + p.key : '[' + pe(p.index, d) + ']').join('') + ' = ' + pe(s.e, d) + ';', indent + '});'];
    }
    case 'guess': {
      const v = s.body ? (c.tsx ? '(' + s.p + ') => ' : s.p + ' => ') + pe(s.body, c) : pe(s.value!, c);
      return [indent + (c.tsx ? setter(s.name) + '(' + v + ');' : 'optimistic ' + s.name + ' := ' + v + ';')];
    }
    case 'await': {
      const h = hosts.find(h => h.name === s.host)!;
      const call = s.host + '(' + s.args.map(a => pe(a, c)).join(', ') + ')';
      return [indent + (c.tsx ? 'const ' + s.bind + ': ' + TS_TYPE[h.returns] + ' = yield ' + call + ';' : 'let ' + s.bind + ' = await ' + call + ';')];
    }
    case 'try': return [indent + 'try {', ...s.body.flatMap(x => ps(x, c, hosts, indent + '  ')), indent + '} catch (error) {', ...s.handler.flatMap(x => ps(x, c, hosts, indent + '  ')), indent + '}'];
    case 'call': return [indent + s.action + '(' + s.args.map(a => pe(a, c)).join(', ') + ');'];
  }
}
function handler(body: S[], c: Pr, hosts: Host[]): string {
  if (c.tsx && body.length === 1 && body[0].k !== 'path') return '() => ' + ps(body[0], c, hosts, '')[0].replace(/;$/, '');
  return '() => { ' + body.flatMap(x => ps(x, c, hosts, '')).join(' ') + ' }';
}
export function pv(v: V, c: Pr, hosts: Host[]): string {
  switch (v.k) {
    case 'text': return v.s;
    // An int hole is coerced ("" + n): native then inserts the string RX and the plan insert, not the number. A hole whose
    // value is a conditional is coerced too: the TSX frontend lowers a conditional JSX child to control flow (a Show),
    // not to the text hole the RX twin has.
    case 'hole': return '{' + (v.ty === 'int' || v.e.k === 'cond' ? '"" + ' : '') + pe(v.e, c) + '}';
    case 'el': return '<' + v.tag + (v.click ? ' onClick={' + handler(v.click, c, hosts) + '}' : '') + '>' + v.kids.map(k => pv(k, c, hosts)).join('') + '</' + v.tag + '>';
    case 'show': {
      const list = (vs: V[]) => vs.map(k => pv(k, c, hosts)).join('');
      if (!c.tsx) return '{if ' + pe(v.c, c) + ' { ' + list(v.then) + ' }' + (v.else.length ? ' else { ' + list(v.else) + ' }' : '') + '}';
      const fb = v.else.length === 0 ? '' : ' fallback={' + (v.else.length === 1 ? list(v.else) : '<>' + list(v.else) + '</>') + '}';
      return '<Show when={' + pe(v.c, c) + '}' + fb + '>' + list(v.then) + '</Show>';
    }
    case 'for': {
      const body = v.body.map(k => pv(k, c, hosts)).join('');
      if (!c.tsx) return '{for ' + v.item + ' in ' + pe(v.each, c) + ' { ' + body + ' }}';
      return '<For each={' + pe(v.each, c) + '}>{(' + v.item + ') => ' + (v.body.length === 1 ? body : '<>' + body + '</>') + '}</For>';
    }
  }
}
export const jsValue = (v: unknown): string => typeof v === 'string' ? quote(v) : Array.isArray(v) ? '[' + v.map(jsValue).join(', ') + ']'
  : typeof v === 'object' && v !== null ? '{ ' + Object.entries(v).map(([k, x]) => k + ': ' + jsValue(x)).join(', ') + ' }' : String(v);

/** The program's files: App.tsx (Solid), App.rx and api.d.rx (the hosts' declarations). */
export function emit(c: Case): Record<string, string> {
  const tsx: Pr = { tsx: true }, rx: Pr = { tsx: false };
  const used = (k: string) => JSON.stringify(c).includes('"k":"' + k + '"');
  const imports = ['action', 'createMemo', 'createOptimistic', 'createSignal', 'createStore', ...(used('for') ? ['For'] : []), ...(used('show') ? ['Show'] : [])]
    .filter(n => n !== 'action' || c.decls.some(d => d.k === 'action')).filter(n => n !== 'createSignal' || c.decls.some(d => d.k === 'signal')).sort();
  const hostImport = c.hosts.length ? 'import { ' + c.hosts.map(h => h.name).join(', ') + ' } from "./api";' : '';
  const t: string[] = ['import { ' + imports.join(', ') + ' } from "solid-js";', ...(hostImport ? [hostImport] : []), '', 'export default function App() {'];
  const x: string[] = [...(hostImport ? [hostImport, ''] : []), 'export default component App() {'];
  for (const d of c.decls) {
    if (d.k === 'signal') { t.push('  const [' + d.name + ', ' + setter(d.name) + '] = createSignal(' + jsValue(d.v) + ');'); x.push('  source ' + d.name + ' := ' + jsValue(d.v) + ';'); }
    else if (d.k === 'store') { t.push('  const [' + d.name + ', ' + setter(d.name) + '] = createStore(' + jsValue(d.v) + ');'); x.push('  source ' + d.name + ' := ' + jsValue(d.v) + ';'); }
    else if (d.k === 'optimistic') { t.push('  const [' + d.name + ', ' + setter(d.name) + '] = createOptimistic(() => ' + pe(d.e, tsx) + ');'); x.push('  source ' + d.name + ' = ' + pe(d.e, rx) + ';'); }
    else if (d.k === 'memo') { t.push('  const ' + d.name + ' = createMemo(() => ' + pe(d.e, tsx) + ');'); x.push('  ' + d.name + ' = ' + pe(d.e, rx) + ';'); }
    else {
      t.push('  const ' + d.name + ' = action(function* (' + d.params.map(([p, ty]) => p + ': ' + TS_TYPE[ty]).join(', ') + ') {', ...d.body.flatMap(s => ps(s, tsx, c.hosts, '    ')), '  });');
      x.push('  action ' + d.name + '(' + d.params.map(([p, ty]) => p + ': ' + TS_TYPE[ty]).join(', ') + ') {', ...d.body.flatMap(s => ps(s, rx, c.hosts, '    ')), '  }');
    }
  }
  t.push('  return (', '    ' + pv(c.view, tsx, c.hosts), '  );', '}');
  x.push('', '  ' + pv(c.view, rx, c.hosts), '}');
  const api = c.hosts.map(h => 'export fn ' + h.name + '(' + h.params.map((p, i) => 'a' + i + ': ' + TS_TYPE[p]).join(', ') + '): ' + TS_TYPE[h.returns]).join('\n') + '\n';
  return { 'App.tsx': t.join('\n') + '\n', 'App.rx': x.join('\n') + '\n', 'api.d.rx': api };
}
export { HOST_TYPE };

// ------------------------------------------------------------------------------------------------ the yield twin
//
// The same program in the yield dialect (docs/YIELD.md), where the dialect can say it: a memo binds its reads
// (`const r = yield* x`) and returns one expression; holes, Show's when and For's each read inline (`(yield* x)`), so a
// source read inside a lambda there has no yield spelling; an action's try is `attempt(() => h(…), function* () { … })`
// followed by `if (r !== undefined) { … }` as its last statements, so only a try that starts with its one await and
// ends the action has one; events read no source after an attempt; a row creates only parameterless events, and its
// view is one element. Anything else has no yield twin: emitYield returns undefined.
class NoYield extends Error {}
/** Why the last emitYield call found no twin (for the fuzz summary). */
export let lastNoYield = '';
type YCtx = { hoist?: Map<string, string>; rows: Set<string>; lambda: boolean; draft?: string };
const readKey = (e: E): string | undefined => e.k === 'src' ? e.name : e.k === 'get' ? (e.o.k === 'store' ? e.o.name + '.' + e.key : e.o.k === 'local' ? undefined : (readKey(e.o) && e.o.k === 'get' ? readKey(e.o) + '.' + e.key : undefined)) : undefined;
function py(e: E, c: YCtx): string {
  // A source read, or a store path read: hoisted in a memo, inline elsewhere, impossible inside a lambda.
  const key = e.k === 'src' || (e.k === 'get' && (e.o.k === 'store' || (e.o.k === 'get' && readKey(e.o)))) ? readKey(e) : undefined;
  if (key !== undefined) {
    if (c.draft && e.k === 'get' && key.startsWith(c.draft + '.')) return 'draft.' + key.slice(c.draft.length + 1);
    if (c.hoist) { if (!c.hoist.has(key)) c.hoist.set(key, 'r' + c.hoist.size); return c.hoist.get(key)!; }
    if (c.lambda) throw new NoYield('a source read inside a lambda');
    return '(yield* ' + key + ')';
  }
  switch (e.k) {
    case 'lit': return typeof e.v === 'string' ? quote(e.v) : String(e.v);
    case 'store': if (c.draft === e.name) return 'draft'; throw new NoYield('a whole store');
    case 'local': if (c.rows.has(e.name)) throw new NoYield('a whole row'); return e.name;
    case 'get':
      if (e.o.k === 'local' && c.rows.has(e.o.name)) { if (c.lambda) throw new NoYield('a row read inside a lambda'); return '(yield* ' + e.o.name + '.' + e.key + ')'; }
      return /^\d+$/.test(e.key) ? py(e.o, c) + '[' + e.key + ']' : py(e.o, c) + '.' + e.key;
    case 'len': return py(e.a, c) + '.length';
    case 'filter': case 'map': case 'find': {
      const inner = { ...c, lambda: true };
      const body = e.body.k === 'rec' ? '(' + py(e.body, inner) + ')' : py(e.body, inner);
      return py(e.a, c) + '.' + (e.k === 'find' ? 'findIndex' : e.k) + '((' + e.p + ') => ' + body + ')';
    }
    case 'bin': return '(' + py(e.l, c) + ' ' + (e.op === '==' ? '===' : e.op === '!=' ? '!==' : e.op) + ' ' + py(e.r, c) + ')';
    case 'not': return '!' + py(e.e, c);
    case 'cond': return '(' + py(e.c, c) + ' ? ' + py(e.t, c) + ' : ' + py(e.f, c) + ')';
    case 'rec': return '{ ' + e.fields.map(([k, v]) => k + ': ' + py(v, c)).join(', ') + ' }';
    case 'src': throw new Error('a source read has a key');
  }
}
/** An event's statements; `waited`: after an attempt, where no source is read. */
function ys(ss: S[], c: YCtx, hosts: Host[], indent: string, waited: boolean): string[] {
  const out: string[] = [];
  ss.forEach((s, i) => {
    const cx: YCtx = waited ? { ...c, lambda: true } : c;   // after an attempt a read has no yield spelling either
    switch (s.k) {
      case 'set': out.push(indent + 'yield* ' + setter(s.name) + '(' + py(s.e, cx) + ');'); break;
      case 'path': {
        const d: YCtx = { ...cx, draft: s.store, lambda: true };
        out.push(indent + 'yield* ' + setter(s.store) + '((draft) => {', indent + '  draft' + s.path.map(p => 'key' in p ? '.' + p.key : '[' + py(p.index, d) + ']').join('') + ' = ' + py(s.e, d) + ';', indent + '});');
        break;
      }
      case 'guess': {
        const v = s.body ? '(' + s.p + ') => ' + py(s.body, { ...cx, lambda: true }) : py(s.value!, cx);
        out.push(indent + 'yield* ' + setter(s.name) + '(' + v + ');');
        break;
      }
      case 'call': out.push(indent + 'yield* ' + s.action + '(' + s.args.map(a => py(a, cx)).join(', ') + ');'); break;
      case 'try': {
        const [first, ...rest] = s.body;
        if (i !== ss.length - 1 || first?.k !== 'await' || rest.some(x => x.k === 'await' || x.k === 'try')) throw new NoYield('a try the yield attempt cannot spell');
        const call = first.host + '(' + first.args.map(a => py(a, cx)).join(', ') + ')';
        out.push(indent + 'const ' + first.bind + ' = yield* attempt(() => ' + call + ', function* () {', ...ys(s.handler, c, hosts, indent + '  ', true), indent + '});',
          indent + 'if (' + first.bind + ' !== undefined) {', ...ys(rest, c, hosts, indent + '  ', true), indent + '}');
        break;
      }
      case 'await': throw new NoYield('an await outside a try');
    }
  });
  return out;
}
export function emitYield(c: Case): string | undefined {
  try {
    const setup: string[] = [];
    const base: YCtx = { rows: new Set(), lambda: false };
    for (const d of c.decls) {
      if (d.k === 'signal') setup.push('const [' + d.name + ', ' + setter(d.name) + '] = yield* $signal(' + jsValue(d.v) + ');');
      else if (d.k === 'store') setup.push('const [' + d.name + ', ' + setter(d.name) + '] = yield* $store(' + jsValue(d.v) + ');');
      else if (d.k === 'optimistic') setup.push('const [' + d.name + ', ' + setter(d.name) + '] = yield* $optimistic(function* () { return ' + py(d.e, base).replace(/^\(yield\* (.*)\)$/, 'yield* $1') + '; });');
      else if (d.k === 'memo') {
        const hoist = new Map<string, string>();
        const body = py(d.e, { ...base, hoist });
        setup.push('const ' + d.name + ' = yield* $memo(function* () {', ...[...hoist].map(([k, v]) => '  const ' + v + ' = yield* ' + k + ';'), '  return ' + body + ';', '});');
      } else setup.push('const ' + d.name + ' = $event(function* (' + d.params.map(([p, ty]) => p + ': ' + TS_TYPE[ty]).join(', ') + ') {', ...ys(d.body, base, c.hosts, '  ', false), '});');
    }
    let events = 0;
    const setupEvents: string[] = [];
    const view = (v: V, cx: YCtx, rowEvents?: string[]): string => {
      switch (v.k) {
        case 'text': return v.s;
        case 'hole': return '{' + (v.ty === 'int' || v.e.k === 'cond' ? '"" + ' : '') + py(v.e, cx) + '}';
        case 'el': {
          let on = '';
          if (v.click) {
            const name = 'e' + events++;
            (rowEvents ?? setupEvents).push('const ' + name + ' = $event(function* () {', ...ys(v.click, cx, c.hosts, '  ', false), '});');
            on = ' onClick={yield* ' + name + '}';
          }
          return '<' + v.tag + on + '>' + v.kids.map(k => view(k, cx, rowEvents)).join('') + '</' + v.tag + '>';
        }
        case 'show': {
          const list = (vs: V[]) => vs.length === 1 && vs[0].k === 'el' ? view(vs[0], cx, rowEvents) : '<>' + vs.map(k => view(k, cx, rowEvents)).join('') + '</>';
          return '{yield* Show({ when: function* () { return ' + py(v.c, cx) + '; }' + (v.else.length ? ', fallback: function* () { return ' + list(v.else) + '; }' : '') + ', children: function* () { return ' + list(v.then) + '; } })}';
        }
        case 'for': {
          if (v.body.length !== 1 || v.body[0].k !== 'el') throw new NoYield('a row of more than one element');
          const each = v.each.k === 'src' ? v.each.name : 'function* () { return ' + py(v.each, cx) + '; }';
          const own: string[] = [];
          const row = view(v.body[0], { ...cx, rows: new Set([...cx.rows, v.item]) }, own);
          return '{yield* For({ each: ' + each + ', children: function* (' + v.item + ') { ' + own.join(' ') + ' return view(function* () { return ' + row + '; }); } })}';
        }
      }
      throw new Error('unknown view ' + (v as { k: string }).k);
    };
    const markup = view(c.view, base);
    const hostImport = c.hosts.length ? 'import { ' + c.hosts.map(h => h.name).join(', ') + ' } from "./api";\n' : '';
    const used = JSON.stringify(c);
    const imports = ['$event', '$memo', '$optimistic', '$signal', '$store', 'attempt', 'component', ...(used.includes('"k":"for"') ? ['For'] : []), ...(used.includes('"k":"show"') ? ['Show'] : []), 'view'];
    return 'import { ' + imports.join(', ') + ' } from "solid-yield";\n' + hostImport + '\nexport default component(function* App() {\n' +
      [...setup, ...setupEvents].map(l => '  ' + l).join('\n') + '\n  return view(function* () {\n    return (\n      ' + markup + '\n    );\n  });\n});\n';
  } catch (e) {
    if (e instanceof NoYield) { lastNoYield = e.message; return undefined; }
    throw e;
  }
}
