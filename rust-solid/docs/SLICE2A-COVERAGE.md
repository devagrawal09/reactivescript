# Slice 2a: async memos on the slice-1 shape. Fuzz mode, baseline, Solid coverage delta

Reference: solid `2105ffb8`, rc.21, `packages/signals/src/` (read-only). The port is `crates/runtime/src/slice1/`. The method is the coverage-first method of [SLICE1-PARITY.md](SLICE1-PARITY.md). Artifacts and scripts are in [slice2a-fuzz/](slice2a-fuzz/).

**Port status.** This document is the pre-port baseline and coverage delta (port at `147d971`). The paths it maps are now ported (new `async.rs`, `verdict.rs`, `truth.rs`, `error.rs`, `signals.rs`, `boundaries.rs`; the `joinPassTx` and `linkLanes` panic sites are ported). `--slice2a` is now **991/1000** on seeds 1–1000 and **1984/2000** held out, with every other program invalid on the oracle. See [SLICE1.md](SLICE1.md) for the results, the correspondence table and the one remaining class (seed 629), and [slice2a-fuzz/port](slice2a-fuzz/port/) for the run summaries and the reduced case.

## Handoff summary

- **Mode.** `node fuzz/run.mjs --slice2a --seeds N [--start S] --out DIR`. It uses `fuzz/generate-slice2a.mjs` and the `slice1-driver`, with the same worker oracle and exact full-trace comparison.
- **Baseline (port at `147d971`).**
  - Seeds 1–1000: **0/1000**. 992 fail as `rust-panic`: the driver's `memo` arm asserts `flight` is null, at `slice1-driver.rs:89`. The other 8 are invalid on the oracle.
  - Held-out seeds 1001–3000: **0/2000**. 1984 fail as `rust-panic`; 16 are invalid.
  - The gate is unchanged: `--slice1` seeds 1–1000 are **1000/1000**. The summary is identical to `docs/slice1-fuzz/parity/summary-1-1000.json`.
- **Invalid programs.** There are 24 of 3000 (0.8%), all `oracle-nonscalar`. There are **no** oracle timeouts, oracle errors or reactivity halts. Solid itself produces each of these traces (see "Reference oddities"). They count as failures, never as agreement.
- **The delta the port must add.** 94 Solid functions run for the first time, and 40 already-run functions take new branches: **1276 new TS code lines** in total. Most of the new code is in `async.ts` (309 lines), `core.ts` (316), `verdict.ts` (196), `lanes.ts` (150), `scheduler.ts` (98) and `signals.ts` (95).
- **Cut sites in `slice1/` now reached:**
  - STATUS_PENDING and the whole flight engine (`handleAsync`, `asyncWrite`, `handleError`, the pending-source walks);
  - `blockedBy`/`ownFlights`, which now return true;
  - `joinPassTx`'s pass-scoped arm (`passTx`). This is a **panic site** in the port.
  - `linkLanes`/`_links`. This is a **panic site**, reached only by the `async-lanes` family.
  - staged errors (D-41, CONFIG_STAGED_ERROR);
  - `merge`'s body;
  - `heldTrim`;
  - truth readers (CONFIG_AUTHORITATIVE, via `refresh`);
  - the verdict functions `latest`/`isPending`/`verdictValue`, reached untracked only;
  - `holdFrame` (reached with no children);
  - `queueEffectRun`;
  - user-effect error handlers.
- **Cut sites still not reached:**
  - CONFIG_VERDICT and verdict lanes (`_verdict`): the op language has no tracked `latest`/`isPending`.
  - `guessFlights`/`inFlight` true: guesses sit on signals, which are never pending.
  - `take`/`kept`/`reverted`;
  - zombies and `parkChildren` bodies;
  - reawakening a dormant memo. The `prepareComputed` arm is entered twice, but only on a node that is not AUTO_DISPOSE, so the port's panic is not hit.
  - async iterators, stores and boundaries (the boundary hooks run but are inert).

## 1. The `--slice2a` fuzz mode

### Generator (`fuzz/generate-slice2a.mjs`)

The generator uses the same Mulberry32 RNG as `generate.mjs`/`generate-slice1.mjs`. A program is a pure function of its seed, which was checked over seeds 1–3000. It uses **only ops already in `fuzz/solid.mjs`** ([OP-LANGUAGE.md](OP-LANGUAGE.md)). Programs have 38–82 ops (median 59).

Every program has the slice-1 core:

- plain signal `s` and optimistic signal `o`;
- render effects;
- two-slice actions over flights (at most two open at once);
- outside writes, flushes, resolves and rejects.

On top of that, every program has:

- **Async memo `a`.** Its key is `s mod 3` (or `(s+o) mod 3`, so guesses feed the request), and it returns the promise `q:<key>`. Different values share a key, so requests **reuse the same promise**. Half of the `a` memos have a `loading` value.
- **Derived memo `m = top + o`** in half of the programs.
- **Probes.** Each node gets `read`/`latest`/`pending` probes at random points. `refresh` targets the async memos.
- **Settlement.** Memo flights are resolved or rejected at random, before or after the request that uses them. Settling twice is a no-op.
- **Shared flights.** One action in six yields on a memo flight by name (`q:<k>`), so the action and the memo wait on the same promise.
- **Feeding writes.** Action writes to `s`/`o` feed `a`, so the action transactions entangle with pending async work.
- **Tail.** Open action flights are resolved. Each memo key's flight is then resolved with probability 3/4. Finally a flush runs and every node is observed.

| family (seed mod 5) | extra |
| --- | --- |
| `async-actions` | Weighted toward actions and their settlement. |
| `async-refresh` | Weighted toward `refresh` + observe. |
| `async-chain` | A second async memo `b` (flight `r:<a mod 3>`) over `a`. |
| `async-reject` | Memo flights are always rejectable, at rate 1/2. Other families allow memo rejection in a third of programs, at rate 1/5. |
| `async-lanes` | A second optimistic signal `p`. Actions guess `o` or `p`, and the views read both. Two sibling lanes read by one computation are linked (`enterLane` → `linkLanes`). With a single optimistic signal, Solid never links lanes: 0 calls in the first 1000-seed draft without `p`. |

**Rejections and render effects.** In rc.21, an error that reaches a render effect with no boundary **halts reactivity** (`scheduler.ts` `haltReactivity`). The halt reports the cause through `reportError`, which is an uncaught exception in the oracle worker. A first draft that let render effects read rejectable memos was invalid or halted on ~29% of programs.

