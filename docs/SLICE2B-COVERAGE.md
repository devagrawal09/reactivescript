# Slice 2b (tier B): stores and per-row optimistic writes. Fuzz mode, baseline, Solid coverage delta

Reference: Solid `2105ffb8` (rc.21), `packages/signals/src/`, read-only. The design is [SLICE2B-DESIGN.md](SLICE2B-DESIGN.md), tier B only; lists, Show and memo children (tier C) are not generated. The port is `crates/runtime/src/slice1/`, at slices 1 and 2a, untouched here. The method is the coverage-first method of [SLICE1-PARITY.md](SLICE1-PARITY.md) and [SLICE2A-COVERAGE.md](SLICE2A-COVERAGE.md), with one change: coverage is collected with **one fresh worker per program** (section 4). Artifacts and scripts are in [slice2b-fuzz/](slice2b-fuzz/).

## Port status (after this baseline)

The store tier is ported since this baseline (`crates/runtime/src/slice1/store/`, with the reached core arms): `--slice2b` seeds 1–1000 agree **1000/1000** and held-out seeds 1001–3000 **1999/2000** (seed 1430 invalid). Every function of the delta below (section 5 and the appendix) has a cited Rust counterpart. Results, deviations and the diagnosis of the invalid seeds (a suspected Solid bug in `take`) are in [SLICE1.md](SLICE1.md); run artifacts in [slice2b-fuzz/port/](slice2b-fuzz/port/). The sections below are the pre-port baseline as measured.

## Handoff summary

- **Mode.** `node fuzz/run.mjs --slice2b --seeds N [--start S] --out DIR [--no-reduce]`. It runs `fuzz/generate-slice2b.mjs` on `slice1-driver`, with the worker oracle in strict mode `'slice2b'` and exact full-trace comparison.
- **Baseline (port as copied: `147d971` plus the uncommitted 2a tier).**
  - Seeds 1–1000: **0/1000**. All 1000 fail as `rust-panic` at their first `store` op: `slice1-driver.rs:245` says `operation outside slice 1`. The reduced case is that one op. There are 0 invalid programs.
  - Held-out seeds 1001–3000: **0/2000**. 1999 fail as `rust-panic`. 1 is invalid (seed 1430, `oracle-error`; see the next bullet).
- **Invalid seeds.** None in 1–1000. Seed **1430** (held-out, `opt-store-derived`) is `oracle-error`. Solid throws `TypeError: Cannot read properties of null` inside its own code (`resolveTx` ← `txOf` ← `setSignal` ← `leafSet` ← `notifyKeyDiff` ← `applyAdopt` ← `reconcileState`) while a derived optimistic store reconciles a list answer. This is a **suspected Solid bug**, not reported upstream. The repro is reduced to 42 ops: [slice2b-fuzz/repro-1430-resolveTx-null.json](slice2b-fuzz/repro-1430-resolveTx-null.json).
- **Gates are unchanged.**
  - `--slice1` 1–1000 is **1000/1000**.
  - `--slice2a` 1–1000 is **991/1000**: 8 `oracle-nonscalar` (225, 339, 427, 488, 663, 683, 704, 873) and 1 `rust-panic` (629).
  - Both `summary.json` files are identical to the recorded ones in `docs/slice2a-fuzz/port/`.
  - The **byte gate** compares the whole oracle result message under the old and new `solid.mjs`/`worker.mjs` for `--slice1` 1–3000, M1 1–2000 and `--slice2a` 1–3000. All are identical except one M1 `oracle-error` (seed 1193). There, only the oracle's own stack-frame path and line differ.
- **The delta the port must add (seeds 1–1000, against `--slice2a` 1–1000).**
  - 159 Solid functions run for the first time, and 25 already-run functions take new branches: **1964 new TS code lines**.
  - By file: `store/store.ts` 967, `store/optimistic.ts` 377, `store/reconcile.ts` 197, `store/projection.ts` 171, `core/lanes.ts` 88, `core/core.ts` 52, and the rest 112.
  - The delta against `--slice1` ∪ `--slice2a` has the same functions and lines.
- **`slice1/` cut sites now reached** (section 7):
  - **`take`** (`lanes.rs:264` panic): 22 seeds. Of those, 15 reach it via `laneStage` (an optimistic memo) and 7 via the store's `_slotTake`.
  - `kept` back and restored at `endLanes`: 21 seeds back, 5 seeds restored.
  - **A staged error served as a lane value** (`core.rs:853` panic): 5 seeds, `store-provenance`.
  - An effect whose value is `undefined` (`effect.rs:114`): 16 seeds.
  - The whole store tier, which `mod.rs` lists as not ported.
  - `laneOutcome`/`stale`/`answered`: ported, never run before.
  - Values outside `i64` (`Value = Option<i64>`, `mod.rs:43`): every program.
- **Cut sites still not reached:**
  - the dormant memo reawaken (`core.rs:605`) and the dormant sweep (`core.rs:840`);
  - CONFIG_VERDICT readers (`verdict.rs:49/57/128`) and `observeFlight` (`core.rs:795`);
  - a lane seam over a staged error (`lanes.rs:564`);
  - a NotReady rejection of a loading node (`async.rs:426`);
  - zombies and `parkChildren` (tier C).

  Solid store paths not reached: `pairRows`, `laneOutcome`'s stale arm, `latestView`, `optimisticOwnDescriptor`, `membershipChanged`, `familyStatus`, `deep`/`snapshot`/`storePath` (section 9).
- **Method finding.** Running all programs in one process, as `docs/slice2a-fuzz/tools/eq.mjs`/`perop.mjs` do, lets Solid state from one program (open lanes, unsettled flights) run inside later programs. The traces did not change, so the equivalence check stayed green. The counts did: `guessFlights` returned true 1,021,429 times in 986 programs in one process, but 1,259 times in 162 programs with fresh workers. Every count in this document uses fresh workers. The call counts in SLICE2A-COVERAGE.md were collected in one process and may be inflated the same way.

## 1. The `--slice2b` mode

### Oracle (`fuzz/solid.mjs`): what is implemented

Every new branch is reached only through a new op name, a new field, or a new expression op. The legacy `evalExpr` cases are textually unchanged. Its `default:` now delegates to `evalExprB`, whose own `default:` throws `bad expression` exactly as before.

- **Expressions** (design sec. 2):
  - `store`, `get` (key literal or expression), `has` (1/0), `len`, `eq`, `not`;
  - `elem`, `pos`;
  - `filter`, `count`, `find`, `replace`, each an explicit index loop, or native `Array.prototype` methods with `native: true`;
  - `obj`, `arr`, `lit` (a `structuredClone` on every evaluation), `plain` (a deep copy of the listed fields);
  - `arg`, `sent`, `draft`.

  Context is a dynamic `CX`, saved and restored by `within`. Updaters and store setters capture the caller's `CX` statically.
- **Ops** (design sec. 3.2):
  - `store`: plain, `optimistic` (with `key`), and derived optimistic (`derive: {expr, flight, fresh}` with `seed`, `key` and `seedLoading`). A derive logs `derive` and `flight` and returns the flight's promise.
  - `store_set`: the edit forms `set`, `del`, `push`, `insert`, `remove`, `removeKey`, `move` and `splice` over paths of fields, indices and `{key, is}`. A missed `{key, is}` logs `miss` and is a no-op. There is also a `returns` form and a `reconcile` form (`key` defaults to `"id"`; `null` is positional).
  - `update` (a functional updater; logs `update` with the guessed previous value), `drain` (32 microtask hops, then `flush`), `refresh {store}`.
  - The expression forms of `read`/`latest`/`pending` (`{op, label, expr}`).
  - `memo` with `optimistic: true` (`createOptimistic(fn)`; its setter is registered).
  - Actions with `steps` (`write`, `update`, `store`, `refresh`, `refresh_store`, `read`) and `catch`. A caught action logs `caught`.
