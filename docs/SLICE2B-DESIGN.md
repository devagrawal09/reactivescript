# Tier B/C fuzz design: stores, per-row optimistic writes and keyed lists (Solid rc.21, 2105ffb8)

This is a read-only design; I edited no files. I read: `fuzz/solid.mjs`, `worker.mjs`, `run.mjs`, the generators (including the untracked `fuzz/generate-slice2a.mjs`, which someone is still working on), `docs/OP-LANGUAGE.md`, `docs/SLICE1*.md`, the Solid sources (`map.ts`, `store/{store,optimistic,projection,types,index}.ts`, `core/{lanes,seat,verdict,owner,action}.ts`, `signals.ts`), solid-js `client/flow.ts` (For/Show) and the frontend tracker fixtures and demo test.

## 0. Findings from the sources that shape the design

1. **For is `mapArray`, created lazily.** solid-js `flow.ts` For runs `mapArray(() => props.each, props.children, {keyed, fallback})`. It does this on the first read, under the owner captured when For was called. `mapArray` decides whether to create index signals from **`map.length > 1`**. So the oracle's mapper must be built with exact arity (1 or 2 parameters).
2. **mapArray has three keying modes and several code paths.**
   - `keyed: true` (identity, the default): the callback gets the raw item; there are no row signals.
   - `keyed: false`: the item is an accessor and the index is a number. This mode has `_rows`.
   - `keyed: fn`: both item and index are accessors.
   - Paths in `updateKeyedMap` (map.ts:403-702): empty plus fallback; create-all; prefix/suffix skip; the "no structural change" early return; `stageRemoval`; the general keyed-map path (duplicate chains); `commitWindow`/`writeRow`; and the abort path (#2903).
   - `trySmallMove`/`commitSmallMove` run only when the window is over 64 items and there are no row or index signals.
   - Row writes are plain `setSignal`; map.ts:535 says "CARVE 2: the lane-slot arm went with the engine".
3. **Show is three memos, and it reaches the parked-frame paths.** The memos are `conditionValue`, `condition` (equality `!a===!b`, `sync:true`) and an outer memo that builds the children untracked. Every re-run of a node that owns children or `_disposal` goes through `parkChildren` (core.ts:524). Under a hold, `holdFrame` runs (scheduler.ts:644, 1049); zombies are disposed at commit (owner.ts:95). None of today's ops creates children inside a computation, so none of this is reached.
4. **Optimistic stores have no store-side layer.** Every changed key gets an `optimisticWrite` guess on its leaf, presence and container node; the container guess is a `LaneView` (optimistic.ts:120-224). `createOptimisticStore(value)` goes through `createProjectionInternal`, and **its key defaults to `"id"` even in the plain form** (projection.ts:386). So rows with an `id` field get keyed arrangement guesses.
5. **The provenance, take and revert machinery needs specific triggers:**
   - `stale(el,q)` (lanes.ts:1028) fires only for stamped questions. Those come from guesses or from flights started by actions (an async memo, or a derived store's re-ask).
   - `take` fires from `laneStage` when another action's lane re-derives a guessed **computed** (lanes.ts:465). It also fires from `_slotTake`, when a store derive re-asks in another action's lane (optimistic.ts:356-373).
   - `kept`/`reverted` come back through `endLanes` (lanes.ts:906).
   - `_laneRebase`/`fold` need a **derived** optimistic store, a key, and an older or current truth landing beneath an arrangement guess.

   So per-row provenance requires async derives (flights). That depends on the slice 2a async-memo port.
6. **Store traps matter.** The proxy `has` trap subscribes to a presence node when there is an observer (store.ts:2264). So native `Array.prototype.filter`/`map` over a store array (`get length`, `get constructor`, then `has i`, `get i` per element) creates different subscriptions than an index loop. The brand key `$TARGET` is answered by the trap with no reactive read (store.ts:2104), so the logger can use it safely.
7. **`seat.ts` is `__TEST__`-only shadow code**, dead in the prod oracle. It is useful as the read-dispatch spec. Optionally, the TS copy could be run with `__TEST__=true` to collect `shadowReport()` mismatches as a tooling-only cross-check.
8. **`refresh()` creates its watcher on a `queueMicrotask`** (signals.ts:962). Today nothing drains microtasks except `resolve`/`reject`, so a `drain` op is needed.
9. **The tracker** (`frontend/tsx/fixtures/demo/tracker.tsx`) has this shape:
   - `createStore({list:[{id,title,assignee}]})` and `createOptimistic(() => issues.list)`.
   - `visible`/`unassigned` memos using native `.filter` over `shown()`.
   - Show + For (identity-keyed) with row text bindings.
   - An action: an optimistic updater (`list.map(...)` creating a fresh raw row), `yield assignIssue(id)`, then a store path write of the **yielded value**, and `try/catch` writing `status`.

   Every piece maps to an op below. Strings become ints (`""`→0, `"me"`→9, owners 6–8).

## 1. Value domain and log encoding

**Program values:** `V ::= int | [V…] | {field: V…}`. Field names come from a fixed alphabet: `id a t d n list tags`. Programs never contain null, strings or booleans. `undefined` (a deleted key or a missing index) appears in logs as `null`.

**Logging never descends into a store proxy.** Identity is shown with lazily numbered tokens. Rust must assign tokens in the same first-logged order, so any identity difference (a proxy vs a raw object, a re-wrapped row) becomes a trace difference.

```js
const ids = new WeakMap(); let tokN = 0; const fnLabels = new WeakMap();
const tok = o => { let t = ids.get(o); if (t === undefined) ids.set(o, t = ++tokN); return t; };
const enc = v => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw Error('non-finite value'); return v; } // fail closed
  if (typeof v === 'boolean') return v;
  if (typeof v === 'function') { const l = fnLabels.get(v); if (l === undefined) throw Error('unlabelled fn'); return {f: l}; }
  if (typeof v !== 'object') throw Error('unencodable ' + typeof v);
  if (v[S.$TARGET] !== undefined) return {p: tok(v)};          // store proxy: identity only
  if (Array.isArray(v)) return v.map(enc);                      // plain array: elements
  const o = {}; for (const k of Object.keys(v)) o[k] = enc(v[k]); return {r: tok(v), v: o}; // raw object
};
const out = v => (typeof v === 'number' || v === undefined) ? (v ?? null) : enc(v); // identical to legacy for ints
```

## 2. Expression additions

New cases go before `default:` in `evalExpr`. The legacy cases stay textually unchanged.

Context uses a dynamic `CX` with save and restore. Every callback the oracle hands to Solid installs its own static context on entry. Legacy expressions never read `CX`, so leakage into legacy memos pulled mid-evaluation is harmless.

| Expression | Meaning | Trap sequence on a proxy |
|---|---|---|
| `{op:'store',id}` | the store's root proxy | none |
| `{op:'get',of:E,key:K\|E}` | `x[k]`; a null/undefined `x` gives `undefined` (avoids V8 TypeError text in traces) | get k |
| `{op:'has',of:E,key:K}` | `k in x` → 1/0 | has k (presence node) |
| `{op:'len',of:E}` | `x.length` (null gives undefined) | get length |
| `{op:'eq',a,b}`, `{op:'not',a}` | `===` → 1/0; JS falsiness → 1/0 | none |
| `{op:'elem'}`, `{op:'pos'}` | innermost loop element / index | none |
| `{op:'filter'\|'count'\|'find', of, where, native?}` | new plain array / count / first index or -1 | explicit loop: get length, get 0…n-1. `native:true` calls `x.filter`/`x.findIndex` (spec sequence incl. `has`, `constructor`) |
| `{op:'replace',of,where,with,native?}` | `x.map(e => where ? with : e)` | as above |
| `{op:'obj',fields:{k:E}}`, `{op:'arr',items:[E]}`, `{op:'lit',value:V}` | fresh object/array; `lit` is a `structuredClone` on **every evaluation** | none |
| `{op:'plain',of:E,fields:[k…]}` | deep copy reading only the listed fields; arrays by loop | get length / get i / get field |
| `{op:'item',up?}`, `{op:'index',up?}` | row item/index; calls the accessor in accessor modes. `up` reaches enclosing rows | row signal read |
| `{op:'arg'}`, `{op:'sent'}`, `{op:'draft'}` | updater's prev / value of the last `yield` / root draft | none |
| `{op:'call',of:E}` | `typeof f==='function' ? f() : f` (an insert-like read of a Show/For accessor) | none |

```js
let CX = null; const within = (cx, f) => { const s = CX; CX = cx; try { return f(); } finally { CX = s; } };
const loop = (xs, f) => { const n = xs.length; for (let i = 0; i < n; i++) f(xs[i], i); };
const sub = (e, x, i, prev) => within({...CX, elem: x, pos: i}, () => evalExpr(e, prev));
const plain = (v, f) => v === null || typeof v !== 'object' ? v
  : Array.isArray(v) ? (r => (loop(v, x => r.push(plain(x, f))), r))([])
  : Object.fromEntries(f.map(k => [k, plain(v[k], f)]));
const row = up => { let c = CX.row; for (let d = up ?? 0; d > 0; d--) c = c.up; return c; };
// inside evalExpr's switch:
case 'store': return stores.get(e.id).proxy;
case 'get': { const x = evalExpr(e.of, prev), k = typeof e.key === 'object' ? evalExpr(e.key, prev) : e.key; return x == null ? undefined : x[k]; }
case 'has': { const x = evalExpr(e.of, prev); return x != null && e.key in x ? 1 : 0; }
case 'len': { const x = evalExpr(e.of, prev); return x == null ? undefined : x.length; }
case 'eq': return evalExpr(e.a, prev) === evalExpr(e.b, prev) ? 1 : 0;
case 'not': return evalExpr(e.a, prev) ? 0 : 1;
case 'elem': return CX.elem; case 'pos': return CX.pos;
case 'filter': { const x = evalExpr(e.of, prev); if (x == null) return undefined;
  if (e.native) return x.filter((y, i) => !!sub(e.where, y, i, prev));
  const r = []; loop(x, (y, i) => { if (sub(e.where, y, i, prev)) r.push(y); }); return r; }
case 'count': { const x = evalExpr(e.of, prev); if (x == null) return undefined;
  if (e.native) return x.filter((y, i) => !!sub(e.where, y, i, prev)).length;
  let c = 0; loop(x, (y, i) => { if (sub(e.where, y, i, prev)) c++; }); return c; }
case 'find': { const x = evalExpr(e.of, prev); if (x == null) return undefined;
  if (e.native) return x.findIndex((y, i) => !!sub(e.where, y, i, prev));
  const n = x.length; for (let i = 0; i < n; i++) if (sub(e.where, x[i], i, prev)) return i; return -1; }
case 'replace': { const x = evalExpr(e.of, prev); if (x == null) return undefined;
  const f = (y, i) => sub(e.where, y, i, prev) ? sub(e.with, y, i, prev) : y;
  if (e.native) return x.map(f); const r = []; loop(x, (y, i) => r.push(f(y, i))); return r; }
case 'obj': { const o = {}; for (const k of Object.keys(e.fields)) o[k] = evalExpr(e.fields[k], prev); return o; }
case 'arr': return e.items.map(x => evalExpr(x, prev));
case 'lit': return structuredClone(e.value);
case 'plain': return plain(evalExpr(e.of, prev), e.fields);
case 'item': { const it = row(e.up).item; return typeof it === 'function' ? it() : it; }
case 'index': { const ix = row(e.up).index; return typeof ix === 'function' ? ix() : ix; }
case 'arg': return CX.arg; case 'sent': return CX.sent; case 'draft': return CX.draft;
case 'call': { const f = evalExpr(e.of, prev); return typeof f === 'function' ? f() : f; }
```

## 3. Ops: JSON shapes, events and oracle code

### 3.1 New observation events

| Tag | Shape | Emitted when |
|---|---|---|
| `row` | `["row", L, serial, enc(item) \| null, index \| null]` | mapper call. Item is null in accessor modes, so the log adds no read; index is set only when the index is a number |
| `fallback` | `["fallback", L, serial]` | fallback accessor call |
| `cleanup` | `["cleanup", "L#3"]`, `["cleanup", "m@4"]`, `["cleanup", "B@2.x"]` | row/fallback owner disposal; memo-pass `_disposal`; child cleanup |
| `branch` | `["branch", B, pass, 0\|1]` | Show outer memo pass |
| `update` | `["update", id, enc(prev)]` | functional updater invoked (shows `guessedValueOf`) |
| `derive` + `flight` | `["derive", store, enc(key)]`, `["flight", name]` | derived store's derive fn runs |
| `caught` | `["caught", action, message]` | action's catch clause |
| `miss` | `["miss", store, enc(is)]` | a `{key,is}` path segment found no row (the edit is a no-op) |
| `read`/`latest`/`pending` | `["read", label, enc(v) \| {error}]` | expression form of the probes |

Child computations reuse `compute`, `effect`, `effect_cleanup` and `error` with ids such as `L#3.e0`, `L#3.L1#2.e0` (nested), `B@2.fb` and `m@4.c`.

### 3.2 Op shapes

```jsonc
{"op":"store","id":"st","value":V,"optimistic":false,"shallow":false,"key":"id"|null,"owner":"root"}
{"op":"store","id":"os","optimistic":true,"seed":V,"key":"id","seedLoading":false,
   "derive":{"expr":E,"flight":"list","fresh":true}}          // fresh: flight name prefix:key#n (nth request for key)
{"op":"store_set","id":"st","edits":[Edit…]}
{"op":"store_set","id":"st","returns":E}                       // setter returns a value (adoptPB / optimistic writes)
{"op":"store_set","id":"st","reconcile":V,"key":"id"|null}     // set(S.reconcile(V,key))
Edit ::= {"path":[P…],"set":E} | {"path":[P…],"del":true}
       | {"path":[P…],"push":E} | {"path":[P…],"insert":[i,E]} | {"path":[P…],"remove":i}
       | {"path":[P…],"removeKey":{"key":"id","is":k}} | {"path":[P…],"move":[i,j]}
       | {"path":[P…],"splice":[i,n,E…]}                        // native, opt-in
P ::= "field" | int | {"key":"id","is":int}                    // {key,is}: explicit findIndex loop over the draft
{"op":"memo", …legacy…, "optimistic":true}                     // S.createOptimistic(fn, opts); its setter is registered
{"op":"memo", …, "children":[Child…], "cleanup":"c"}           // children built (untracked) and onCleanup inside each pass → parkChildren
{"op":"update","id":"shown","expr":E}                          // setter(prev => E[arg=prev]); works on signal/optimistic/opt-memo
{"op":"list","id":"L","each":E,"keyed":true|false|"id"|{"expr":E},"index":bool,"fallback":bool,
   "lazy":false,"owner":"root","row":[Child…]}
Child ::= {"effect":"e0","expr":E,"render":bool,"defer":bool} | {"memo":"m0","expr":E}
        | {"list":{…list op without owner…}} | {"cleanup":"c"}
{"op":"show","id":"B","when":E,"yes":[Child…],"no":[Child…],"owner":"root"}   // a list child must be lazy:true (For)
{"op":"action","id":"a1","slices":[{"steps":[Step…],"flight":"assign:3#1"},{"steps":[…]}],"catch":{"steps":[…]}}
Step ::= {"write":id,"value":V} | {"update":id,"expr":E} | {"store":id,"edits"|"returns"|"reconcile":…}
       | {"refresh":id} | {"refresh_store":id} | {"read":E,"label":"x"}
{"op":"read"|"latest"|"pending","label":"x","expr":E}
{"op":"refresh","store":"os"}
{"op":"drain"}                                                  // await drain(); logs nothing (refresh watchers, continuations)
```

Notes on values: `write`, `signal` and `resolve` already pass JSON arrays and objects through unchanged, so those legacy lines need no change. Each op object is used once and stores are copy-on-write.

### 3.3 `solid.mjs` additions (sketch)

Each new branch is reached only by a new op name or a new field.

```js
const stores = new Map();
const findKey = (t, s) => { const n = t.length; for (let i = 0; i < n; i++) { const r = t[i]; if (r != null && r[s.key] === s.is) return i; } return -1; };
const val = (e, d) => within({...CX, draft: d}, () => evalExpr(e));
const shiftRemove = (a, i) => { const n = a.length; for (let k = i; k < n - 1; k++) a[k] = a[k + 1]; a.length = n - 1; };
const shiftInsert = (a, i, x) => { for (let k = a.length; k > i; k--) a[k] = a[k - 1]; a[i] = x; };
const edit = (sid, d, ed) => {
  const p = ed.path, isArrOp = !('set' in ed || ed.del); let t = d;
  const seg = s => { if (typeof s !== 'object') return s; const i = findKey(t, s); if (i < 0) { log.push(['miss', sid, s.is]); throw MISS; } return i; };
  try {
    for (let i = 0; i < p.length - (isArrOp ? 0 : 1); i++) t = t[seg(p[i])];
    if (!isArrOp) { const k = seg(p[p.length - 1]); if (ed.del) delete t[k]; else t[k] = val(ed.set, d); return; }
    if ('push' in ed) t[t.length] = val(ed.push, d);
    else if ('insert' in ed) shiftInsert(t, ed.insert[0], val(ed.insert[1], d));
    else if ('remove' in ed) shiftRemove(t, ed.remove);
    else if ('removeKey' in ed) { const i = findKey(t, ed.removeKey); if (i < 0) log.push(['miss', sid, ed.removeKey.is]); else shiftRemove(t, i); }
    else if ('move' in ed) { const [i, j] = ed.move, x = t[i]; shiftRemove(t, i); shiftInsert(t, j, x); }
    else if ('splice' in ed) { const [i, n, ...xs] = ed.splice; t.splice(i, n, ...xs.map(e => val(e, d))); }
  } catch (e) { if (e !== MISS) throw e; }
};
const MISS = {};
const runSet = (sid, s) => { const st = stores.get(sid);
  if ('reconcile' in s) return st.set(S.reconcile(structuredClone(s.reconcile), s.key === undefined ? 'id' : s.key));
  st.set(d => { if ('returns' in s) return val(s.returns, d); for (const ed of s.edits) edit(sid, d, ed); }); };
const upd = (id, e) => setters.get(id)(prev => { log.push(['update', id, out(prev)]); return within({...CX, arg: prev}, () => evalExpr(e)); });

case 'store': { let pair; const v = structuredClone(o.value ?? o.seed);
  const make = o.optimistic ? S.createOptimisticStore : S.createStore;
  if (o.derive) { const d = o.derive, cnt = new Map();
    const fn = draft => within(null, () => { const k = evalExpr(d.expr); let name = d.flight + ':' + k;
      if (d.fresh) { const c = (cnt.get(k) ?? 0) + 1; cnt.set(k, c); name += '#' + c; }
      log.push(['derive', o.id, out(k)]); log.push(['flight', name]); return flight(name).promise; });
    const opts = {key: o.key === undefined ? 'id' : o.key}; if (o.seedLoading) opts.seedLoadingValue = true;
    pair = owned(o.owner, () => make(fn, v, opts));
  } else pair = owned(o.owner, () => make(v, {...(o.shallow ? {shallow: true} : {}), ...(o.optimistic && 'key' in o ? {key: o.key} : {})}));
  stores.set(o.id, {proxy: pair[0], set: pair[1]}); break; }
case 'store_set': runSet(o.id, o); break;
case 'update': upd(o.id, o.expr); break;
case 'drain': await drain(); break;
case 'list': nodes.set(o.id, makeList(o, null, o.owner ?? 'root')); break;
case 'show': { let pass = 0;
  const outer = owned(o.owner, () => {
    const cv = S.createMemo(() => within(null, () => evalExpr(o.when)));
    const cond = S.createMemo(cv, {equals: (a, b) => !a === !b, sync: true});
    return S.createMemo(() => { const c = cond(), p = ++pass, pre = o.id + '@' + p; log.push(['branch', o.id, p, c ? 1 : 0]);
      return S.untrack(() => { let ret = p; for (const r of (c ? o.yes : o.no) ?? []) { const x = child(r, pre, {row: null}); if (r.list) ret = x; } return ret; }); });
  });
  nodes.set(o.id, outer); break; }

const makeList = (o, rowCx, ownerId) => { const id = o.id; let n = 0;
  const keyed = o.keyed === false ? false : typeof o.keyed === 'string' ? (k => x => x[k])(o.keyed)
    : typeof o.keyed === 'object' ? (x => within({row: rowCx, elem: x}, () => evalExpr(o.keyed.expr))) : true;
  const body = (item, index) => { const s = ++n, rid = id + '#' + s;
    log.push(['row', id, s, typeof item === 'function' ? null : out(item), typeof index === 'number' ? index : null]);
    S.onCleanup(() => log.push(['cleanup', rid]));
    const cx = {row: {item, index, up: rowCx}}; for (const r of o.row ?? []) child(r, rid, cx); return s; };
  const map = o.index ? (item, index) => body(item, index) : item => body(item);   // arity drives _indexes
  const opts = {keyed};
  if (o.fallback) opts.fallback = () => { const s = ++n; log.push(['fallback', id, s]); S.onCleanup(() => log.push(['cleanup', id + '#' + s])); return -s; };
  const make = () => S.mapArray(() => within({row: rowCx}, () => evalExpr(o.each)), map, opts);
  if (!o.lazy) return ownerId ? owned(ownerId, make) : make();
  const owner = S.getOwner(); let mapped;                       // For: owner captured at the "component call"
  const list = () => (mapped ??= S.runWithOwner(owner, make))(); fnLabels.set(list, id); return list; };

const child = (r, pre, cx) => {
  if (r.effect) { const id = pre + '.' + r.effect;
    const compute = prev => within(cx, () => { log.push(['compute', id, out(prev)]); return evalExpr(r.expr, prev); });
    const effect = (v, p) => { log.push(['effect', id, out(v), out(p)]); return () => { log.push(['effect_cleanup', id, out(v)]); }; };
    if (r.render) S.createRenderEffect(compute, effect, {defer: r.defer});
    else S.createEffect(compute, {effect, error: e => { log.push(['error', id, e.message]); }}, {defer: r.defer}); return; }
  if (r.memo) { const id = pre + '.' + r.memo; const g = S.createMemo(prev => within(cx, () => { log.push(['compute', id, out(prev)]); return evalExpr(r.expr, prev); })); nodes.set(id, g); return g; }
  if (r.list) return makeList({...r.list, id: pre + '.' + r.list.id}, cx.row, null);
  if (r.cleanup) S.onCleanup(() => log.push(['cleanup', pre + '.' + r.cleanup]));
};
```

Changes to existing cases. Each is a prefix branch; the legacy lines stay as they are:

```js
// memo: if (o.optimistic) { const [g, set] = owned(o.owner, () => S.createOptimistic(fnWith(o), opts)); nodes.set(o.id, g); setters.set(o.id, set); break; }
//   fnWith adds, after the 'compute' log: if (o.children || o.cleanup) { const pre = o.id + '@' + (++passes[o.id]);
//     S.untrack(() => (o.children ?? []).forEach(r => child(r, pre, {row: null}))); if (o.cleanup) S.onCleanup(() => log.push(['cleanup', pre])); }
// memo/effect logging: prev/v/p go through out() (identity on ints and undefined; checked by the byte gate below)
// read/latest/pending: if ('expr' in o) { const f = () => evalExpr(o.expr);
//   log.push([o.op, o.label, observed(() => out(o.op === 'read' ? f() : o.op === 'latest' ? S.latest(f) : S.isPending(f)))]); break; }
// refresh: if ('store' in o) { S.refresh(stores.get(o.store).proxy).catch(() => {}); break; }
// action: if ('catch' in o || o.slices.some(s => 'steps' in s)) { extendedAction(o); break; }  // else: legacy line verbatim
const extendedAction = o => S.action(function* () { let sent;
  const run = s => within({sent}, () => { for (const w of s.writes ?? []) setters.get(w.id)(w.value); for (const st of s.steps ?? []) step(st); });
  try { for (const s of o.slices) { run(s); if (s.flight) sent = yield flight(s.flight).promise; } }
  catch (e) { if (!o.catch) throw e; log.push(['caught', o.id, e.message]); run(o.catch); }
})().then(() => { log.push(['action', o.id, null]); }, e => { log.push(['action', o.id, e.message]); });
const step = st => 'write' in st ? setters.get(st.write)(st.value) : 'update' in st ? upd(st.update, st.expr)
  : 'store' in st ? runSet(st.store, st) : 'refresh' in st ? void S.refresh(nodes.get(st.refresh)).catch(() => {})
  : 'refresh_store' in st ? void S.refresh(stores.get(st.refresh_store).proxy).catch(() => {})
  : 'read' in st ? void log.push(['read', st.label, observed(() => out(evalExpr(st.read)))]) : (() => { throw Error('bad step'); })();
```

### 3.4 `run.mjs` and `worker.mjs` (additive only)

- **`worker.mjs`:** no change.
- **`run.mjs`:**
  - New flag `--gen tierB|tierC|tracker` loads `fuzz/generate-tier-{b,c}.mjs` (exports `generate(seed)` and `family(seed)`). The binary stays `slice1-driver`, with an optional `--binary`.
  - Buckets use `mode = family(seed)`.
  - The reducer's class-preserving rule applies to `--gen` modes as well as `--slice1`.
- **`valid()`:** add a second check that runs only when the program contains new ops. It tracks store and list ids, rejects `store`/`store_set`/`refresh.store`/step references to unknown ids, and walks every expression key (`of where with fields items key a b test yes no expr each when`). It also checks `{op:'store'}`/`{op:'read'}` ids and that `item`/`index` appear only inside `row`, and `arg`/`sent`/`draft` only in their contexts. Legacy programs never reach it.
- **Family selection:** deterministic weighted choice without the RNG: `W = families.flatMap(([f, w]) => Array(w).fill(f)); family = W[seed % W.length]`.

### 3.5 Gates

These apply to any change to `solid.mjs`:

1. `node fuzz/run.mjs --slice1 --seeds 1000` must stay 1000/1000.
2. **Byte gate:** use an `eq.mjs`-style dumper over `generateSlice1` 1–1000, `generate` 1–2000 and `generateSlice2a` (if present). Diff the traces from the old and new `solid.mjs` with `cmp`; they must be byte-equal. This is stronger than "still agrees", because `out()` and the prefix branches touch legacy cases.

## 4. Generator families

Shared constraints:
- Mulberry32, as in the existing generators.
- No `lazy` memos, which keeps the known teardown hang and `deleteFromHeap` reference bugs out.
- Lists have at most 8 rows except in `list-bulk`.
- `add` never sees an `undefined` operand: the generator reads only keys its model guarantees, and `enc` fails closed on NaN.

### Tier B (`generate-tier-b.mjs`)

| Family (weight) | Program skeleton | Solid paths it should reach |
|---|---|---|
| `store-plain` (3) | `store st {list:[2–5 rows {id,a,t}], n}`; memos `get n`, `len list`, `count a==0`, `get(list[k]).a`; 2 render + 1 user effect with `plain(row,[id,a])`; 12–18 steps: `store_set` (leaf 40%, nested row field, push 10%, remove/insert/move 18%, del 5%, replace row by `lit` 8%, `returns` filter 7%, `reconcile` key id/null 5%), several sets per turn (30%), flush, expression reads, `has` (5%) | store.ts `storeSetter`, `notifyWrites`, `getNode`/`bornStaged`/`noteNode`, `getContainerNode`, `getHasNode`, `readSource`, `serveDataKey`, `nodeValue`, `ensurePB`, `privatizeCommitted`, `preBatch`/`queueFold`/`drainFolds`/`foldTarget`, `adoptPB`, `reportReplacedContainers`, `membershipChanged`, `notifyKeyDiff`/`notifyKeyValue`/`leafSet`, `releaseSlot`; reconcile.ts `reconcileState`/`applyAdopt`; core `setSignal`/`commitPendingNode` on slot nodes |
| `store-actions` (3) | `store-plain` plus signal `s` and optimistic `o`; 2–3 overlapping actions whose steps mix store edits and writes in slice 1 and slice 2; `read`/`latest`/`pending` on store expressions; random resolve/reject | `storePark`, `heldKeyChanged`, `stagingReader`, `stageOn`, `deriveHolds`, `holdNode`/`frameRead`/`staleReader` for slot nodes, verdict.ts `heldLatest`/`verdictValue`/`latestView` on slots, `land` of store staging |
| `opt-memo-rows` (4) | store rows; `shown = memo optimistic: get(st,list)`. With p=.3 it is a `replace` that also reads optimistic `o2`, which other actions guess. Signal `mode`; `visible` = filter(shown); `cnt`; effects with `plain(visible,[id,a])`. 2–4 claims: slice 1 `update shown replace(id==K → obj{id:K,t:elem.t,a:9})`, flight `claim:K#c`; slice 2 store set `[list,{key:id,is:K},a] = sent`, `write status 0`; catch `write status K`. Same-row double claims (merge); `mode` writes mid-action; resolve/reject in random order | lanes.ts `optimisticWrite` on a computed, `applyGuesses` (OVERRIDE re-ask and `holder`→`merge`), `laneStage`→**`take`**, `laneOutcome`/`supersede`/`answered`/`stale`, `dissolveLane`, `laneCorrections` (`reverting`→`reverted`), **`endLanes` kept-return**, `linkLanes`/`linkBlocked` (one reader over two lanes: Rust currently panics there), `guessFlights` |
| `opt-store-rows` (4) | `createOptimisticStore({list:rows})` (key `id`, or `null` 25%); per-row claims: slice 1 edit row K `a=9`, or push a new row, or `removeKey` K, flight `claim:K#c`; slice 2 writes truth into a separate plain store, or nothing; catch status; `latest`/`pending` on row fields | optimistic.ts `notifyOptimisticWrites` (leaf/presence/length/`LaneView` container), `optimisticDraft`/`writerBacking`/`cloneRaw`, `optimisticView`/`optimisticHas`/`optimisticOwnDescriptor`, `markOverlaid`/`sweepOverlaid`, `containerEquals`→`arrangement`/`arrangementEqual`/`rowSame`; independent lanes per row node; revert at the body's end |
| `opt-store-derived` (3, needs 2a) | `createOptimisticStore(derive page→flight list:page#n, [], {key:'id'})`; initial resolve with JSON rows; toggles: slice 1 guess `d=1-d`, `yield save:K#c`, slice 2 `refresh_store`; then `drain`; the generator's server model answers `list:page#n` with echo, correction, reorder, added or dropped rows; `page` writes (new question) | projection.ts `createProjectionInternal`/`runProjectionComputed`/`wrapDraft`/`familyStatus`/`wakeFamily`/`settleFamily`/`errorFamily`; store `pullFamily`, `adoptChild`; optimistic **`_laneRebase`** (incl. the `view.g = null` #4525 branch), **`fold`/`foldedRead`**, `pairRows`, `_echoes`/`echoes`, **`_slotTake`→`take(m,d,true)`**, `laneSet`, `sameAction`; signals `refresh`/`watch` (FRESH_READ\|AUTHORITATIVE), truth.ts |
| `store-provenance` (3, needs 2a) | 2–3 actions on the **same** row of a derived optimistic store; each refreshes; refetches resolve in reverse order, so an older question's answer lands under a newer guess; mainline writes in between | `laneWrite` GUESS branch with `older=true` (held beneath), `stale`, `_laneRebase(older)`, `kept`/`reverted` across actions, `merge` |

### Tier C (`generate-tier-c.mjs`)

| Family (weight) | Program skeleton | Solid paths it should reach |
|---|---|---|
| `list-ints` (3) | signal `xs` holding an int array with values 0–5 (duplicates); `list L each read xs`, `keyed` true/false/`{expr: mod 3}`, `index` 50%, `fallback` 50%; row specs: render effect on `item`, effect on `index`, row memo; top effect `read L`; writes produced by edit ops (insert/remove/move/swap/reverse/dup/clear/same content); 30% two writes per turn; 5% row effect with `fail` (abort path) | map.ts `updateKeyedMap` (empty+fallback, create-all, prefix/suffix plus `compare`, early return, `stageRemoval` success and failure, keyed map with `newIndicesNext` duplicate chains, created/removed, abort #2903), `commitWindow` grow/shrink, `writeRow`, index `setSignal`, `_owner.dispose(false)`, removal-after-create order; owner.ts `disposeChildren`/`runDisposal` |
| `list-store` (4) | L over `get(st,list)`, keyed true/`"id"`/false; rows: `get(item,a)` / `plain(item,[id,a])` / index; edits: field writes (row effects only), push/insert/remove/move, replace row by `lit` (new proxy: identity-keyed recreates, `id`-keyed `writeRow`s), `returns` filter, `reconcile` id vs null; 10% `shallow:true` | `$TRACK` container read, `shallowView`, proxy index gets, all mapArray paths with proxy identity |
| `list-lanes` (4) | L over an optimistic source: (a) `shown` optimistic memo plus updater steps (insert row `lit`, filter-remove, reorder `replace`); (b) an optimistic store list. 1–3 overlapping actions; render and user row effects; 5% `dispose` of the list's owner mid-action | mapArray computed in lane passes (`enterLane`, `laneStage`), rows created in a lane pass (`bornInto`, `creatorPass`, `creatorReads`), row effects on lane queues (`enqueue`), disposal inside lane passes, revert and re-create, `dissolveLane` over disposed nodes, `unobserved` |
| `list-show` (3) | `show B when len(read xs or visible)` with `yes:[lazy list]` / `no:[effect fb]`; memos with `children`/`cleanup`; actions that flip the condition under a hold; top `effect call(read B)` | core `parkChildren`, owner `markDisposal`/zombie `disposeChildren`, scheduler `holdFrame` (1049), CONFIG_STAGED die-on-spot (515), lanes.ts:676/897 pending-frame dissolve, heap zombie deferral |
| `list-nested` (2) | rows `{id,a,tags:[ints]}`; row child `list` over `get(item,tags)`; nested edits | nested map computed created in the mapper, disposal cascades, the `up` item chain |
| `list-bulk` (1) | ints, length 66–100, no row specs; rotate, swap, small displacement, removals, plus full replace and a duplicate inside a run | `trySmallMove`/`commitSmallMove` (incl. the duplicate decline), the replace probe miss |
| `tracker` (4) | the demo shape below, with a randomized script | everything above, combined |

**Tracker skeleton.** `NATIVE = n(2) === 0` selects native filter/map, the faithful variant.

```js
put('store',{id:'issues',value:{list:rows /* R=3..5, {id:i,t:i,a:n(3)?0:5} */}});
const L={op:'get',of:{op:'store',id:'issues'},key:'list'}, rd=id=>({op:'read',id});
const open={op:'eq',a:{op:'get',of:{op:'elem'},key:'a'},b:0};
put('memo',{id:'shown',optimistic:true,expr:L});
put('signal',{id:'mode',value:0}); put('signal',{id:'status',value:0});
put('memo',{id:'visible',expr:{op:'filter',native:NATIVE,of:rd('shown'),where:{op:'choose',test:{op:'eq',a:rd('mode'),b:0},yes:1,no:open}}});
put('memo',{id:'unassigned',expr:{op:'count',native:NATIVE,of:rd('shown'),where:open}});
put('effect',{id:'head',render:true,expr:{op:'arr',items:[rd('mode'),rd('unassigned')]}});
put('show',{id:'B',when:{op:'len',of:rd('visible')},
  yes:[{list:{id:'L',lazy:true,each:rd('visible'),keyed:true,index:false,
        row:[{effect:'p',render:true,expr:{op:'arr',items:[{op:'get',of:{op:'item'},key:'t'},{op:'get',of:{op:'item'},key:'a'}]}}]}}],
  no:[{effect:'fb',render:true,expr:0}]});
put('effect',{id:'body',render:true,expr:{op:'call',of:rd('B')}});
put('effect',{id:'foot',render:true,expr:rd('status')}); put('flush');
// loop: claim(K) 40% | mode toggle + flush 10% | resolve/reject an open claim 30% | read rows/latest/pending 10% | flush/drain 10%
const claim=(K,f)=>({id:'claim'+c,slices:[
  {steps:[{update:'shown',expr:{op:'replace',native:NATIVE,of:{op:'arg'},where:{op:'eq',a:{op:'get',of:{op:'elem'},key:'id'},b:K},
     with:{op:'obj',fields:{id:K,t:{op:'get',of:{op:'elem'},key:'t'},a:9}}}}],flight:f},
  {steps:[{store:'issues',edits:[{path:['list',{key:'id',is:K},'a'],set:{op:'sent'}}]},{write:'status',value:0}]}],
  catch:{steps:[{write:'status',value:K}]}});
```

**Fixed anchor program `tracker-demo`.** This is the demo `SCRIPT`, one op group per step:
1. Claim 1, `drain`.
2. Resolve `assign:1#1` with 7.
3. Claim 2, `drain`.
4. Reject `assign:2#1` with `offline`.
5. `write mode 1`, `drain`.
6. Claim 3, `drain`.
7. Resolve `assign:3#1` with 7.

Its render-effect logs should correspond to the 8 EXPECTED frames. That check is a structural sanity test of the op encoding, not a parity score.

## 5. Coverage-first staging and Rust implications

**Order:**
1. `store-plain`
2. `list-ints`
3. `list-store`
4. `store-actions`
5. `list-show` (needs owner-in-computation)
6. `opt-memo-rows`
7. `tracker`
8. `opt-store-rows`
9. `list-lanes`
10. After the slice 2a async/flight port: `opt-store-derived`, `store-provenance`

Each stage repeats the slice 1 method: copy the TS sources to `out/solid-src`, run `fixctor`, confirm the trace-equality check (`eq.mjs`-style) on the family, then run V8 coverage, `fnmap` and `annotate`, and port in order of what is reached. Panics such as `take`, `linkLanes` and the dormant reawaken are expected to fire first in `opt-memo-rows` and `list-lanes`. That is the intended fail-closed signal.

**Rust needs:**
- A value enum: `Undef | Int | Arr(Rc) | Obj(Rc) | Proxy(TargetId) | Fn(label)`.
- Identity tokens assigned at log time, in the same lazy first-seen order.
- An explicit model of the trap sequences used here: the index-loop sequence, plus the ECMA-262 `filter`/`map`/`findIndex`/`splice` sequences for `native:true`, including `has`/presence nodes and `get constructor`.

## 6. Risks

1. **Trap-sequence fidelity.** Native array methods and `Object.keys` go through spec-defined trap sequences (`has` → presence subscriptions; `ownKeys` + `getOwnPropertyDescriptor`). The defaults are explicit loops. `native:true` is opt-in, with weight raised only after the loop variants agree. There is no `keys` expression in this tier.
2. **Microtask depth.** `drain` is 32 awaits then `flush`. Derive → projection → reconcile chains, and refresh watchers created on a microtask, might need more hops. Add a tooling-only probe that runs each tier program with drain 32 vs 64 and flags trace differences. That flags programs as depth-sensitive; the oracle stays unchanged.
3. **Hangs and reference bugs.** The lane, store and list combinations are new territory for the oracle. New livelocks or TypeErrors would show up as `oracle-timeout`/`oracle-error`. They are bucketed, never counted as agreement, and get no seed-specific handling. Keep the 1500 ms default; with ≤8-row lists, traces should stay small.
4. **Generator correctness traps.** `{key,is}` misses are logged (`miss`) rather than writing key `-1`. NaN fails closed in `enc`. Reading row nodes from top-level ops is forbidden by `valid()`, since a TypeError message is V8-specific text. Path segments addressing removed rows during optimistic actions are expected and deterministic.
5. **Arity and option exactness.**
   - The mapper's `.length`, `keyed: true` vs omitted (identical in map.ts) and Show's `sync:true` must be reproduced exactly.
   - Plain optimistic stores default to key `"id"`; pass `key:null` explicitly for the positional variant.
6. **rc.21 oddities to expect, not fix.** map.ts:535 (CARVE 2) means that under lane passes `keyed:false`/fn rows are written with plain `setSignal`. Solid's own comment says this used to show the pre-action list for the whole action, and the fix was removed with the engine. Whatever the oracle shows is the target. The same applies to plain optimistic stores and signals reverting on success.
7. **Identity tokens couple traces.** One early identity divergence shifts every later token, so a reduced case can look larger than its cause. The class-preserving reducer still applies, but bucket on the first differing event's tag only.
8. **Byte-identity obligations.** `out()` on memo/effect logging and the prefix branches touch legacy cases. This is justified (structured values must be loggable), but it must pass the byte gate in 3.5 on the slice 1, M1 and 2a generators before any tier result counts. `--slice1` and `generate-slice1.mjs` must not change.
9. **Dependency on slice 2a.** `generate-slice2a.mjs` is untracked work in progress. `opt-store-derived` and `store-provenance` need flights on derived nodes (`handleAsync`, STATUS_PENDING), so schedule them after 2a.
10. **Seat shadow.** `seat.ts` never runs in the prod oracle, so do not treat its coverage numbers as reached. Running the TS copy with `__TEST__=true` and reading `shadowReport()` is an optional tooling cross-check. It must never feed the oracle, because `__TEST__` also changes `ingestedRaw` and other branches.

Relevant paths:
- `/workspace/rx-tsx-refresh/rust-parity/fuzz/solid.mjs`
- `/workspace/rx-tsx-refresh/rust-parity/fuzz/run.mjs`
- `/workspace/rx-tsx-refresh/rust-parity/fuzz/generate-slice2a.mjs`
- `/workspace/rx-tsx-refresh/solid-next/packages/signals/src/map.ts`
- `/workspace/rx-tsx-refresh/solid-next/packages/signals/src/store/optimistic.ts`
- `/workspace/rx-tsx-refresh/solid-next/packages/signals/src/store/store.ts`
- `/workspace/rx-tsx-refresh/solid-next/packages/signals/src/store/projection.ts`
- `/workspace/rx-tsx-refresh/solid-next/packages/signals/src/core/lanes.ts`
- `/workspace/rx-tsx-refresh/frontend/node_modules/solid-js/src/client/flow.ts`
- `/workspace/rx-tsx-refresh/frontend/tsx/fixtures/demo/tracker.tsx`
- `/workspace/rx-tsx-refresh/frontend/tsx/demo.test.ts`