# ref/oracle — the real runtime as the oracle

Runs every `scenarios/*.md` through **solid-js 2.0.0-rc.16** (`@solidjs/signals`
+ `@solidjs/universal` with a string-tree renderer), by lowering the abstract
syntax onto the primitives each rule names — the compiler's back half, run as
an interpreter (`lower.ts`):

| form | lowering |
| --- | --- |
| `source x := e` | `createSignal`; structured (object/array) → `createStore` behind a signal slot (ST-1, ST-2a) |
| `source x = e` | `createSignal(fn)`; `createOptimistic(fn)` when an `optimistic x :=` exists; `createStore(fn, {})` when written or probed by path (ST-5) |
| `x = e`, `await e [-> v]` | `createMemo(fn, { loadingValue })`; the memo returns the flight (a promise/async iterable) |
| `deferred x = e` | `createDeferred` |
| `x = draft(pre x -> seed) { … }` | `createProjection((draft) => …, seed)` (ST-3) |
| `x key k = e` | `createProjection(fn, [], { key })` (ST-4) |
| `effect (…) { … }` | `createEffect(compute, { effect, error })` — the error arm is E-12 |
| `pre x` (own equation) | the memo's `prev` argument; `pre` of another node: unsupported |
| `peek`, `latest`, `pending?` | `untrack`, `latest(fn)`, `isPending(fn)` |
| `{if}` `{for}` `{loading}` `{errored}` | `Show`, `For`, `Loading`, `Errored` from `solid-js` |
| `action`, inline `action { }` | `action(function* …)` — a statement-level `await` is a `yield` of the flight |
| `optimistic`, `refresh`, `affects` | the setter of a `createOptimistic`, `refresh(x)`, `affects(x)` |
| `fetch(key)` | a controllable flight: an async iterable (`resolve` again = another landing, ST-6) that actions `yield` as a promise |

```
cd ref/oracle && npm install
node --experimental-strip-types --conditions=browser --conditions=development ref/oracle/run.ts [filter]
```

A row's frame is read after `flush()` and two macrotask settles. `(effect)`
rows are one flush here, compared at the end of the chain. A scenario's
`## Divergences` section (`- oracle "<table>" instant N: \`frame\` — why`)
records what the runtime shows where the spec rules otherwise; those rows
print `≠` and count as recorded divergences, not failures. The open
questions they raise are listed in `spec/05-holds.md §Divergences`.

Status: 53 pass, 2 skip (`pre` of another node is not lowered), 0 fail,
23 recorded divergences (DV-1 the mount ×21, DV-2 failed action ×1, DV-3
S-22 row 3′ ×1).