- **Value encoding** (design sec. 1):
  - New events log through `out()`: ints as is, `undefined` → `null`, a store proxy → `{p: token}`, a plain array → its elements, a raw object → `{r: token, v: {...}}`.
  - Tokens are numbered lazily in first-logged order, per program.
  - The proxy test reads the `$TARGET` brand, which the trap answers with no reactive read.

**Deviations from the design, with reasons:**

1. **No throw on a value outside the domain.** The design's `enc` throws. A throw inside a memo or effect callback would change Solid's control flow. Instead, a non-plain object (an Error, a Promise) or a function is logged as `{nonscalar: kind}`, and the strict worker makes the program invalid. Non-integer numbers are passed through, and the worker rejects them too.
2. **Legacy log sites use `lg()` instead of `out()`.** These are compute/effect `prev`/`v`/`p`, `effect_cleanup`, and legacy `read`/`latest`. `lg()` encodes only arrays, plain objects and proxies, and passes every other value through unchanged (ints, `undefined`, Error objects, strings). Legacy traces therefore stay byte-identical, including the 2a programs where Solid logs an Error object or `undefined`. With `out()`, those would have turned into `null`/`{r,v}` and changed the `--slice2a` failure details.
3. **Not implemented (tier C):** `list`, `show`, memo `children`/`cleanup`, the `item`/`index`/`call` expressions, the `row`/`fallback`/`branch` events, and function labels (`{f}`).
4. **Mode flag.** `run.mjs` has `--slice2b`, not the design's `--gen tierB`. `worker.mjs` does change (design: no change), because the strict domain check is required (next section).

### Strict worker (`fuzz/worker.mjs`, `workerData.strict === 'slice2b'`)

The 2a rule is reused over the tier-B value domain. A value may be:

