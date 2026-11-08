# Differential program format

A program is a JSON array of operations. The Rust driver reads one array per stdin line and writes one observation array per stdout line. IDs are strings. Values in this spike are signed integers kept small enough for exact JS arithmetic.

## Operations

- signal: id, value, optional equals (default/parity/never), optimistic boolean.
- memo: id, expr, optional owner (root by default), lazy, equals, flight prefix, loading integer.
- effect: id, expr, optional owner, render, defer. Both compute and apply are logged; apply returns a logged cleanup. User effects install a logged error callback.
- write: id, value. Several writes without flush are one imperative turn.
- read: id, optional label. latest and pending: id.
- flush: explicit reactive flush, not an arbitrary wait.
- owner: id, optional parent. cleanup: owner, label. dispose: owner.
- refresh: id (memo). The JS promise is handled so reference errors do not become Node unhandled rejections.
- action: id, slices. Each slice has writes (id/value pairs); every nonfinal slice must have a flight to yield. The final slice has no flight. Rejection escapes the generated action; Rust's public action closure can implement catching separately.
- resolve: flight, value. reject: flight, message. These settle once, then drain controlled microtasks. Repeated settlement has no effect but the turn still drains.

A memo with a flight prefix evaluates its expression to an integer key and returns the promise named prefix:key. Two requests for the same key reuse the same promise. Refreshing such a memo deliberately exercises already-resolved promise handling. Flight names supplied to actions are used literally.

## Expressions

An expression is an integer literal or an object with op:

- read: id
- add: a, b (expressions)
- mod: a (expression), b (nonzero integer)
- choose: test, yes, no (expressions, nonzero means true)
- untrack: expr
- fail: message
- prev: fallback (integer)

Expressions do not create nodes or perform writes. There are no stores, JS objects, arbitrary code strings, streams, or native widgets in this language.

## Observations

Logs are arrays tagged compute, flight, effect, effect_cleanup, error, cleanup, action, read, latest, or pending. Missing previous values and successful action errors are represented by null. Read errors are objects with an error field: pending for NotReadyError, otherwise the error message. Initial loading is observed through pending reads/errors and optional loading values; there is no invented JS isLoading API.

A program's root is disposed after the last op, and teardown logs are included. Every program runs in a fresh JS worker, which is terminated after the trace is returned. No orphan-flight drain is added after teardown. The Rust driver creates a new Runtime per program. This keeps earlier programs and reducer attempts out of the reference state.

## Generation and reduction

Mulberry32 uses a numeric seed. Six families exercise eager graphs, lazy graphs, async memo requests, same-tick actions, later overlapping actions, and error recovery. Random graph bodies cover branching, untrack, equality cuts, multiple writes, refreshes, and observations. Async programs also vary loading seeds, refresh, and rejection. This is structured fuzzing, not unrestricted arbitrary-program generation.

The runner enforces separate JS and Rust time limits (default 1500 ms). A timeout is recorded as a failure, never agreement. JS workers are fresh for every original or reduced program. The runner counts op kinds only in original seed programs, not reducer attempts. It writes one full failure per seed. Failures are bucketed by family and the first different log tag pair. These are mechanical buckets, not claims of independent root causes. The reducer removes chunks and individual ops, preserving basic reference validity and any exact-log mismatch, with a bounded search budget. It can reduce to a different mismatch class; inspect the saved reduced logs. It does not claim globally minimal programs.

Commands: node fuzz/run.mjs --seeds N [--start S] [--out DIR] [--no-reduce]; node fuzz/run.mjs --replay PATH. SOLID_SIGNALS_URL can override the reference module URL.

Mode flags select the generator and driver:

- `--slice1`: `generate-slice1.mjs` on `slice1-driver`.
- `--slice2a`: `generate-slice2a.mjs` on `slice1-driver`. It adds async memos over flights, same-key promise reuse, loading values, refresh, latest/pending probes, rejected memo flights, and actions that feed or await memo flights. See [SLICE2A-COVERAGE.md](SLICE2A-COVERAGE.md).

`--slice2a` runs the worker in strict mode. A program is invalid in two cases:

- `oracle-halted`: Solid halted reactivity on an uncaught effect error.
- `oracle-nonscalar`: an observed value is not one this language allows (an integer, null for a missing previous value, a boolean for pending, or `{error}`).

Without the mode, `undefined` and Error objects reach the comparator as `null`/`{}`.

### Tier B (`--slice2b`): stores and per-row optimistic writes

`--slice2b` runs `generate-slice2b.mjs` on `slice1-driver` with the worker in strict mode `'slice2b'`. The ops, expressions, value domain and log encoding are those of [SLICE2B-DESIGN.md](SLICE2B-DESIGN.md) sections 1–3, minus tier C (lists, Show, memo children); the implemented subset and its deviations are listed in [SLICE2B-COVERAGE.md](SLICE2B-COVERAGE.md) section 1.