So a program that may reject a memo flight reads its async memos only from **user effects**. These are `watch` / `watch2`, created by `createEffect` with the oracle's logged `error` handler. Its render effect `view` reads only the signals. Programs with no memo rejection put the async memo in the render effect `view`.

### Harness changes (additive, behind `--slice2a`)

- **`fuzz/run.mjs`.** The `--slice2a` flag selects the generator, the `slice1-driver` and the family as the mode. It also passes `workerData: {strict: true}` to the oracle worker, and the reducer keeps the failure class as in `--slice1`. With no flag, or with `--slice1`, the code paths are unchanged.
- **`fuzz/worker.mjs`.** The strict mode applies only when `workerData.strict` is set, and it is fail-closed. Two kinds of program become invalid instead of producing a trace:
  - `oracle-halted`: Solid logged `[REACTIVITY_HALTED]` (`console.error` is observed, not suppressed).
  - `oracle-nonscalar`: an observed value falls outside what OP-LANGUAGE.md allows. Allowed values are an integer (or null for a missing previous value), a boolean for `pending`, `{error: string}` for a failed read, and string tags and ids. The `detail` names the first bad event.

  Why strict mode is needed:
  - Without it, a halt reported from a microtask races the result message. The same program then came back as `oracle-error` or as a "valid" trace on different runs (`halt3.json`, checked with 10 replays per mode).
  - The worker's structured clone and the comparator's `JSON.stringify` turn an `undefined` value or an Error-valued memo into `null`/`{}`. That would score an unrepresentable value as a comparable one.

  Nothing is filtered or normalized. The whole program is classed invalid. The `--slice1` gate rerun is byte-identical in summary.

### Validity, and what the traces contain

These figures are for seeds 1–1000. Each program ran in a fresh worker, the same way as `run.mjs`.

**Validity:** 992 valid; 8 invalid, all `oracle-nonscalar`; 0 timeouts, 0 errors, 0 halts.

**Per-family:** see `slice2a-fuzz/summary-1-1000.json`. Each family has 200 seeds.

**Event counts in the 992 valid traces:**

| event | count | programs |
| --- | ---: | ---: |
| `read` with a value | 8518 | |
| `read` → `{error:"pending"}` | 2699 | 596 |
| `read` → `{error:"memo-failed"}` | 368 | 130 |
| `read` → `{error:"action-failed"}` (an action rejected a shared memo flight) | 20 | 9 |
| `latest` with a value | 8573 | |
| `latest` → pending | 2637 | |
| `pending` → `true` | 706 | 357 |
| `pending` → `false` | 10902 | |
| effect `error` events | 384 | 145 |
| `action` errors | 262 | |
| `action` ok | 1710 | |

`latest` differs from the adjacent `read` 399 times:

- 317 times both are values (stale-while-revalidate);
- 65 times `read` is pending while `latest` has a value;
- 17 times one of them is an error.

**Op counts** (from `summary.json` `coverage`): 1703 memos, 1093 refreshes, 11693 `latest`, 11697 `pending`, 6313 resolves and 650 rejects.

### Reference oddities (Solid traces the op language cannot express)

All 24 invalid seeds are in [slice2a-fuzz/invalid-seeds.json](slice2a-fuzz/invalid-seeds.json):

- 1–1000: 225, 339, 427, 488, 663, 683, 704, 873.
- 1001–3000: 1360, 1438, 1637, 1693, 1778, 1950, 2037, 2215, 2253, 2443, 2558, 2582, 2583, 2667, 2762, 2972.

Every one has a memo rejection reaching user effects through an async memo. Not triaged (per instructions). Three shapes:

- **A user effect is applied with `undefined`.** For example, seed 225: `["effect","watch",undefined,null]` follows an error and an entangled action. The value is logged without a compute of `watch` before it, and its cleanup later logs `undefined`. Also seen as `latest m` → `undefined` (seeds 873, 2582).
- **An error object becomes a memo's value.** For example, seed 488: `read m` returns a `StatusError` object instead of throwing. Its readers then compute `"Error: memo-failed" + n` as a string (`compute watch "Error: memo-failed1"`). The rejection is an action's on a shared flight in seed 663, and a memo's in seed 488.
- Both shapes in one program.

These are not the parked lazy-refresh hang or the `deleteFromHeap` TypeError: no program here is lazy.

## 2. Baseline

| run | agree | invalid | failure classes |
| --- | ---: | ---: | --- |
| `--slice1` seeds 1–1000 (gate) | 1000/1000 | 0 | — |
| `--slice2a` seeds 1–1000 | 0/1000 | 8 | `rust-panic` 992, `oracle-nonscalar` 8 (first seed 225) |
| `--slice2a` seeds 1001–3000 | 0/2000 | 16 | `rust-panic` 1984, `oracle-nonscalar` 16 (first seed 1360) |

Every valid program panics at op 3, where the slice-1 driver meets `memo` with `flight` (`operation outside slice 1`). The reduced case for the panic class is two ops: a signal and an async memo. Summaries are in [slice2a-fuzz/](slice2a-fuzz/).

## 3. Coverage method

1. Use the same TS copy as SLICE1-PARITY.md: `out/solid-src`, which equals `solid-next/packages/signals/src` except for the three `fixctor` constructor rewrites. Run it with the same `register.mjs`/`hooks.mjs` and prod flags.
2. **Equivalence.** For seeds 1–1000, three traces agree on all 992 valid programs:
   - `slice2a-fuzz/tools/eq.mjs` in one process against `dist/prod`;
   - the same through the TS copy;
   - `slice2a-fuzz/tools/workers.mjs`, a fresh strict worker per program as in `run.mjs`.

   They differ only on two invalid seeds (488, 663), and only in the text of the error from serializing an Error object (mangled property names in dist). The `--slice1` traces are byte-identical across dist, TS and the recorded `out/cov/dist.txt`.
3. **Whole-run delta.**
   - Collect `NODE_V8_COVERAGE` for `--slice1` 1–1000 and for `--slice2a` 1–1000.
   - `tools/delta.mjs` lists, per innermost executed function, its call counts in each run and the TS code lines (comment-only lines skipped) that run in slice2a but never in slice1.
   - Output: [slice2a-fuzz/coverage-delta.txt](slice2a-fuzz/coverage-delta.txt). The coverage covers all 1000 programs, including the 8 invalid ones.