- `null` (or `undefined`; the comparator's JSON gives `null` for both);
- an integer;
- a plain array of values;
- `{p: int}`;
- `{r: int, v: {field: value}}`.

Booleans are allowed only as `pending` results, and `{error: string}` only for failed reads. The event shapes include the new tags `update`, `derive`, `caught` and `miss`.

Otherwise the program is `oracle-nonscalar`. The `detail` is the JSON of the bad event, with Error objects as `Error: message`. `oracle-halted` is as in 2a. The `strict: true` (2a) path is unchanged.

Accepting `undefined` is deliberate in this tier, because a deleted key or a missing row reads `undefined`. All 32 `effect … null` events in seeds 1–1000 are legitimate. They come from `store-plain`'s `e3` reading a row index past the end: compute ran, and the store read gave `undefined`. None has the 2a shape of an effect applied with no compute.

### Harness (`fuzz/run.mjs`, additive, behind `--slice2b`)

- **Driver, generator and mode.** `--slice2b` selects `slice1-driver`, `generateSlice2b`, and `slice2bFamily(seed)` as the mode.
- **Strict worker.** It passes `workerData: {strict: 'slice2b'}`.
- **Reducer.** The reducer keeps the failure class, as in `--slice1`/`--slice2a`. It uses `valid2b`, which walks every expression key (`a b test yes no expr of where with key fields items`) and the action steps. It checks that node, setter, store and owner references name an earlier definition.
- **Other modes.** With `--slice1`, `--slice2a` or no flag, the code paths are unchanged (byte gate below).

### Generator (`fuzz/generate-slice2b.mjs`)

The generator uses Mulberry32, as the other generators do. A program is a pure function of its seed, which was checked over seeds 1–3000. Programs have 23–115 ops, median 39.

The family is a deterministic weighted choice, `W[seed mod 24]`, made without the RNG.

| family (weight) | program | seeds in 1–1000 | ops (min/median/max) |
| --- | --- | ---: | --- |
| `store-plain` (3) | store `{list:[2–5 rows {id,a,t}], n}`; memos for `n`, `len`, `count a==0`, `list[k].a`, and optional `find`/`has`; 2 render effects and 1 user effect (`plain` copies); 12–18 turns of edits: leaf, index field, keyed field (15% missing key), push, remove, insert, move, delete, row replacement by `lit`, setter `returns` filter, `reconcile` by `id` or positional; 30% batched edits. A JS model of the store keeps every index path in range. | 125 | 36/50/71 |
| `store-actions` (3) | the store plus signal `s` and optimistic `o`; up to 3 overlapping two-slice actions whose steps mix keyed store edits, push/`removeKey`, writes and reads (slice 2 may write `sent`); 30% have `catch`; 1/4 rejected; read/latest/pending over store expressions | 126 | 29/39/50 |
| `opt-memo-rows` (4) | store rows; `shown` is an optimistic memo with one of three shapes: (a) the list proxy, as in the tracker; (b) a `plain` copy, so row writes re-run the guessed memo (`laneOutcome`); (c) a `replace` that reads optimistic `o2`, which "pin" actions guess (another action's lane re-derives the guess: `take`). There is a `mode` signal, a `visible` filter and a `cnt` count, each loop or native. Claims are: slice 1 updater guess on row K, flight `claim:K#c`, slice 2 store write of `sent` and `status=0`, catch `status=K`. Same-row double claims; resolve and reject in random order. | 168 | 24/36/49 |
| `opt-store-rows` (4) | `createOptimisticStore({list})` keyed by `id` (75%) or positional; a separate plain store `tr`; claims guess `a=9` on row K, push a row, or `removeKey` K; slice 2 writes `sent` into `tr` or into the optimistic store; `has` memos and probes (`optimisticHas`); latest/pending on row fields | 168 | 23/34/47 |
| `opt-store-derived` (3) | a derived optimistic store over `list:<page>#<n>` (seed `[]`, key `id` or null, 25% `seedLoadingValue`). Toggles: slice 1 guesses `d` on row K, or (arrangement variant) pushes or removes a row; it yields `save:K#c`, and slice 2 runs `refresh_store`. A server model answers list questions with echo, correction, reorder, added or dropped rows. Page writes ask new questions; in the `nav` variant, `page` is optimistic and nav actions guess it (the derive re-asks in another action's lane: `_slotTake`). `drain` ops. List rejections only when render effects do not read the store. | 126 | 33/44/55 |
| `store-provenance` (3) | the derived store; 1–2 rounds of 2–3 actions on the **same** row, each refreshing, optionally with nav actions in between. The saves resolve, then the list answers resolve **newest first**, so older answers land under newer guesses. Mainline store and signal writes in between. | 123 | 38/69/115 |
| `tracker` (4) | `frontend/tsx/fixtures/demo/tracker.tsx` without Show/For: store `issues`, optimistic `shown`, `mode`/`status`, `visible`/`unassigned` (native 50%), render effects `head`, `body` (`choose(len(visible), plain(visible,[t,a]), -1)`, standing for Show+For) and `foot`. Claims as in the demo: an updater guess, `yield assign:K#c`, a store path write of the yielded owner, and a catch writing `status`. Ints stand for strings: `''`=0, `me`=9, owners 6–8. | 164 | 25/36/48 |

A root `move` is deliberately not generated inside actions. The array length at run time is unknown, and `move` on an empty array throws V8's `Invalid array length`.

**Tracker anchor.** `trackerDemo()` in the generator is the demo `SCRIPT` as one program. [slice2b-fuzz/tools/tracker-demo.mjs](slice2b-fuzz/tools/tracker-demo.mjs) runs it on the oracle and renders the render effects' last values after each step as the demo's frame strings. **All 8 frames match `EXPECTED`** of `frontend/tsx/demo.test.ts` ([slice2b-fuzz/tracker-demo.txt](slice2b-fuzz/tracker-demo.txt)). This is a structural check of the op encoding, not a parity score.

### Byte gate (design sec. 3.5)

[slice2b-fuzz/tools/gate.mjs](slice2b-fuzz/tools/gate.mjs) runs each program through the pre-change `solid.mjs`/`worker.mjs` (copied to `out/gate-old/`) and through the new ones. Each program runs in a fresh worker with the `workerData` that `run.mjs` gives the mode. The whole result message is compared as JSON. Results are in [slice2b-fuzz/byte-gate.txt](slice2b-fuzz/byte-gate.txt):

| generator | seeds | identical | different | note |
| --- | --- | ---: | ---: | --- |
| `--slice1` | 1–3000 | 3000 | 0 | |
| M1 (`generate.mjs`) | 1–2000 | 1999 | 0 | Seed 1193 is `oracle-error` in both (the known `deleteFromHeap` TypeError). Its `detail` differs only in the oracle's own frame (`out/gate-old/solid.mjs:21` vs `fuzz/solid.mjs:108`). It is listed separately, not counted as identical. |
| `--slice2a` | 1–3000 | 3000 | 0 | including the 24 `oracle-nonscalar` details |

## 2. Validity, and what the traces contain

These figures are for seeds 1–1000, each program in a fresh strict worker ([slice2b-fuzz/tools/workers.mjs](slice2b-fuzz/tools/workers.mjs)).

- **Validity:** 1000 valid; 0 invalid; 0 timeouts, errors, halts or nonscalar.
- **Held out (1001–3000):** 1999 valid, 1 `oracle-error` (seed 1430).

**Op counts** (from `summary.json`): 1168 `store`, 3235 `store_set`, 2777 `memo`, 2895 `effect`, 4219 `action`, 6447 `resolve`, 795 `reject`, 1991 `drain`, 192 `refresh` (all `{store}`), 5082 `read`, 3587 `latest`, 2442 `pending`.

**Events** (trace length median 81, max 192):

| event | count | programs |
| --- | ---: | ---: |
| `update` (updater invoked) | 1399 | 321 |
| `derive` / `flight` (derive runs) | 1735 | 249 |
| `miss` | 861 | 394 |
| `caught` | 447 | 338 |
| `action` ok / errors | 3982 / 237 | |
| `pending` → `true` | 263 | 148 |
| `read`/`latest` → `{error}` (`pending`, `fetch-failed`) | 75 | |
| effect `error` (a rejected derive reaching user effects) | 48 | 16 |

## 3. Baseline

| run | agree | invalid | failure classes |
| --- | ---: | ---: | --- |
| `--slice1` seeds 1–1000 (gate) | 1000/1000 | 0 | — |
| `--slice2a` seeds 1–1000 (gate) | 991/1000 | 8 | `oracle-nonscalar` 8 (first 225), `rust-panic` 1 (629) |
| `--slice2b` seeds 1–1000 | **0/1000** | 0 | `rust-panic` 1000 (first seed 1) |
| `--slice2b` seeds 1001–3000 | **0/2000** | 1 | `rust-panic` 1999, `oracle-error` 1 (1430) |

Every `--slice2b` family is 0 of its seeds. The reduced case ([slice2b-fuzz/reduced-rust-panic.json](slice2b-fuzz/reduced-rust-panic.json)) is the single `store` op. The driver has no `store` arm. Tier B also needs, in the driver:

- `store_set`, `update` and `drain`;
- `memo` with `optimistic`: `Runtime::optimistic` exists in `mod.rs:480` but the driver does not expose it;
- `refresh {store}`;
- the expression forms of the probes, and actions with `steps`/`catch`;
- the expression ops;
- a structured value type with identity tokens.

## 4. Coverage method

1. **Source copy.** Use the same TS copy as SLICE1-PARITY.md: `out/solid-src`, made with `fixctor` and run with `register.mjs`/`hooks.mjs` and the prod flags.
2. **Equivalence.** For seeds 1–1000, four traces are byte-identical:
   - `slice2b-fuzz/tools/eq.mjs` in one process against `dist/prod`;
   - the same through the TS copy;
   - `workers.mjs` (fresh strict workers on dist, as `run.mjs`);
   - `cov-workers.mjs` (fresh workers on the TS copy).
3. **Whole-run delta, in fresh workers.** [slice2b-fuzz/tools/cov-workers.mjs](slice2b-fuzz/tools/cov-workers.mjs) runs each program in its own worker under `NODE_V8_COVERAGE`. Each worker writes its own coverage file, and `docs/slice2a-fuzz/tools/delta.mjs` sums them. The base is `--slice2a` 1–1000 collected the same way. Output: [slice2b-fuzz/coverage-delta.txt](slice2b-fuzz/coverage-delta.txt).
   - **Why fresh workers.** In one process (the 2a method), the line set differs by 17 lines (1981 vs 1964), and call counts inflate by orders of magnitude for lane-walking functions. For example, `guessFlights` true, `nodesOf` and `slotKept` run over lanes earlier programs left open.
4. **Per-operation attribution.** [slice2b-fuzz/tools/perop.mjs](slice2b-fuzz/tools/perop.mjs) uses the 2a method: inspector precise coverage, taken at every op boundary. Each program runs in a fresh worker. It adds tier-B op classes:
   - `store:<kind>[+positional][+seedLoading]`;
   - `store_set:<kind>:<form>` (forms: leaf, row, field, keyed, push, insert, remove, removeKey, move, del, multi, returns, reconcile, reconcile-pos);
   - `action:<slice-1 step kinds>`;
   - `resolve`/`reject:derive-flight|action-flight`;
   - `read`/`latest`/`pending:expr`;
   - `update`, `drain`, `refresh:store`.

   Output: [slice2b-fuzz/perop-report.txt](slice2b-fuzz/perop-report.txt) (`NEW` = never called anywhere in `--slice2a`; `+` = not called by a 2a op of the same kind).
5. **Site marks.** [slice2b-fuzz/tools/marks.mjs](slice2b-fuzz/tools/marks.mjs) builds `out/solid-mark`, a copy of the TS source with a counter at each site of interest. It runs every program in a fresh worker and prints hits, seeds, the per-family split and the first seeds. Output: [slice2b-fuzz/marks-1-1000.txt](slice2b-fuzz/marks-1-1000.txt). `out/solid-mark/one.mjs FILE` runs one program with its trace and marks.

Reproduce from the repository root with Node 24:

```sh
P=docs/slice1-fuzz/parity/tools; T=docs/slice2b-fuzz/tools; D=docs/slice2a-fuzz/tools; SRC=file://$PWD/out/solid-src/index.ts
node fuzz/run.mjs --slice2b --seeds 1000 --out out/s2b/run-1000
node fuzz/run.mjs --slice2b --start 1001 --seeds 2000 --no-reduce --out out/s2b/run-heldout
node fuzz/run.mjs --slice1 --seeds 1000 --out out/s2b/gate-slice1-1000
node fuzz/run.mjs --slice2a --seeds 1000 --no-reduce --out out/s2b/gate-slice2a-1000
mkdir -p out/gate-old && cp ../rust-parity/fuzz/solid.mjs ../rust-parity/fuzz/worker.mjs out/gate-old/   # the pre-change oracle
SOLID_SIGNALS_URL=file://$PWD/../solid-next/packages/signals/dist/prod/index.js node $T/gate.mjs slice1 1 3000   # and m1 1 2000, slice2a 1 3000
node $T/workers.mjs 1 1000 out/w2b-1000.txt; node $T/eq.mjs slice2b 1 1000 out/s2b/dist-2b.txt
NODE_V8_COVERAGE=$PWD/out/s2b/cov/w-2a node $T/cov-workers.mjs slice2a 1 1000
NODE_V8_COVERAGE=$PWD/out/s2b/cov/w-2b node $T/cov-workers.mjs slice2b 1 1000 4 out/s2b/ts-workers-2b.txt
node --max-old-space-size=12000 $D/delta.mjs out/s2b/cov/w-2a out/s2b/cov/w-2b [--lines]
node $T/perop.mjs slice2a 1 1000 out/s2b/wperop-2a.json; node $T/perop.mjs slice2b 1 1000 out/s2b/wperop-2b.json
node $D/perop-report.mjs out/s2b/wperop-2a.json out/s2b/wperop-2b.json
node $T/marks.mjs 1 1000 out/s2b/marks-1000.json
node $T/tracker-demo.mjs; node $T/oracle-reduce.mjs 1430 out/s2b/reduced-1430.json
```

The old copy is `rust-parity`'s `fuzz/solid.mjs` and `fuzz/worker.mjs`, which are byte-identical to this worktree's files before this change. `fuzz/worker.mjs` at HEAD is the pre-2a worker, so do not use it.

## 5. Delta counts

Seeds 1–1000, against `--slice2a` 1–1000, collected with fresh workers:

| file | functions with new lines | never called in slice2a | new code lines |
| --- | ---: | ---: | ---: |
| store/store.ts | 78 | 76 | 967 |
| store/optimistic.ts | 35 | 33 | 377 |
| store/reconcile.ts | 4 | 4 | 197 |
| store/projection.ts | 24 | 24 | 171 |
| core/lanes.ts | 13 | 5 | 88 |
| core/core.ts | 6 | 3 | 52 |
| core/verdict.ts | 4 | 1 | 23 |
| core/heap.ts | 4 | 2 | 21 |
| core/async.ts | 4 | 1 | 21 |
| store/types.ts | 2 | 2 | 15 |
| store/target.ts | 4 | 4 | 13 |
| store/index.ts | 3 | 3 | 8 |
| signals.ts | 1 | 0 | 8 |
| core/owner.ts | 1 | 1 | 2 |
| core/graph.ts | 1 | 0 | 1 |
| **total** | **184** | **159** | **1964** |

The full list, with call counts and the matching Rust comment, is in the appendix.

## 6. Call map per new operation

Calls follow Solid's order inside the op; file:line ranges are rc.21 TS lines. Counts are whole-run calls over seeds 1–1000 (fresh workers). Per-op averages are in `perop-report.txt`. Only what is new relative to `--slice2a` is spelled out.

### `store` (plain): `createStore(value, {shallow?})`

- `index.ts:103` `createStore` → `store.ts:2576` `createStore` → `wrap` 205 → `lookupTarget` (target.ts:165) / `createTarget` 191 (`TargetShape` 157) / `setLookup`. The result is the root proxy over the raw value.
- No node exists until a read: nodes are lazy, one per read key (`getNode` 389), plus `getHasNode` 433 for `in` and `getContainerNode` 450 for structure.
- The setter is `setter` 2613 → `storeSetter` 2509.

### `store` (optimistic): `createOptimisticStore(value, {key})`

`optimistic.ts:895` → `projection.ts:379` `createProjectionInternal`, with no derive. It builds `fam` with `opt: true` and the key function (`fam.key` 403; the default key is `"id"`, `null` is positional), then `wrap`.

### `store` (derived optimistic): `createOptimisticStore(fn, seed, {key, seedLoadingValue?})`

1. `createProjectionInternal` builds the family and, for `fn`, a `computed` (`CONFIG_AUTO_DISPOSE` cleared, `_fam`).
2. The computed's first pass: `runProjectionComputed` 246 → `wrapDraft` 75 (the draft proxy's `read`/`get`) → `pass` 296 → `storeSetter(draft, …)`. Inside, the oracle's derive logs `derive` and `flight` and returns the flight's promise.
3. → `handleAsync` → NotReadyError → `notifyStatus(PENDING)`. This is the 2a flight engine on the family node.
4. `seedLoadingValue` gives the computed `loadingValue: undefined` and a detached shadow draft (`cloneState` 144).

### Reads through a proxy (`get`, `len`, `has`, `filter`, `plain`, …)

The trap `get` store.ts:2088-2262 (308,747 calls):

1. The `$TARGET`/`$TRACK` brands are answered first.
2. `pullFamily` 1852: a derived store's family is brought current, which can throw the family's NotReady or error.
3. `readSource` 1542 → `serveDataKey` 1793 → `nodeValue` 1772.
4. With an observer, `getNode` 389 → `slotSignal` (core.ts:1679, a slot node with `_host`/`_key`) → `noteNode` 331 → `read`.
5. On an optimistic family, `optRead` 2011 → `optimisticView` optimistic.ts:823, which serves guesses over the committed backing.
6. Nested objects come back wrapped (`wrap`).

Other traps:

- **`has` 2264-2293.** With an observer it reads `getHasNode`. Untracked on an optimistic family, it calls `optimisticHas` 792 (84 calls, `opt-store-rows`).
- **Native `filter`/`map`/`findIndex`.** These go through `get length`, `get constructor`, `has i` and `get i`, so they subscribe presence nodes.
- **Releasing slots.** At unobserve, `releaseSlot` 308 and `slotKept` 345 keep or release a slot node.

### `store_set` with path edits, on a plain store

1. `setter` → `storeSetter` 2509: open `writeScopes`; set `userWrite`; `writing++`.
2. Run the oracle function on the proxy. Draft reads are `draftServe` 1498 / `inDraft` 1486. Each `set` trap 2342 or `deleteProperty` 2407 makes:
   - `ensurePB` 706: the pre-batch backing (`cloneRaw` 588, `privatizeCommitted` 742);
   - `touch` 2025, which queues the target in `pendingNotify`.
3. At the outermost exit, `notifyWrites` 1157-1309 runs per target. It writes each changed observed key's node: `setSignal` (core) on the slot node, leaf by leaf, length and container (`notifyContainer` 529, `arrayStructureChanged` 1322). It then calls `stageOn` 479 / `deriveHolds` 498 and `queueFold` 883.
4. At the flush end, `drainFolds` 906 → `foldTarget` 984 folds the pre-batch into the committed backing. The 2a `storePark` 503 becomes non-empty.
5. Inside an action (`store-actions`), the slot nodes' writes join the action's transaction like signal writes. Readers outside see the committed backing (`stagingReader` 1522, `heldKeyChanged` 1647, `changedBetween` 1735).

### `store_set` with `returns`, and with `reconcile`

- **`returns`.** A returned replacement → `adoptPB` 809 → `notifyKeyDiff` 1355 / `leafSet` 1348 / `notifyFoldTail` 1432 / `notifyFold` 1457 (on a plain family; `targetsEqual` 1315).
- **`reconcile`.**
  1. `index.ts:113` `reconcile(value, key)` returns `state => reconcileState(value, state, key)` (reconcile.ts:45).
  2. Inside the setter, `applyAdopt` 92-288 and `descend` 303 match rows by key (`keyFn` 55, `sameRow` store.ts:1666, `sameKey` 258) or by position.
  3. Leaves are written with `notifyKeyValue` 1395 / `notifyKeyDiff`. `userWriting` 1135 tells a user's reconcile from a derive's.

### `memo` with `optimistic: true`: `createOptimistic(fn)`

`signals.ts:458-475`, the function arm (new lines 463-471): `computed(fn)`, with `CONFIG_AUTO_DISPOSE` cleared and the setter `optimisticWrite`. The pass is an ordinary memo pass. Over a store, it reads through the traps above.

### `update` (an updater step in a claim)

`optimisticWrite` lanes.ts:186 → `guessedValueOf` → the oracle's updater, which logs `update` with the guessed value (the list proxy, or an earlier guess's array) → `pendingGuesses`. At the seam, `applyGuesses` (new lines 236-238: a guess over a node that already carries one) and `laneStage` (new 415-418, 432-441, 462-465) apply it.

- **`take` (lanes.ts:174-181).** It fires when another action's lane re-derives the guessed memo (`opt-memo-rows` shape (c): a pin action guesses `o2`). The other action's guess is pushed on `kept`, and its readers become stale readers (`rerun` 183).
- **Kept guesses back.** At `endLanes` (new 913-931), a reverted lane's kept guesses come back.
- **Truth landing under a guess** (shape (b), a row write re-running the guessed memo outside a lane). `recompute` → `laneOutcome` 1014 → `answered` 1035 / `stale` 1028 → `supersede`. The stale arm (1016-1019) is not reached.

### `store_set` on an optimistic store (inside or outside an action)

`storeSetter` → `optimisticDraft` optimistic.ts:115 (`writerBacking` 102). At exit, `notifyWrites` takes the optimistic channel (store.ts:1163-1170): the draft is discarded, and `optHooks.writes` runs:

1. `notifyOptimisticWrites` 120-223 diffs the draft against the view.
2. Each changed key gets a `guess` (134) → `optimisticWrite` on its leaf, presence and length nodes.
3. A structural change also gets a `LaneView` (store.ts:272) container guess, compared by `containerEquals` 294 → `arrangement` 230 / `arrangementEqual` 278 / `rowSame` 237.
4. `markOverlaid` 687 records the target; `sweepOverlaid` 693 clears it at the seam.

The guesses then follow the lane machinery of `update` above, one lane per action, independent per row.

### `refresh {store}` / the `refresh_store` step, and `drain`

- **`refresh`.** `refresh(proxy)` resolves `$REFRESH` to the family node, then follows 2a's path: `markRefresh`, then a `queueMicrotask` → `watch` waiter. The waiter is created at the next `drain`, `resolve` or `reject` (32 microtask hops, then `flush`).
- **The re-ask.** `runProjectionComputed` runs again, with `asking` 278 (the question: a slice's, or the flight's).
- **A re-ask in another action's lane.** When the re-ask happens inside another action's lane (`nav` variant), `GlobalQueue._slotTake` optimistic.ts:353 runs. `sameAction` 670 checks the action. `take(m, d, true)` then fires for the target's other guessed slots: 7 seeds.

### `resolve` of a derive flight (`list:<p>#<n>`)

1. The promise reaction → `asyncWrite` (new lines 620-622, 631-635, 645-646: the derive's `commit` callback that `handleAsync` was given) → the projection's `commit` 301 / `write` 308.
2. The write is `storeSetter(store, st => reconcileState(answer, st, key, true), guard = false)` under `setQuestion(asking())` → `applyAdopt`. It is not a user write, so on an optimistic family it is truth, not a guess.
3. On an optimistic family, the derive's draft first pairs new rows with guessed rows: `optHooks.pair` = `pairRows`, which is **not reached**.
4. Each leaf write on a guessed slot → `setSignal` → `laneWrite` lanes.ts:969 (GUESS arm 982-990) → `stale(el, question)` → `GlobalQueue._laneRebase` optimistic.ts:397. Then one of three things happens:
   - a current truth under a keyed arrangement guess → `fold` 475: a confirmation, or `l.folded = foldedRead` 502, so readers outside the lane re-derive from the truth beneath;
   - an older truth → the re-base 397-466: rows by key, `laneSet` 529, the #4525 `view.g === null` branch;
   - otherwise held beneath (`CONFIG_HELD`).

   `_echoes` 270 / `echoes` 258 decide confirmations.
5. `settleFamily` 201 / `wakeFamily` 155 / `forEachFamilyNode` 230 update the family's readers. `stagedScreen` (core.ts:2585), `holdStaging` (verdict.ts:873) and `joinPassAt` (core.ts:1312) serve held and folded values to readers outside the lane.
6. **Rejection** (`reject:derive-flight`): `errorFamily` 188 propagates the error to the leaves' readers. In 9 `store-provenance`/`opt-store-derived` seeds, it is staged (`stageError`) and served as a lane value (`laneValueOf` returns a staged `StatusError`, truth.ts:24): 5 seeds.

### `resolve` of an action flight

This is 2a's path, plus slice 2 of the step actions:

- store writes of `sent` to the row of the claim (keyed path);
- `status` writes;
- `refresh_store`.

The action's lanes end (`endLanes`), and kept guesses come back (`kept-restored`, 5 seeds). The revert of a body whose guess was not confirmed is `reverted` (1259 hits, 680 seeds).

## 7. `slice1/` cut sites: reached or not

Seeds 1–1000, from `marks-1-1000.txt` (fresh workers):

| cut site in `crates/runtime/src/slice1/` | Solid | `--slice2b` | seeds (first) |
| --- | --- | --- | --- |
| `take` panic (`lanes.rs:264`) | lanes.ts:174-184, 462-465 | **reached: port panics** | take 27 calls / 22 seeds (30, 40, 114, 223, 224); via `laneStage` 15 seeds (30, 223, 224, 297, 345), via `_slotTake` 7 (40, 114, 351, 352, 523) |
| `kept` "always empty" (`lanes.rs` `end_lanes` header) | lanes.ts:911-931 | **reached** | back 21 seeds; restored 5 (223, 345, 352, 439, 545) |
| staged error served as a lane value panic (`core.rs:853`) | truth.ts:24 (`laneValueOf`) | **reached** | 5 (89, 521, 593, 905, 930), `store-provenance` |
| staged errors (`stageError` staging; commit publishes) | async.ts:225-256; scheduler.ts:1522-1526 | reached (ported in 2a) | stage 9 seeds; publish 6 |
| effect run with an `undefined` value (`effect.rs:114` expect) | effect.ts | **reached** | 16 (73, 337, 361, 433, …), `store-plain` |
| `laneOutcome` / `stale` / `answered` (ported, never run) | lanes.ts:1014-1042 | **reached** | laneOutcome 106 calls / 50 seeds (7, 8, 31, 33, 55); the stale arm 0 |
| `laneWrite` "no store re-bases or slot takes" (`lanes.rs:616`) | lanes.ts:969-1000 | **reached** (GUESS arm with `_laneRebase`) | rebase 570 calls / 151 seeds; held 100 seeds |
| `linkLanes` (ported in 2a) | lanes.ts:348-360 | reached, more | 280 calls / 176 seeds |
| `guessFlights`/`inFlight` constant false (2a) | lanes.ts:213-218, 826-832 | **reached, returns true** | 1259 / 162 seeds (derived families: `_slotFlight`) |
| whole store tier, optimistic stores (`mod.rs:12`, `:262`) | store/*.ts | **reached** | every program |
| `Value = Option<i64>` (`mod.rs:43`); driver `eval` panics on `undefined` | — | **reached** | every program (arrays, objects, proxies, `undefined` reads) |
| lane seam over a staged error panic (`lanes.rs:564`) | lanes.ts:891-894 | not reached | 0 |
| reawaken a dormant memo panic (`core.rs:605`) | core.ts:1920-1935 | not reached | 0 |
| dormant-node sweep panic (`core.rs:840`) | core.ts:2430-2445 | not reached | 0 |
| CONFIG_VERDICT readers (`verdict.rs:49`, `:57`, `:128`), `observeFlight` (`core.rs:795`) | verdict.ts:279-333; core.ts:2350 | not reached (no tracked `latest`/`isPending`) | 0 |
| NotReady rejection of a loading node (`async.rs:426`) | async.ts:562-571 | not reached | 0 |
| zombies / `parkChildren` (`owner.rs:66`) | owner.ts | not reached (tier C: children in computations) | 0 |

## 8. Solid store and lane paths reached (design sec. 4 targets)

| design target | reached | evidence (calls / seeds, fresh workers) |
| --- | --- | --- |
| `storeSetter`, `notifyWrites`, `getNode`/`bornStaged`/`noteNode`, `getContainerNode`, `getHasNode`, `readSource`, `serveDataKey`, `nodeValue`, `ensurePB`, `privatizeCommitted`, `preBatch`/`queueFold`/`drainFolds`/`foldTarget`, `adoptPB`, `notifyKeyDiff`/`notifyKeyValue`/`leafSet`, `releaseSlot`; reconcile `reconcileState`/`applyAdopt` | yes | 10074 setters, 12758 `notifyWrites`, 6029 `foldTarget`, 920 `reconcileState` |
| `membershipChanged`, `reportReplacedContainers` | **no** | the latter is `__OBSERVE__`-only (dead in prod); the former needs a keyed object's key set observed |
| `storePark`, `heldKeyChanged`, `stagingReader`, `stageOn`, `deriveHolds`, `holdFrame` over slot nodes | yes | storePark 8673, heldKeyChanged 2571, holdFrame 7069 |
| `optimisticWrite` on a computed, `applyGuesses`, `laneStage` → **`take`**, `supersede`, `stale`, `dissolveLane`, **`endLanes` kept-return**, `linkLanes` | yes | see section 7 |
| `laneOutcome` stale arm (an older question's answer recomputing a guessed memo) | **no** | 0 |
| `notifyOptimisticWrites` (leaf, presence, length, `LaneView`), `optimisticDraft`/`writerBacking`/`cloneRaw`, `optimisticView`, `optimisticHas`, `markOverlaid`/`sweepOverlaid`, `containerEquals`→`arrangement`/`arrangementEqual`/`rowSame` | yes | 7800 / 17630 / 84 / 707 |
| `optimisticOwnDescriptor`, `latestView` | **no** | no `Object.keys`/descriptor reads; `latest()` never reaches `latestView` here |
| `createProjectionInternal`/`runProjectionComputed`/`wrapDraft`/`wakeFamily`/`settleFamily`/`errorFamily`; `pullFamily`, `adoptChild` | yes | 417 / 1735 / 1486 / 599 / 27; pullFamily 105622, adoptChild 1131 |
| `familyStatus` | **no** | 0 |
| **`_laneRebase`** incl. the #4525 `view.g = null` branch, **`fold`/`foldedRead`**, `_echoes`/`echoes`, **`_slotTake`→`take(m,d,true)`**, `laneSet`, `sameAction` | yes | rebase 570, arrangement and #4525 35 seeds, fold 377 (folded 53 seeds), foldedRead 883, slot take 7 seeds, laneSet 97 |
| **`pairRows`** | **no** | needs a derive that writes its draft after the await (`d.length = 0; d.push(…)`); the op language's derive only returns a value |
| `refresh`/`watch` (FRESH_READ, AUTHORITATIVE), truth.ts | yes | refresh/watch 1192 |

## 9. Gaps (what tier B does not reach)

- **`pairRows`** (D-34 for per-key guesses; `notifyWrites` store.ts:1174 on a derive's draft writes). It needs a derive form that awaits and then mutates the draft; a returned answer goes through `reconcileState` instead. That is an additive `derive.mode: "draft"`, not in the design.
- **`laneOutcome`'s stale arm, and `laneSeam` over a staged error.** No program found them. A directed family would be needed.
- **`membershipChanged`, `optimisticOwnDescriptor`, `latestView`, `familyStatus`, `deep`/`snapshot`/`storePath`.** There is no `keys`/`ownKeys` expression (design risk 1), no tracked `latest`, and no `deep`/`snapshot` op.
- **Verdict readers, dormant memos, zombies.** These are as in 2a; zombies are tier C.
- **`take` and `kept` restore are thin.** They are reached in 22 and 5 seeds. The seeds are listed in `marks-1-1000.txt`, and `out/solid-mark/one.mjs` replays one program with its marks.

## 10. Artifacts ([slice2b-fuzz/](slice2b-fuzz/))

| file | content |
| --- | --- |
| `summary-1-1000.json`, `summary-1001-3000.json` | the `--slice2b` baseline runs |
| `reduced-rust-panic.json` | the class-preserving reduction of the `rust-panic` class (1 op) |
| `gate-slice1-summary-1-1000.json`, `gate-slice2a-summary-1-1000.json` | the gate reruns (identical to the recorded summaries) |
| `byte-gate.txt` | `tools/gate.mjs` output |
| `invalid-seeds.json`, `repro-1430-resolveTx-null.json` | the one invalid seed (held out) and its oracle-only reduction |
| `coverage-delta.txt` | `delta.mjs` output (fresh workers, base `--slice2a`) |
| `perop-report.txt` | per-op classes (fresh workers) |
| `marks-1-1000.txt` | site marks (fresh workers) |
| `tracker-demo.txt` | the demo's 8 frames from the oracle |
| `tools/` | `gate.mjs`, `workers.mjs`, `eq.mjs`, `cov-workers.mjs`, `perop.mjs`, `marks.mjs`, `lines.mjs`, `oracle-reduce.mjs`, `tracker-demo.mjs` |

## Appendix: functions with new coverage

Columns:

- **kind:** `new` means never called in `--slice2a` 1–1000; `branches` means called, with new lines.
- **calls slice2a → slice2b:** seeds 1–1000 each, fresh workers.
- **Rust comment:** a `// Solid:` reference within ±3 lines of the function's start, or `-`. This is a heuristic match, and a hit can be a panic site (for example `lanes.rs:54` is `optimistic_write`, near `rerun`).
- **new code lines.**

| kind | Solid function | calls slice2a → slice2b | Rust comment citing it | new code lines |
| --- | --- | --- | --- | --- |
| branches | `core/async.ts:458-934` handleAsync | 5769 → 21473 | async.rs:378 | 7 |
| branches | `core/async.ts:595-683` asyncWrite | 4625 → 1305 | async.rs:450 | 10 |
| branches | `core/async.ts:836-848` flattenIfIterable | 2835 → 789 | - | 1 |
| new | `core/async.ts:839-841` (anonymous) | 0 → 789 | - | 3 |
| branches | `core/core.ts:364-1090` recompute | 21014 → 39820 | core.rs:27 | 4 |
| new | `core/core.ts:1312-1316` joinPassAt | 0 → 62 | - | 4 |
| new | `core/core.ts:1679-1724` slotSignal | 0 → 27205 | - | 26 |
| branches | `core/core.ts:2106-2447` read | 69478 → 303042 | core.rs:706 | 1 |
| new | `core/core.ts:2585-2612` stagedScreen | 0 → 133 | - | 13 |
| branches | `core/core.ts:2693-2797` setSignal | 6487 → 14745 | core.rs:929 | 4 |
| branches | `core/graph.ts:147-190` link | 34397 → 198805 | graph.rs:82 | 1 |
| new | `core/heap.ts:79-84` insertIntoHeapHeight | 0 → 2 | heap.rs:65 | 5 |
| branches | `core/heap.ts:104-112` markHeap | 2123 → 3546 | heap.rs:101 | 2 |
| branches | `core/heap.ts:123-134` runHeap | 12432 → 17904 | heap.rs:133 | 1 |
| new | `core/heap.ts:136-148` adjustHeight | 0 → 1 | heap.rs:158 | 13 |
| new | `core/lanes.ts:174-181` take | 0 → 27 | - | 7 |
| new | `core/lanes.ts:183-185` rerun | 0 → 32 | lanes.rs:54 | 3 |
| branches | `core/lanes.ts:220-273` applyGuesses | 1501 → 2907 | lanes.rs:76 | 3 |
| branches | `core/lanes.ts:348-360` linkLanes | 36 → 280 | lanes.rs:164 | 3 |
| branches | `core/lanes.ts:408-492` laneStage | 5142 → 13121 | lanes.rs:221 | 16 |
| branches | `core/lanes.ts:554-695` dissolveLane | 932 → 1822 | lanes.rs:307 | 1 |
| branches | `core/lanes.ts:716-814` laneRead | 6399 → 21905 | lanes.rs:416 | 11 |
| branches | `core/lanes.ts:818-822` covered | 927 → 2453 | lanes.rs:493 | 1 |
| branches | `core/lanes.ts:906-938` endLanes | 1627 → 2370 | lanes.rs:575 | 17 |
| branches | `core/lanes.ts:969-1000` laneWrite | 256 → 584 | lanes.rs:616 | 9 |
| new | `core/lanes.ts:1014-1023` laneOutcome | 0 → 106 | lanes.rs:645 | 6 |
| new | `core/lanes.ts:1028-1030` stale | 0 → 676 | lanes.rs:660 | 3 |
| new | `core/lanes.ts:1035-1042` answered | 0 → 106 | lanes.rs:665 | 8 |
| new | `core/owner.ts:306-308` getObserver | 0 → 85297 | - | 2 |
| branches | `core/verdict.ts:414-417` staged | 535 → 224 | verdict.rs:105 | 1 |
| branches | `core/verdict.ts:450-700` verdictValue | 23390 → 34070 | verdict.rs:124 | 4 |
| branches | `core/verdict.ts:836-840` valueInserts | 1873 → 17736 | - | 2 |
| new | `core/verdict.ts:873-890` holdStaging | 0 → 133 | - | 16 |
| branches | `signals.ts:458-475` createOptimistic | 1200 → 657 | - | 8 |
| new | `store/index.ts:103-106` createStore | 0 → 751 | - | 3 |
| new | `store/index.ts:113-118` reconcile | 0 → 131 | - | 4 |
| new | `store/index.ts:117-117` (anonymous) | 0 → 131 | - | 1 |
| new | `store/optimistic.ts:102-108` writerBacking | 0 → 15600 | - | 6 |
| new | `store/optimistic.ts:115-118` optimisticDraft | 0 → 7800 | - | 4 |
| new | `store/optimistic.ts:120-223` notifyOptimisticWrites | 0 → 7800 | - | 64 |
| new | `store/optimistic.ts:134-138` guess | 0 → 2517 | - | 3 |
| new | `store/optimistic.ts:137-137` (anonymous) | 0 → 2517 | - | 1 |
| new | `store/optimistic.ts:230-235` arrangement | 0 → 707 | - | 5 |
| new | `store/optimistic.ts:237-252` rowSame | 0 → 109 | - | 8 |
| new | `store/optimistic.ts:258-267` echoes | 0 → 1081 | - | 9 |
| new | `store/optimistic.ts:270-276` GlobalQueue._echoes | 0 → 915 | - | 4 |
| new | `store/optimistic.ts:278-294` arrangementEqual | 0 → 700 | - | 12 |
| new | `store/optimistic.ts:353-374` GlobalQueue._slotTake | 0 → 580 | - | 14 |
| new | `store/optimistic.ts:397-466` GlobalQueue._laneRebase | 0 → 570 | - | 57 |
| new | `store/optimistic.ts:475-492` fold | 0 → 377 | - | 13 |
| new | `store/optimistic.ts:502-517` foldedRead | 0 → 883 | - | 16 |
| new | `store/optimistic.ts:519-524` sameRow | 0 → 170 | - | 6 |
| new | `store/optimistic.ts:529-537` laneSet | 0 → 97 | - | 9 |
| new | `store/optimistic.ts:568-569` view | 0 → 2030 | - | 1 |
| new | `store/optimistic.ts:586-599` ask | 0 → 1486 | - | 11 |
| new | `store/optimistic.ts:588-588` a | 0 → 8930 | - | 1 |
| new | `store/optimistic.ts:620-636` stands | 0 → 7298 | - | 15 |
| branches | `store/optimistic.ts:640-647` park | 5969 → 8673 | - | 5 |
| new | `store/optimistic.ts:654-663` held | 0 → 40 | - | 10 |
| new | `store/optimistic.ts:670-672` sameAction | 0 → 177 | - | 3 |
| new | `store/optimistic.ts:687-691` markOverlaid | 0 → 7802 | - | 5 |
| branches | `store/optimistic.ts:693-708` sweepOverlaid | 11519 → 16552 | - | 11 |
| new | `store/optimistic.ts:763-768` nodesOf | 0 → 11627 | - | 6 |
| new | `store/optimistic.ts:771-777` laneNodeOf | 0 → 11619 | - | 7 |
| new | `store/optimistic.ts:779-782` overlaid | 0 → 2114 | - | 4 |
| new | `store/optimistic.ts:787-787` shown | 0 → 844 | - | — |
| new | `store/optimistic.ts:787-787` (anonymous) | 0 → 844 | - | — |
| new | `store/optimistic.ts:792-799` optimisticHas | 0 → 84 | - | 7 |
| new | `store/optimistic.ts:823-870` optimisticView | 0 → 17630 | - | 40 |
| new | `store/optimistic.ts:833-833` ensure | 0 → 5558 | - | 1 |
| new | `store/optimistic.ts:895-916` createOptimisticStore | 0 → 417 | - | 15 |
| new | `store/optimistic.ts:911-914` (anonymous) | 0 → 2165 | - | 4 |
| new | `store/projection.ts:75-142` wrapDraft | 0 → 1735 | - | 22 |
| new | `store/projection.ts:100-107` read | 0 → 1735 | - | 8 |
| new | `store/projection.ts:109-114` get | 0 → 1735 | - | 4 |
| new | `store/projection.ts:110-110` (anonymous) | 0 → 1735 | - | 1 |
| new | `store/projection.ts:144-146` cloneState | 0 → 52 | - | 3 |
| new | `store/projection.ts:155-179` wakeFamily | 0 → 1486 | - | 6 |
| new | `store/projection.ts:166-178` (anonymous) | 0 → 18667 | - | 5 |
| new | `store/projection.ts:188-196` errorFamily | 0 → 27 | - | 3 |
| new | `store/projection.ts:189-194` (anonymous) | 0 → 224 | - | 3 |
| new | `store/projection.ts:191-193` (anonymous) | 0 → 350 | - | 3 |
| new | `store/projection.ts:201-212` settleFamily | 0 → 599 | - | 6 |
| new | `store/projection.ts:205-207` (anonymous) | 0 → 8345 | - | 3 |
| new | `store/projection.ts:230-239` forEachFamilyNode | 0 → 2060 | - | 10 |
| new | `store/projection.ts:246-375` runProjectionComputed | 0 → 1735 | - | 31 |
| new | `store/projection.ts:278-279` asking | 0 → 789 | - | 2 |
| new | `store/projection.ts:296-351` pass | 0 → 1735 | - | 5 |
| new | `store/projection.ts:299-349` (anonymous) | 0 → 1735 | - | 4 |
| new | `store/projection.ts:301-330` commit | 0 → 789 | - | 8 |
| new | `store/projection.ts:308-316` write | 0 → 789 | - | 8 |
| new | `store/projection.ts:312-312` (anonymous) | 0 → 789 | - | 1 |
| new | `store/projection.ts:331-345` (anonymous) | 0 → 27 | - | 5 |
| new | `store/projection.ts:379-433` createProjectionInternal | 0 → 417 | - | 27 |
| new | `store/projection.ts:403-403` fam.key | 0 → 4773 | - | — |
| new | `store/projection.ts:421-424` (anonymous) | 0 → 1735 | - | 3 |
| new | `store/reconcile.ts:45-87` reconcileState | 0 → 920 | - | 19 |
| new | `store/reconcile.ts:55-55` keyFn | 0 → 5319 | - | 1 |
| new | `store/reconcile.ts:92-288` applyAdopt | 0 → 2696 | - | 147 |
| new | `store/reconcile.ts:303-340` descend | 0 → 2765 | - | 30 |
| new | `store/store.ts:157-189` TargetShape | 0 → 7155 | - | 28 |
| new | `store/store.ts:191-203` createTarget | 0 → 7155 | - | 12 |
| new | `store/store.ts:205-224` wrap | 0 → 19400 | - | 13 |
| new | `store/store.ts:230-241` unwrapValue | 0 → 63425 | - | 8 |
| new | `store/store.ts:252-254` slotNodeEquals | 0 → 20742 | - | 2 |
| new | `store/store.ts:258-260` sameKey | 0 → 1323 | - | 2 |
| new | `store/store.ts:272-282` LaneView | 0 → 458 | - | 5 |
| new | `store/store.ts:287-289` asBacking | 0 → 2903 | - | 2 |
| new | `store/store.ts:294-296` containerEquals | 0 → 707 | - | 2 |
| new | `store/store.ts:298-302` sameLogicalSlot | 0 → 18667 | - | 5 |
| new | `store/store.ts:308-328` releaseSlot | 0 → 23436 | - | 16 |
| new | `store/store.ts:331-335` noteNode | 0 → 27205 | - | 5 |
| new | `store/store.ts:345-348` slotKept | 0 → 26041 | - | 3 |
| new | `store/store.ts:349-352` (anonymous) | 0 → 23956 | - | 3 |
| new | `store/store.ts:359-387` bornStaged | 0 → 3169 | - | 13 |
| new | `store/store.ts:389-431` getNode | 0 → 23859 | - | 24 |
| new | `store/store.ts:433-445` getHasNode | 0 → 7914 | - | 12 |
| new | `store/store.ts:450-467` getContainerNode | 0 → 3881 | - | 13 |
| new | `store/store.ts:479-494` stageOn | 0 → 6537 | - | 14 |
| new | `store/store.ts:498-501` deriveHolds | 0 → 6131 | - | 4 |
| branches | `store/store.ts:503-509` storePark | 5969 → 8673 | - | 3 |
| new | `store/store.ts:529-541` notifyContainer | 0 → 133 | - | 3 |
| new | `store/store.ts:579-584` isOwnAccessor | 0 → 42682 | - | 6 |
| new | `store/store.ts:588-623` cloneRaw | 0 → 12767 | - | 28 |
| new | `store/store.ts:634-639` copyOwn | 0 → 491 | - | 6 |
| new | `store/store.ts:642-657` scanAccessorsOnce | 0 → 5589 | - | 12 |
| new | `store/store.ts:667-670` plainProto | 0 → 7426 | - | 3 |
| new | `store/store.ts:706-738` ensurePB | 0 → 16146 | - | 21 |
| new | `store/store.ts:742-757` privatizeCommitted | 0 → 3262 | - | 14 |
| new | `store/store.ts:764-772` parentSlotKey | 0 → 4713 | - | 9 |
| new | `store/store.ts:809-844` adoptPB | 0 → 2863 | - | 27 |
| new | `store/store.ts:883-889` queueFold | 0 → 6537 | - | 7 |
| new | `store/store.ts:892-899` preBatch | 0 → 6431 | - | 8 |
| branches | `store/store.ts:906-936` drainFolds | 11519 → 16552 | - | 26 |
| new | `store/store.ts:941-944` GlobalQueue._slotFlight | 0 → 3412 | - | 3 |
| new | `store/store.ts:949-958` GlobalQueue._slotCovered | 0 → 1709 | - | 4 |
| new | `store/store.ts:973-981` runDirect | 0 → 249 | - | 8 |
| new | `store/store.ts:984-1049` foldTarget | 0 → 6029 | - | 46 |
| new | `store/store.ts:1135-1137` userWriting | 0 → 920 | - | 2 |
| new | `store/store.ts:1157-1309` notifyWrites | 0 → 12758 | - | 47 |
| new | `store/store.ts:1249-1249` (anonymous) | 0 → 6959 | - | 1 |
| new | `store/store.ts:1315-1319` targetsEqual | 0 → 4873 | - | 4 |
| new | `store/store.ts:1322-1330` arrayStructureChanged | 0 → 133 | - | 7 |
| new | `store/store.ts:1348-1352` leafSet | 0 → 3309 | - | 4 |
| new | `store/store.ts:1355-1388` notifyKeyDiff | 0 → 2593 | - | 16 |
| new | `store/store.ts:1390-1392` hasAccessorFlag | 0 → 2793 | - | 2 |
| new | `store/store.ts:1395-1409` notifyKeyValue | 0 → 1678 | - | 11 |
| new | `store/store.ts:1432-1452` notifyFoldTail | 0 → 2863 | - | 19 |
| new | `store/store.ts:1457-1468` notifyFold | 0 → 167 | - | 11 |
| new | `store/store.ts:1480-1485` scopeKey | 0 → 134374 | - | 6 |
| new | `store/store.ts:1486-1488` inDraft | 0 → 243955 | - | 3 |
| new | `store/store.ts:1498-1504` draftServe | 0 → 28748 | - | 7 |
| new | `store/store.ts:1510-1515` committed | 0 → 40711 | - | 4 |
| new | `store/store.ts:1522-1527` stagingReader | 0 → 4399 | - | 6 |
| new | `store/store.ts:1542-1643` readSource | 0 → 88056 | - | 45 |
| new | `store/store.ts:1642-1642` (anonymous) | 0 → 638 | - | 1 |
| new | `store/store.ts:1647-1652` heldKeyChanged | 0 → 2571 | - | 6 |
| new | `store/store.ts:1666-1674` sameRow | 0 → 2069 | - | 8 |
| new | `store/store.ts:1684-1712` adoptChild | 0 → 1131 | - | 16 |
| new | `store/store.ts:1715-1717` familyAhead | 0 → 158 | - | 3 |
| new | `store/store.ts:1731-1733` keyChanged | 0 → 669 | - | 3 |
| new | `store/store.ts:1735-1763` changedBetween | 0 → 3240 | - | 28 |
| new | `store/store.ts:1772-1789` nodeValue | 0 → 199938 | - | 10 |
| new | `store/store.ts:1793-1835` serveDataKey | 0 → 72181 | - | 30 |
| new | `store/store.ts:1839-1842` linkedTo | 0 → 5513 | - | 3 |
| new | `store/store.ts:1852-1929` pullFamily | 0 → 105622 | - | 23 |
| new | `store/store.ts:1898-1898` (anonymous) | 0 → 36614 | - | 1 |
| new | `store/store.ts:1939-1974` holdWithDerive | 0 → 1471 | - | 21 |
| new | `store/store.ts:2011-2013` optRead | 0 → 1001 | - | 3 |
| new | `store/store.ts:2025-2036` touch | 0 → 11130 | - | 12 |
| new | `store/store.ts:2088-2262` get | 0 → 308747 | - | 83 |
| new | `store/store.ts:2264-2293` has | 0 → 8456 | - | 15 |
| new | `store/store.ts:2342-2386` set | 0 → 8179 | - | 25 |
| new | `store/store.ts:2407-2433` deleteProperty | 0 → 167 | - | 15 |
| new | `store/store.ts:2437-2439` getPrototypeOf | 0 → 524 | - | 3 |
| new | `store/store.ts:2509-2574` storeSetter | 0 → 10074 | - | 31 |
| new | `store/store.ts:2576-2615` createStore | 0 → 751 | - | 11 |
| new | `store/store.ts:2613-2613` setter | 0 → 5385 | - | 1 |
| new | `store/target.ts:155-157` setLookup | 0 → 11753 | - | 2 |
| new | `store/target.ts:159-161` isOwned | 0 → 7934 | - | 2 |
| new | `store/target.ts:165-168` lookupTarget | 0 → 35933 | - | 3 |
| new | `store/target.ts:185-191` markDescendants | 0 → 27205 | - | 6 |
| new | `store/types.ts:156-169` isWrappable | 0 → 77907 | - | 13 |
| new | `store/types.ts:182-184` setWriteOverride | 0 → 3470 | - | 2 |