- New ops: `store` (plain, optimistic, derived optimistic), `store_set` (path edits, `returns`, `reconcile`), `update`, `drain`, `refresh {store}`, expression forms of `read`/`latest`/`pending` (`{op, label, expr}`), `memo` with `optimistic: true`, and actions with `steps` and `catch`.
- New events: `update`, `derive`, `caught`, `miss`.
- Values: an integer, `null` (also `undefined`), a plain array of values, a store proxy `{p: token}` or a raw object `{r: token, v: {field: value}}`. Tokens number object identities in first-logged order. Legacy log sites encode only arrays, plain objects and proxies, so every legacy trace is byte-identical.
- `slice1-driver` implements every tier-B op and expression with the same reads in the same order (a native array method's ECMA-262 `Get`/`HasProperty`/`ArraySpeciesCreate` sequence goes through the store traps) and the same encoding; see [SLICE1.md](SLICE1.md) "Evaluator and host boundary".
- The strict `'slice2b'` worker marks a program `oracle-nonscalar` when any logged value is outside that domain (an Error or string as a value, a non-integer number, or the oracle's `{nonscalar}` marker), and `oracle-halted` on a reactivity halt, as in `--slice2a`.

### Tier C (`--slice2c`): lists, Show and children in computations

`--slice2c` runs `generate-slice2c.mjs` on `slice1-driver` with the worker in strict mode `'slice2c'`. The design is tier C of [SLICE2B-DESIGN.md](SLICE2B-DESIGN.md); the implemented ops, their exact Solid calls and the deviations are in [SLICE2C-COVERAGE.md](SLICE2C-COVERAGE.md) section 1. Every tier-B op and expression is still available.

- New ops:
  - `list` {id, each, keyed, index, fallback, lazy, owner, row}: `mapArray(() => each, mapper, {keyed, fallback})`. `keyed` is `true` (identity), `false` (index rows), a field name (key function `x => x[name]`) or `{expr}` (a key function evaluating `expr` with `elem` = the item). `index: true` gives the mapper arity 2 (Solid decides index signals from `map.length > 1`). `fallback` is `false`, `true` or a children list. `lazy: true` is For: the mapArray is created on the first read, under the owner current when the op ran. The list's value is the mapped array of row serials (a fallback maps to `-serial`).
  - `show` {id, when, yes, no, fn, keyed, owner}: the three memos of solid-js `Show`. The value is the pass number, or the accessor of the last `list` child of the branch.
  - `memo`/`effect` with `children` (and/or `cleanup`): each pass builds the children untracked and registers a logged cleanup, so re-runs park or dispose the previous frame.
  - Children (`row`, `yes`, `no`, `fallback`, `children`): `{effect, expr, render, defer}`, `{memo, expr}`, `{list: {...}}`, `{show: {...}}`, `{cleanup}`, `{read: expr, label}` (a read in the pass body itself; a throw aborts the pass).
- New expressions: `item`/`index` (`up` reaches enclosing rows; an accessor is called), `call` (calls a function value), `local` (a memo/list/Show built earlier in the same row or child pass), `concat` (items flattened by index loops), `reverse`.
- New store edit: `moveKey: {key, is, to: 0 | -1}` (find by key, then move to the front or the back; a miss logs `miss`).
- New events: `row` [list, serial, item or null, index or null], `fallback` [list, serial], `branch` [show, pass, 0/1]; `cleanup` labels for rows (`L#3`), child cleanups (`L#3.c`, `B@2.yc`) and pass cleanups (`m@4`). Child computations log `compute`/`effect`/`effect_cleanup`/`error` under ids such as `L#3.e0`, `B@2.L#1.t`, `m@4.c0`.
- Values: the tier-B domain plus `{f: label}`, a labelled list/For accessor.
- The strict `'slice2c'` worker applies the `'slice2b'` rule over that domain and the new event shapes.
- `slice1-driver` implements every tier-C op, child kind, expression, edit, event and value with the same calls in the same order (`mapArray` is `crates/runtime/src/slice1/map.rs`; Show, For and the children are the driver's `make_show`, `make_list` and `child_c`, mirroring `makeShow`, `makeList` and `childC`); see [SLICE1.md](SLICE1.md). A key function reaching an `undefined` row (where `x => x.id` throws a `TypeError`, the array-hole family of [slice2c-fuzz/port/README.md](slice2c-fuzz/port/README.md)) fails closed.

### Strings (`--strings`)

`--strings` runs `generate-strings.mjs` on `slice1-driver` with the worker in strict mode `'strings'`: the `'slice2c'` rule with strings accepted wherever a value is. No op is new: strings enter as `signal`/`write`/`resolve` values and `lit` literals, and meet `add` (JS `+`: concatenation, `ToString` of an integer), `eq` (`===` by content), `choose`/`not` (`""` is falsy), store fields, list items and key functions, and a memo's flight name (`flight + ':' + value`). `fuzz/solid.mjs`'s `enc` gives a string as itself (before: `{nonscalar: "string"}`), as the legacy `lg` sites always did; the driver's `enc`/`lg` match. See [RENDERER.md](RENDERER.md), "Strings".

### Renderer (`--render`)

`--render` runs `generate-render.mjs` programs on Solid 2's `@solidjs/universal` with a recording host (`fuzz/universal.mjs`, a fresh `render-worker.mjs` per program, loaded with `--conditions=browser`) and on `render-driver`; the comparison is the host's full log. The program language, the host and the results are in [RENDERER.md](RENDERER.md).