4. **Per-operation attribution.**
   - `tools/perop.mjs` runs the programs under the inspector's precise coverage. It takes, and resets, the counts at every op boundary through `run()`'s progress callback.
   - So each op's calls include the microtasks its own drain runs. A refresh's waiter is created at the next drain, which is the following `resolve`/`reject`.
   - Ops are classed by kind and target: `memo:async`, `read:async-chain`, `resolve:memo-flight`, `resolve:memo+action-flight`, and so on.
   - `tools/perop-report.mjs` marks:
     - `NEW`: a function never called anywhere in slice1;
     - `+`: a function never called by a slice1 op of the same kind.
   - Output: [slice2a-fuzz/perop-report.txt](slice2a-fuzz/perop-report.txt). The numbers are calls per op. Per-op totals equal the whole-run counts, apart from root creation before the first op and module init.

Reproduce from the repository root with Node 24:

```sh
P=docs/slice1-fuzz/parity/tools; T=docs/slice2a-fuzz/tools; SRC=file://$PWD/out/solid-src/index.ts
node fuzz/run.mjs --slice1 --seeds 1000 --out out/s2a/gate-slice1-1000
node fuzz/run.mjs --slice2a --seeds 1000 --out out/s2a/run-1000
node fuzz/run.mjs --slice2a --start 1001 --seeds 2000 --no-reduce --out out/s2a/run-heldout
node $T/eq.mjs slice2a 1 1000 out/s2a/cov/dist-2a.txt; node $T/workers.mjs slice2a 1 1000 out/s2a/cov/workers-2a.txt
NODE_V8_COVERAGE=$PWD/out/s2a/cov/ts-2a SOLID_SIGNALS_URL=$SRC node --import ./$P/register.mjs $T/eq.mjs slice2a 1 1000 out/s2a/cov/src-2a.txt
NODE_V8_COVERAGE=$PWD/out/s2a/cov/ts-1  SOLID_SIGNALS_URL=$SRC node --import ./$P/register.mjs $T/eq.mjs slice1 1 1000 out/s2a/cov/src-1.txt
node $T/delta.mjs out/s2a/cov/ts-1 out/s2a/cov/ts-2a [--lines]
SOLID_SIGNALS_URL=$SRC node --import ./$P/register.mjs $T/perop.mjs slice2a 1 1000 out/s2a/cov/perop-2a.json   # and slice1 → perop-1.json
node $T/perop-report.mjs out/s2a/cov/perop-1.json out/s2a/cov/perop-2a.json [--all]
```

## 4. Delta counts

| file | functions with new lines | never called in slice1 | new code lines |
| --- | ---: | ---: | ---: |
| core/async.ts | 30 | 30 | 309 |
| core/core.ts | 18 | 10 | 316 |
| core/verdict.ts | 11 | 11 | 196 |
| core/lanes.ts | 21 | 6 | 150 |
| core/scheduler.ts | 15 | 8 | 98 |
| signals.ts | 14 | 14 | 95 |
| core/heap.ts | 5 | 2 | 29 |
| core/error.ts | 3 | 3 | 19 |
| core/effect.ts | 3 | 0 | 17 |
| core/truth.ts | 3 | 3 | 15 |
| boundaries.ts | 4 | 2 | 14 |
| core/owner.ts | 2 | 1 | 13 |
| core/graph.ts | 3 | 2 | 5 |
| affects-marks.ts, deferred.ts | 2 | 2 | 0 (one-line hooks) |
| **total** | **134** | **94** | **1276** |

The full per-function list, with call counts, the new line ranges and the matching Rust comment, is in the appendix.

## 5. Call map per new operation

Order is Solid's call order inside the op. File:line ranges are rc.21 TS lines. "→" is a call, and indentation is nesting. Counts are calls over seeds 1–1000. Only what is new relative to slice 1 is spelled out. The slice-1 parts (flush, settle, lanes, actions) are in SLICE1-PARITY.md.

### `memo` with `flight` (async memo creation)

`createMemo` signals.ts:519 → `computed` core.ts:1144 builds the node literal:

- `_statusFlags = STATUS_UNINITIALIZED`;
- `_loading = false`;
- `_value = undefined`;
- CONFIG_AUTO_DISPOSE unless owned.

→ `setupComputedNode` core.ts:1590 → `linkChild` → `recompute(el, true)` core.ts:364.

The body (solid.mjs) reads `s` (and `o`), logs `compute` and `flight`, and returns the promise. Then `recompute` core.ts:637 → `handleAsync(el, promise)` async.ts:458 (5769 calls):

1. `untrack` core.ts:1848 → `isThenable` async.ts:409.
2. Set `_x._inFlight = promise` (515) and `_x._q = question || MAINLINE_QUESTION` (523). Clear `_x._pendingSources` (530). With the verdict engine (`holdWorkHook`), set CONFIG_ASYNC (520).
3. `promise.then(v => asyncWrite(v), e => handleError(e))` (855-893).
4. Not settled synchronously: return `_value` if `_loading` (922). Otherwise throw `new NotReadyError(context)` (923; error.ts:36), whose `source` is the node itself.

`recompute`'s catch (654-705), when the node is not loading:

1. `ext(el)._blocked = true` (673).
2. `notifyStatus(el, STATUS_PENDING, e)` async.ts:980:
   - `addPendingSource(el, el)` (995);
   - `_statusFlags = PENDING | UNINITIALIZED` (1000-1008);
   - `setPendingError(el, el, e)` (1011; `_x._error`);
   - no status notifier for a memo, so `propagateStatus` async.ts:1043 → `forEachDependent` (no subscribers yet).
3. At the end (1060-1069): CONFIG_STAGED → `queuePendingNode` (the pending node waits for the commit sweep).

**With `loading`:** the literal has `_statusFlags = 0`, `_loading = true` and `_value = loadingValue`. `handleAsync` returns `_value`. Then `clearStatus` (653), `isSame`, `trimStaleDeps`: no pending status and no NotReadyError. The value is the loading value until the flight lands. A pass of a loading node whose sync dependency is unready calls `parkLoadingWindow` async.ts:114 (55 calls). That registers a pending source with no read-visible status.

**`b` over `a` (async-chain):** `b`'s body `read(a)` → `prepareComputed` core.ts:1909 → `pullComputed` core.ts:2028. Then one of two outcomes:

- `a` is pending and uninitialized: `read` throws `a._x._error` (2396/2400). `b`'s catch → `notifyStatus(b, PENDING, NotReadyError(source=a))` → `addPendingSource(b, a)`.
- `a` is settled: `b` requests `r:<k>` → `handleAsync`.

**Plain memo `m` over a pending source:** the same catch path, with source `a`.

### `effect` over a pending async memo (render and user)

`effect` effect.ts:70 → `recompute(node, true)` → `read(a)` throws → `notifyStatus(node, PENDING)` → status notifier `notifyEffectStatus` effect.ts:123.

**Render effect:** `globalQueue.notify(node, PENDING|ERROR, flags)` scheduler.ts:1199 → `catchHook` (boundaries `catchStatus`; no boundary, so false) → if PENDING and `passLane === null`: **`joinFuture(null)`** (1220). This makes a new transaction (`newTransaction(false)`) the flush's transaction. The render effect's first run is held until the async lands. No first `effect` log at creation.

**User effect:** `createEffect` signals.ts:594 → `effect(..., {user: true})` → the first run is queued (effect.ts:100 `globalQueue.enqueue`). On STATUS_ERROR, `notifyEffectStatus` → `queueEffectRun` scheduler.ts:1468 (`_modified = true`, enqueue) (127-137). `runEffect`'s error arm effect.ts:212-230 → `_errorFn(unwrapStatusError(err))` → oracle `['error', id, message]`. This arm is reached 393 times.

### `read` (untracked) of an async or derived memo

`read` core.ts:2106 → `prepareComputed(owner, false)` (42309 calls over all reads). Then, by the node's state:

- **Pending and uninitialized:** `throw owner._x._error` (2398-2400) → `{error:"pending"}`.
- **Errored:** `throw owner._x._error` (2420-2422; a `StatusError` whose message is the cause's) → `{error:"memo-failed"}`. A staged error (CONFIG_STAGED_ERROR) is first served by `serve`.
- **Settled:** the committed `_value`, or through `serve`/`readerSeesCommitted` when a staging is unflushed. A loading node serves its loading value.

`throwShown` core.ts:2452 is the D-39 shown error (`_x._shownError`) kept while a recovery is staged.

### `latest` (untracked)

`latest` verdict.ts:338:

1. `markVerdictReader(2)`. With no creator pass, so no CONFIG_VERDICT.
2. Set `latestActive = true` and `setVerdict(verdictValue)` (core.ts:1735).
3. Call `fn()`, which reaches `read`: with `verdict !== null`, `return verdict(el, c)` (core.ts:2126-2137).
4. **`verdictValue`** verdict.ts:450-700 (23390 calls with `isPending`) picks the value shown ahead of the screen:
   - a staged value: `staged` 414, `heldLatest` 421 → `unflushedValue` core.ts:1984;
   - a lane's display: `display` lanes.ts:128;
   - or the committed one.

   A pending node with no value throws NotReadyError (`{error:"pending"}`). An errored node throws its error.
5. Restore `latestActive` and `verdict`.

This applies to signals too: 16 functions per `latest:signal`.

### `pending` (isPending, untracked)

`isPending` verdict.ts:384:

1. `markVerdictReader(1)`.
2. Set `probing = true` and `probeFound = false`, then `setVerdict(verdictValue)`.
3. Call `fn()` → `read` → `verdictValue`. A pending node reaches `pendingVerdict` 277, which sets `probeFound`. It stays unset when every pending source is a quiet re-ask: `quietPending` 240, `heldNotFinal` 264.
4. A NotReadyError at top level is caught (context null) and `probeFound` is returned.

`GlobalQueue._marked` (affects-marks.ts:99) is consulted on every call.

### `refresh`

`refresh` signals.ts:923 → `markRefresh` core.ts:2915:

- `_flags |= REACTIVE_DIRTY`, plus REACTIVE_REASK when the node is not already dirty or queued;
- `insertIntoHeap(node, dirtyQueue)`;
- `schedule()`.

Then `own = flushTransaction`, and a `queueMicrotask`. The returned promise is `.catch`ed.

At the next drain: `createRoot(make)` → `watch` signals.ts:800 with CONFIG_FRESH_READ | CONFIG_AUTHORITATIVE:

1. Install the truth readers: `GlobalQueue._truth = truthRead`, `_confirmed = truthConfirmed` (truth.ts:36-58).
2. Create the waiter `computed(...)`, with CONFIG_REDERIVE.
3. The waiter body runs `read(node)`. FRESH_READ → `pullComputed` → `updateIfNecessary` core.ts:1092. If the node is still dirty, this **recomputes it now** (re-ask: `reask` core.ts:555, `_x._reask`; same key → same promise → `handleAsync`).
4. The body ends one of two ways:
   - It parks on NotReadyError; `propagateStatus` re-runs it (CONFIG_REDERIVE → `enqueueSub`).
   - It delivers through `queueMicrotask(onValue)` → `dispose(waiter)` owner.ts:55 → `unobserved` graph.ts:98. A rejection goes through `onError` (845, 64 calls).

If the waiter's pass read a joined future that is not its own, it becomes `staleReader` (838-843). The re-ask's `compute`/`flight` logs appear at whichever comes first: the next flush, or the waiter's pull.

### `resolve` of a memo flight

The promise reaction async.ts:856 → `asyncWrite(v)` 595 (4625 calls). It returns early if `_x._inFlight !== result`, which is a superseded request: 1790 of 4625. The rest (2835):

1. `landStatus` 970: drop self from `_pendingSources`, then `clearStatus` or `setPendingError(next source)`.
2. **`setSignal(el, () => value)`** core.ts:2693, the plain write path. It commits, or stages into the hold when the node is held.
3. If not staged: `_loading = false` and `trimStaleDeps`.
4. **`settlePendingSource(el)`** 273 → `walkDependents` 149 over subscribers. For each dependent:
   - `removePendingSource(dep, el)`;
   - if other sources remain: `setPendingError(dep, next)`;
   - otherwise clear STATUS_PENDING, `setPendingError(dep)`, `joinFuture(txOf(dep))` if held, and `enqueueSub` + `schedule` if `_blocked`;
   - `stageMark` verdict.ts:766 (6302 calls).

   A CONFIG_VERDICT dependent would be `enqueueSub`'d instead; none exists here.
5. `schedule()`, then **`flush()`** unless an unflushed write is carried (`carried`, 612).
6. `settleAutodispose` 692.

The drain then runs the refresh waiters' microtasks and the harness's `S.flush()`. This op class reaches about 200 Solid functions. The 105 not called by slice1's resolves include the waiter machinery (`createRoot`/`createOwner`/`watch`/`dispose`) and `updateIfNecessary`/`pullComputed`.

### `reject` of a memo flight

Reaction 884 → `handleError(e)` 539 (469 calls; 350 past the `_inFlight` check):

1. Not a NotReadyError → **`stageError(el, e)`** 225. When the node is CONFIG_HELD, or the pass read a staging during a running flush and no lane is set, the error is staged: `_pendingValue = StatusError`, CONFIG_STAGED | CONFIG_STAGED_ERROR, `settlePendingSource`, `schedule`. This happens 37 times out of 382 calls.
2. Otherwise **`notifyStatus(el, STATUS_ERROR, StatusError(el, e))`** async.ts:980 sets STATUS_ERROR (and STATUS_NO_VALUE if uninitialized). Then `propagateStatus` 1043 runs per subscriber:
   - CONFIG_REDERIVE (refresh waiters), or a stale link while pending: `enqueueSub`;
   - otherwise `queuePendingNode(sub)` (or `laneStageHook` in a lane pass), then recursively `notifyStatus(sub, ...)`. Effects reach `notifyEffectStatus` → `queueEffectRun` (user effects; 505 calls).
3. `disposeChildren(el, false, true)`, `releaseSettledDependents` 194, `settleAutodispose`.

On a later commit, `commitPendingNode` scheduler.ts:1522-1526 publishes a staged error through `notifyStatus(c, STATUS_ERROR, e)`. A later recovery that does not change the value runs `settleErroredDependents` 258.

### `action` whose writes feed an async memo / `resolve` of an action flight

The action's own path is slice 1's. What changes is in the flushes it causes:

- **The async memo becomes lane or transaction work.** `recompute` of a CONFIG_HELD node takes the held arm 472-509: `joinPassTx(tx, freshHook(...))` scheduler.ts:397. Outside a flush with no `flushTransaction`, it opens or merges the pass-scoped **`passTx`** (399-401; 370 of 5062 calls). In a lane pass, `laneStage` lanes.ts:408 lists the pending node (442-489), including the `errored` leaf arm 478-489.
- **Transactions entangle.** `joinFuture` → `merge` body scheduler.ts:439-448 (833 calls; 0 in slice1) when a held pending node is reached from another transaction (`propagateStatus` 1103-1110, 1130-1135).
- **Pending blocks the landing.** `blocked` → **`blockedBy`** scheduler.ts:516-568 now finds STATUS_PENDING nodes, which `ownSource` 507 checks for the owner. It returns true for:
  - a pending render effect that is `onScreen` (577): 1936 times;
  - a pending/REDERIVE/frame reader on screen: 917 times.

  `ownFlights` uses the same function with `own = true`.
- **At the seam.** `settle` skips uninitialized non-render pending nodes when it parks (1019-1024) and trims deps from `heldTrims` (1083-1086). `commitPendingNode` (1505-1538):
  - an in-flight node gets CONFIG_INPUTS_PUBLISHED instead of a full commit;
  - otherwise `applyStaged` clears STATUS_UNINITIALIZED and `_x._reask`, and runs `queueEffectRun` for effects.
- **Lanes.** `laneDirty` 1452-1460 re-seats a held pending reader into the lane. `laneRead`, `dissolveLane`, `laneWrite` (lanes.ts:969, 256 calls) and `adoptParked` (1223, 393 calls) take their pending/error arms; see the appendix for line ranges.
- **Linked lanes (`async-lanes`).** `enterLane` 333-336 → `under` 343 → **`linkLanes`** 348-360 (36 calls). Then `linkBlocked` 368-371 and `unlink` 377-379 see a real `_links` group.

## 6. `slice1/` cut sites: reached or not

| cut site in `crates/runtime/src/slice1/` | Solid | slice2a | calls / evidence |
| --- | --- | --- | --- |
| STATUS_PENDING, `handleAsync`, flights (`core.rs` header, `graph.rs:33`, `owner.rs:69`) | async.ts:458-934, 980-1143 | **reached** | handleAsync 5769, notifyStatus 10894, propagateStatus 7364 |
| pending-source walks (`settlePendingSource`, `addPendingSource`, `retryReaches`) | async.ts:69-406 | **reached** | settlePendingSource 2948, retryReaches 21 |
| `blocked_by` constant false (`scheduler.rs:122-127`) | scheduler.ts:516-568 | **reached, returns true** | 2853 true returns; `ownSource` 492 |
| `join_pass_tx` panic, pass-scoped `passTx` (`core.rs:328`) | scheduler.ts:399-401 | **reached: port panics** | 370 |
| `enter_lane` linked-lanes panic (`lanes.rs:146`) | lanes.ts:333-336, 348-360 | **reached: port panics** (`async-lanes` only) | linkLanes 36 |
| `_links` constant null (`scheduler.rs:430`, `lanes.rs` header) | lanes.ts:365-380 | **reached** | linkBlocked/unlink bodies |
| staged errors D-41 (`core.rs` header; `replaced` = CONFIG_STAGED_ERROR) | async.ts:225-256; core.ts:527-530; scheduler.ts:1522-1526 | **reached** | stageError stages 37; commit publishes 18 |
| `merge` body (ported, never run in slice1) | scheduler.ts:439-448 | **reached** | 833 |
| `held_trim` (ported, never run) | scheduler.ts:599-601; settle 1083-1086 | **reached** | 1884 |
| truth readers, CONFIG_AUTHORITATIVE (`lanes.rs` header) | truth.ts:36-58; signals.ts:800-851 | **reached** (refresh waiters) | truth 866, truthRead 408 |
| verdict functions, `verdict` is false (`core.rs:333`, `read_node`) | verdict.ts:338-700; core.ts:2126-2137 | **reached, untracked only** | latest 11693, isPending 11697, verdictValue 23390 |
| CONFIG_VERDICT readers (`scheduler.rs:316`, `:404`, `core.rs:57`) | verdict.ts:315-332; scheduler.ts:1462 | **not reached** | Set sites have 0 hits. The tests are reached but always false. |
| verdict lanes `_verdict`, `isVerdict` (`lanes.rs` header, `core.rs:38`) | lanes.ts:287-318 | **not reached** | `isVerdict` always false |
| `ahead`/`entered` | lanes.ts:298, 808, 1098, 1210 | **not reached** (loops run empty) | — |
| `holdFrame` children (`scheduler.rs` header) | scheduler.ts:644-653 | **called, never iterates** | 4607 calls, body 0 |
| `guess_flights`/`inFlight` constant false (`lanes.rs:84`, `:362`) | lanes.ts:213-218, 826-832 | **called, always false** | Guesses are on signals. |
| `take`/`kept`/`reverted` panic (`lanes.rs:204`) | lanes.ts:174-184, 462-465 | **not reached** | — |
| reawaken a dormant memo panic (`core.rs:420`) | core.ts:1920-1935 | **not reached** | the REACTIVE_DISPOSED arm (1914-1920) is entered twice; the AUTO_DISPOSE arm 0 times |
| zombies / `parkChildren` (`owner.rs` header) | owner.ts parkChildren | **not reached** | — |
| `notify` no-op (`core.rs:99`) | scheduler.ts:1199-1225 | **reached** | PENDING → `joinFuture(null)` 1321 |
| user-effect error handler (`effect.rs`; errors are simplified) | effect.ts:123-147, 212-230; scheduler.ts:1468 | **reached** | queueEffectRun 505, errorFn 393 |
| owner disposal (`dispose`, unlink from parent chain) | owner.ts:55-64, 176-191 | **reached** (refresh waiters) | 1117 / 1004 |
| boundary hooks (`freshHook`, `armedOver`, `catchStatus`, `hiddenBy`) | boundaries.ts:251-334, 1080-1084 | **reached, inert** (no boundary) | loops never iterate |
| async iterators, stores, snapshots, dev tiers | async.ts:710-824 etc. | **not reached** | — |

`signals.ts:519` `createMemo` and `signals.ts:594` `createEffect` are already wrapped in `mod.rs`/`effect.rs`. Several core functions are already ported but were unexercised by `--slice1`: `computed`, `updateIfNecessary`, `pullComputed`, `prepareComputed`, `unflushedValue`, `display`, `laneWrite`, `heldTrim`, `queueEffectRun`, `markHeap`/`markNode`. The appendix's Rust column shows them; it is "-" for functions with no counterpart.

## 7. What the generator does not reach (gaps to close later)

- **Tracked `latest`/`isPending`.** These are verdict readers: CONFIG_VERDICT, verdict lanes, `ahead`/`entered`, `holdWork`. They need an expression form of `latest`/`pending` inside a computation, which the op language lacks. It would be an additive op in `solid.mjs`.
- **A guess whose own truth is in flight** (`guessFlights`). This needs `createOptimistic(fn)` over an async source.
- **`take`.** It needs an optimistic node one action guesses while another action's lane rewrites it.
- **Lazy async memos and dormant reawakening.** These are excluded: the parked lazy-refresh oracle hang and the `deleteFromHeap` TypeError.
- **Boundaries, stores, iterators.**

## Appendix: functions with new coverage

Columns:

- **kind:** `new` means never called in slice1; `branches` means called, with new lines.
- **Solid function:** file:lines and name.
- **calls slice1 → slice2a:** seeds 1–1000 each.
- **Rust comment citing it:** a `// Solid:` reference within ±3 lines of the start, or `-`. This is a heuristic match; a hit can be a panic or a stub, as at `lanes.rs:146`.
- **new code lines.**

| kind | Solid function | calls slice1 → slice2a | Rust comment citing it | new code lines |
| --- | --- | --- | --- | --- |
| new | `affects-marks.ts:99-99` GlobalQueue._marked | 0 → 11697 | - | — |
| branches | `boundaries.ts:251-299` catchStatus | 8866 → 6884 | - | 284,298 |
| new | `boundaries.ts:303-306` armedOver | 0 → 3121 | - | 303-304,306 |
| branches | `boundaries.ts:310-334` hiddenBy | 6391 → 8785 | - | 328-331 |
| new | `boundaries.ts:1080-1084` (anonymous) | 0 → 4366 | - | 1080-1084 |
| new | `core/async.ts:69-73` addPendingSource | 0 → 9527 | - | 70-73 |
| new | `core/async.ts:75-80` removePendingSource | 0 → 9571 | - | 76-80 |
| new | `core/async.ts:88-92` clearPendingSources | 0 → 2958 | - | 88,91-92 |
| new | `core/async.ts:99-105` retryReaches | 0 → 21 | - | 100-105 |
| new | `core/async.ts:114-122` parkLoadingWindow | 0 → 55 | - | 115-116,121-122 |
| new | `core/async.ts:124-136` setPendingError | 0 → 14709 | - | 125-128,131-136 |
| new | `core/async.ts:138-143` forEachDependent | 0 → 15089 | - | 139-143 |
| new | `core/async.ts:149-162` walkDependents | 0 → 3386 | - | 149-153,161-162 |
| new | `core/async.ts:154-160` visit | 0 → 7427 | - | 154-160 |
| new | `core/async.ts:194-200` releaseSettledDependents | 0 → 350 | - | 195,199-200 |
| new | `core/async.ts:196-198` (anonymous) | 0 → 819 | - | 196-198 |
| new | `core/async.ts:225-256` stageError | 0 → 382 | - | 234-241,244-249,253-256 |
| new | `core/async.ts:258-267` settleErroredDependents | 0 → 88 | - | 259,266-267 |
| new | `core/async.ts:260-265` (anonymous) | 0 → 161 | - | 260-265 |
| new | `core/async.ts:273-406` settlePendingSource | 0 → 2948 | - | 290,330-332,403,405-406 |
| new | `core/async.ts:333-397` (anonymous) | 0 → 6447 | - | 333-334,338,345-347,354-360,366-371,377-381,386-387,391,395-397 |
| new | `core/async.ts:458-934` handleAsync | 0 → 5769 | - | 459-461,466-470,475,477,493,515,520,523,530,536-537,710,829,850-855,893-895,907-908,915,917,919-920,922-924,934 |
| new | `core/async.ts:471-474` (anonymous) | 0 → 5769 | - | 471-474 |
| new | `core/async.ts:539-593` handleError | 0 → 469 | - | 539-540,542,544,553,562,575-576,581-582,586-587,591-593 |
| new | `core/async.ts:595-683` asyncWrite | 0 → 4625 | - | 595-596,599,608,613-614,618-619,657-658,664-665,669-672,681-683 |
| new | `core/async.ts:612-612` (anonymous) | 0 → 294 | - | 612 |
| new | `core/async.ts:652-652` (anonymous) | 0 → 2835 | - | 652 |
| new | `core/async.ts:692-698` settleAutodispose | 0 → 5094 | - | 692-693,697-698 |
| new | `core/async.ts:836-848` flattenIfIterable | 0 → 2835 | - | 836-838,843,848 |
| new | `core/async.ts:856-883` then.syncError | 0 → 4625 | - | 856-857,870-875,877-878,881-883 |
| new | `core/async.ts:884-892` (anonymous) | 0 → 469 | - | 884-885,889-892 |
| new | `core/async.ts:970-978` landStatus | 0 → 2835 | - | 970-971,973-978 |
| new | `core/async.ts:980-1036` notifyStatus | 0 → 10894 | - | 982-987,989,992,994-996,1000-1008,1011-1012,1025,1030-1036 |
| new | `core/async.ts:1043-1143` propagateStatus | 0 → 7364 | - | 1044,1143 |
| new | `core/async.ts:1045-1142` (anonymous) | 0 → 7138 | - | 1045-1046,1075-1081,1091-1095,1103-1116,1122-1124,1130-1137,1140-1142 |
| branches | `core/core.ts:364-1090` recompute | 10688 → 21014 | core.rs:17 | 444-445,447,473,484-493,505-509,520-524,528-530,557-561,592,594,655,659-660,668-669,672-674,677-678,695-706,829,831,866-867,929-930,935,951,955,959-960,965,973-976,984-985,993,996-997,999,1020-1022,1041-1043,1064,1066,1068-1069,1077-1079 |
| new | `core/core.ts:1092-1137` updateIfNecessary | 0 → 3408 | core.rs:259 | 1092,1099-1106,1109-1110,1112-1114,1124-1137 |
| new | `core/core.ts:1144-1253` computed | 0 → 2796 | mod.rs:99 | 1145-1148,1152,1161,1208-1236,1238-1242,1246-1248,1250-1253 |
| branches | `core/core.ts:1292-1308` joinPass | 5444 → 6721 | core.rs:308 | 1304-1307 |
| branches | `core/core.ts:1342-1399` frameRead | 7386 → 8712 | core.rs:331 | 1369 |
| branches | `core/core.ts:1406-1412` bornInto | 1942 → 2313 | core.rs:353 | 1409-1410 |
| new | `core/core.ts:1416-1420` creatorPass | 0 → 23548 | core.rs:361 | 1417-1420 |
| new | `core/core.ts:1735-1737` setVerdict | 0 → 93560 | - | 1736-1737 |
| new | `core/core.ts:1848-1874` untrack | 0 → 5769 | - | 1849-1854,1862-1867,1873-1874 |
| new | `core/core.ts:1909-1939` prepareComputed | 0 → 42309 | core.rs:412 | 1910,1920,1936,1939 |
| branches | `core/core.ts:1957-1964` readerSeesCommitted | 1821 → 10820 | - | 1962-1963 |
| new | `core/core.ts:1984-1992` unflushedValue | 0 → 480 | core.rs:424 | 1985-1986,1990,1992 |
| new | `core/core.ts:2028-2044` pullComputed | 0 → 10806 | core.rs:456 | 2029-2033,2040-2041,2043-2044 |
| new | `core/core.ts:2090-2104` servesStaged | 0 → 3441 | - | 2090-2104 |
| branches | `core/core.ts:2106-2447` read | 39376 → 69478 | core.rs:469 | 2128,2136-2137,2214,2243-2246,2251,2253-2261,2281-2282,2284-2286,2340-2342,2349,2351-2356,2363-2364,2383,2387-2390,2394-2398,2400-2402,2409-2413,2420-2423,2433 |
| branches | `core/core.ts:2452-2457` throwShown | 1821 → 5021 | - | 2454-2456 |
| branches | `core/core.ts:2469-2523` serve | 1821 → 10886 | core.rs:543 | 2477,2479,2484-2485,2495-2496,2509-2510,2515,2517-2522 |
| new | `core/core.ts:2915-2952` markRefresh | 0 → 1093 | - | 2916-2917,2922,2935,2942-2945,2948-2952 |
| branches | `core/effect.ts:70-121` effect | 1000 → 2135 | effect.rs:16 | 100 |
| branches | `core/effect.ts:123-174` notifyEffectStatus | 8866 → 10040 | - | 127-128,135-137,146-147 |
| branches | `core/effect.ts:186-286` runEffect | 10688 → 9944 | effect.rs:34 | 213-218,224,230-231 |
| new | `core/error.ts:36-48` NotReadyError | 0 → 4467 | - | 36,42-48 |
| new | `core/error.ts:53-62` StatusError | 0 → 351 | - | 53,55-62 |
| new | `core/error.ts:66-68` unwrapStatusError | 0 → 457 | - | 67-68 |
| branches | `core/graph.ts:25-60` unlinkSubs | 2000 → 7578 | graph.rs:15 | 53 |
| new | `core/graph.ts:96-96` deferReleases | 0 → 11522 | graph.rs:75 | — |
| new | `core/graph.ts:98-102` unobserved | 0 → 1117 | graph.rs:75 | 99-102 |
| branches | `core/heap.ts:37-53` actualInsertIntoHeap | 9688 → 16045 | heap.rs:13 | 46-51 |
| branches | `core/heap.ts:54-77` insertIntoHeap | 9688 → 18758 | heap.rs:45 | 61-62 |
| branches | `core/heap.ts:86-102` deleteFromHeap | 10688 → 21038 | heap.rs:75 | 92-99 |
| new | `core/heap.ts:104-112` markHeap | 0 → 428 | heap.rs:101 | 105-108,111-112 |
| new | `core/heap.ts:114-121` markNode | 0 → 613 | heap.rs:118 | 115-121 |
| new | `core/lanes.ts:128-135` display | 0 → 725 | lanes.rs:34 | 129-135 |
| branches | `core/lanes.ts:147-152` guessedValueOf | 3000 → 1804 | mod.rs:363 | 150 |
| branches | `core/lanes.ts:154-158` pendingGuessOf | 3000 → 1804 | lanes.rs:58 | 156 |
| branches | `core/lanes.ts:220-273` applyGuesses | 2623 → 1501 | lanes.rs:84 | 234-235,239-241 |
| branches | `core/lanes.ts:283-337` enterLane | 4981 → 5138 | lanes.rs:131 | 333-336 |
| new | `core/lanes.ts:343-346` under | 0 → 72 | lanes.rs:152 | 343-346 |
| new | `core/lanes.ts:348-360` linkLanes | 0 → 36 | lanes.rs:146 | 348-360 |
| branches | `core/lanes.ts:365-373` linkBlocked | 3487 → 3426 | - | 368-371 |
| branches | `core/lanes.ts:374-380` unlink | 2623 → 932 | - | 377-379 |
| branches | `core/lanes.ts:408-492` laneStage | 4981 → 5142 | lanes.rs:167 | 443-447,459-461,464,466-467,479-489 |
| branches | `core/lanes.ts:510-542` supersede | 2623 → 938 | lanes.rs:215 | 537,539-540 |
| branches | `core/lanes.ts:554-695` dissolveLane | 2623 → 932 | lanes.rs:236 | 592,613-629,636-642,652-656,666-671,676,678-679,694 |
| branches | `core/lanes.ts:716-814` laneRead | 7604 → 6399 | lanes.rs:317 | 732-734,781-782,796-799,801-805 |
| branches | `core/lanes.ts:872-902` laneSeam | 3887 → 4440 | lanes.rs:400 | 892-894 |
| branches | `core/lanes.ts:906-938` endLanes | 3000 → 1627 | lanes.rs:432 | 933-937 |
| branches | `core/lanes.ts:954-962` nestedBlocked | 7526 → 5495 | lanes.rs:454 | 959 |
| new | `core/lanes.ts:969-1000` laneWrite | 0 → 256 | lanes.rs:473 | 969,972,991-1000 |
| new | `core/lanes.ts:1078-1081` readsHeld | 0 → 1 | - | 1078-1079,1081 |
| branches | `core/lanes.ts:1082-1215` laneSeams | 10010 → 11519 | lanes.rs:544 | 1179 |
| new | `core/lanes.ts:1223-1234` adoptParked | 0 → 393 | - | 1224-1225,1234 |
| branches | `core/lanes.ts:1245-1249` laneServed | 400 → 1650 | - | 1248 |
| new | `core/owner.ts:55-64` dispose | 0 → 1117 | - | 62-64 |
| branches | `core/owner.ts:95-202` disposeChildren | 2000 → 12047 | owner.rs:60 | 122,126,176-177,181,187-191 |
| new | `core/scheduler.ts:397-402` joinPassTx | 0 → 5062 | core.rs:322 | 398-402 |
| branches | `core/scheduler.ts:433-449` merge | 855 → 7748 | scheduler.rs:85 | 439-448 |
| new | `core/scheduler.ts:507-515` ownSource | 0 → 492 | - | 507-515 |
| branches | `core/scheduler.ts:516-568` blockedBy | 10149 → 9291 | scheduler.rs:122 | 521-524,529,534-538,541-542,554-566 |
| new | `core/scheduler.ts:577-579` onScreen | 0 → 2865 | - | 577-579 |
| new | `core/scheduler.ts:599-601` heldTrim | 0 → 1884 | scheduler.rs:129 | 600-601 |
| new | `core/scheduler.ts:644-653` holdFrame | 0 → 4607 | - | 644-645,653 |
| branches | `core/scheduler.ts:981-1168` settle | 10010 → 11519 | scheduler.rs:197 | 1021-1022,1024,1084-1086 |
| branches | `core/scheduler.ts:1199-1225` notify | 8866 → 6715 | - | 1203,1220-1221 |
| branches | `core/scheduler.ts:1235-1289` reruns | 6487 → 4948 | scheduler.rs:304 | 1257-1259,1261,1270,1275-1276,1280,1284-1285 |
| new | `core/scheduler.ts:1319-1319` (anonymous) | 0 → 211 | - | — |
| branches | `core/scheduler.ts:1431-1465` laneDirty | 2623 → 1737 | scheduler.rs:403 | 1454-1457,1460 |
| new | `core/scheduler.ts:1458-1458` (anonymous) | 0 → 1 | - | 1458 |
| new | `core/scheduler.ts:1468-1474` queueEffectRun | 0 → 505 | scheduler.rs:422 | 1469-1474 |
| branches | `core/scheduler.ts:1489-1560` commitPendingNode | 7959 → 10707 | scheduler.rs:446 | 1509,1523-1527,1529,1534,1537-1538 |
| new | `core/truth.ts:36-40` truthRead | 0 → 408 | - | 37-38,40 |
| new | `core/truth.ts:43-47` truthConfirmed | 0 → 56 | - | 44-47 |
| new | `core/truth.ts:51-58` truth | 0 → 866 | - | 51-58 |
| new | `core/verdict.ts:240-248` quietPending | 0 → 737 | - | 240-246,248 |
| new | `core/verdict.ts:264-274` heldNotFinal | 0 → 769 | - | 264-274 |
| new | `core/verdict.ts:277-305` pendingVerdict | 0 → 240 | - | 277-279,305 |
| new | `core/verdict.ts:312-333` markVerdictReader | 0 → 23390 | - | 312-314,333 |
| new | `core/verdict.ts:338-350` latest | 0 → 11693 | - | 339-350 |
| new | `core/verdict.ts:384-411` isPending | 0 → 11697 | - | 385-395,402,404-411 |
| new | `core/verdict.ts:414-417` staged | 0 → 535 | - | 414-417 |
| new | `core/verdict.ts:421-426` heldLatest | 0 → 411 | - | 421-426 |
| new | `core/verdict.ts:450-700` verdictValue | 0 → 23390 | - | 450-453,465-471,478-480,488-489,491-492,494-495,506,510-516,521-531,534,538-540,545-548,550,552-556,561,567-570,576-577,583,588,597-598,611,616,618-619,623-629,634-639,644-645,647,655,667-668,676,680-690,694-700 |
| new | `core/verdict.ts:736-749` holdWork | 0 → 14 | - | 736,742-744,747-749 |
| new | `core/verdict.ts:766-790` stageMark | 0 → 6302 | - | 766-770,779-783,786-788,790 |
| new | `deferred.ts:65-65` GlobalQueue._lagging | 0 → 1412 | - | — |
| new | `signals.ts:519-524` createMemo | 0 → 1703 | mod.rs:342 | 520-524 |
| new | `signals.ts:594-617` createEffect | 0 → 873 | effect.rs:10 | 595-599,613-617 |
| new | `signals.ts:800-851` watch | 0 → 1093 | - | 800-811,816,849-851 |
| new | `signals.ts:817-848` computed._extraConfig | 0 → 2994 | - | 817-823,826-830,833-834,836-844,846,848 |
| new | `signals.ts:845-845` (anonymous) | 0 → 64 | - | 845 |
| new | `signals.ts:847-847` (anonymous) | 0 → 1053 | - | 847 |
| new | `signals.ts:923-1004` refresh | 0 → 1093 | - | 924-927,957,960,1003-1004 |
| new | `signals.ts:961-999` (anonymous) | 0 → 1093 | - | 961,999 |
| new | `signals.ts:962-998` (anonymous) | 0 → 1093 | - | 962,969,997-998 |
| new | `signals.ts:970-996` make | 0 → 1093 | - | 970-971,993-996 |
| new | `signals.ts:972-984` (anonymous) | 0 → 2994 | - | 972-973,977-979,981,983-984 |
| new | `signals.ts:985-988` (anonymous) | 0 → 1053 | - | 985-988 |
| new | `signals.ts:989-992` (anonymous) | 0 → 64 | - | 989-992 |
| new | `signals.ts:1002-1002` (anonymous) | 0 → 42 | - | 1002 |
