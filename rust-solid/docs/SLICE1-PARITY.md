# Slice 1 parity: which Solid code the generated programs execute

Reference: solid `2105ffb8`, rc.21, `packages/signals/src/` (read-only). Generator: `fuzz/generate-slice1.mjs` (unchanged). The Rust port is `crates/runtime/src/slice1/`. Its correspondence table is in [SLICE1.md](SLICE1.md).

## Method

1. Copy `solid-next/packages/signals/src` to `out/solid-src/`. Never edit or rebuild the reference checkout.
2. Run the copy with Node 24 `--experimental-strip-types`. A loader hook maps `./x.js` imports to `./x.ts`. The build flags are defined as in `rollup.config.js` for prod: `__DEV__ = __OBSERVE__ = __TEST__ = false`. Strip-only mode cannot handle four parameter-property constructors in `reveal.ts`, `store/utils.ts` and `store/store.ts`. In the copy only, these become explicit assignments. No core file changes, and positions are unchanged, so coverage offsets are TS line numbers.
3. Check the copy against the built oracle. For seeds 1–1000, `fuzz/solid.mjs` produced byte-identical traces through `dist/prod/index.js` and through the TS copy (`cmp` equal).
4. Collect `NODE_V8_COVERAGE` block coverage for seeds 1–1000. Annotate every TS line with its execution count.

The scripts are in [slice1-fuzz/parity/tools/](slice1-fuzz/parity/tools/). Reproduce:

```sh
# from the repository root, Node 24
mkdir -p out && cp -r ../solid-next/packages/signals/src/. out/solid-src/
T=docs/slice1-fuzz/parity/tools
node $T/fixctor.mjs out/solid-src/reveal.ts out/solid-src/store/utils.ts out/solid-src/store/store.ts
node $T/eq.mjs 1 1000 out/dist.txt
NODE_V8_COVERAGE=$PWD/out/tsdata SOLID_SIGNALS_URL=file://$PWD/out/solid-src/index.ts \
  node --import ./$T/register.mjs $T/eq.mjs 1 1000 out/src.txt
cmp out/dist.txt out/src.txt && node $T/fnmap.mjs out/tsdata && node $T/annotate-ts.mjs out/tsdata out/ann
node $T/unit-expectations.mjs            # the values asserted in tests/slice1.rs
node $T/probe.mjs overlap 1 2300         # needs target/debug/slice1-driver (cargo build)
```

## Per-operation call sequences (seeds 1–1000)

Each program has two signals: `s` (plain) and `o` (`createOptimistic(value)`). It has one render effect `view = s + o` and three rounds. Each round has an optional outside write, then an action. The action's first slice makes an optimistic write to `o`, optionally writes `s`, then yields flight `f<n>`. Its second slice writes `s`. Reads and flushes follow, with an optional write+flush, then a resolve or reject of the flight. A final flush and teardown end the program.

- **`signal`**: `createSignal`/`createOptimistic` → `signal()` (core.ts:1618) → `accessor` plus `setSignal`/`optimisticWrite` bound as setter.
- **`effect` (render)**: `createRenderEffect` → `effect()` (effect.ts:70) → `createEffectNode` → `setupComputedNode` (lazy) → `linkChild`. Then `recompute(node, true)`: its reads take the signal fast path → `link`. The first run is synchronous: `runEffect(node, 0)`.
- **`action`**: `action()` (action.ts:127). It calls `newTransaction` (open 1, acted) → `nextQuestion` → `joinFuture(t)` → `schedule` (queues the microtask flush) → `setQuestion` → `step`. Inside `step`, `enterAction` runs and the body runs:
  - `optimisticWrite` → `guessedValueOf`/`pendingGuessOf` → equality gate → push onto `pendingGuesses` → `armGuessing` → `schedule`.
  - `setSignal` → (a held node joins first: `txOf` + `joinFuture`) → `isSame` → `queuePendingNode` (or, a held node rewritten outside a flush: `stashFlushed`) → `insertSubs` → `enqueueSub` → `insertIntoHeap` → `schedule`.

  Then `exitAction`, `run(r)` and `isThenable`, and `r.value.then(...)` registers the reaction.
- **`flush`**: `flush()` (scheduler.ts:1608) loops `GlobalQueue.flush` (935) while `scheduled`. Each round does:
  1. `resyncUnflushedCompanions`, `sweepDormant` (empty here).
  2. `runHeap` → `GlobalQueue._update` → `recompute` (core.ts:364). The pass:
     - takes its seat from REACTIVE_LANE_DIRTY or CONFIG_OVERRIDE;
     - runs the body: `read` → `frameRead` → `staleReader`/`joinPass`, or `stagedRead`, or `laneRead` → `enterLane`;
     - calls `laneStage`, the equality gate, and `enqueue` of the effect's run (into a lane's queues for lane work);
     - stages, publishes, or keeps the value in the lane slot;
     - notifies through `laneDirty`/`insertSubs`, then `heldTrim` and `queuePendingNode`.
  3. `settle` (981):
     - `laneCorrections` (an ended body judges its guesses): `supersede` → `dissolveLane(l, parent, n)` → `commitPendingNode` of the lane's effect, `releaseQueues`, `holdNode`, `insertSubs`. Then one more `runHeap`.
     - `applyGuessesAt` → `applyGuesses`: `newLane`, `list`, `merge`, `laneDirty`.
     - Park this flush's `pendingNodes` into the joined transaction (A34 netting through `isSame`, then `holdNode`). With no joined transaction, `commitPendingNodes` instead.
     - `laneSeams`: staged readers of a parked frame leak (`enqueueSub`, REACTIVE_LANE_DIRTY). Then `laneSeam` per judged lane: `reruns` and `releaseQueues`, or held.
     - The landing loop: `blocked` → `lanesBlocked`/`nestedBlocked`, then `endLanes` and `land` → `reruns`, `commitPendingNode`, `releaseQueues`.
     - `liveTx`, then the queue order: lanes' runs, own runs (or stashed into a parked transaction), then landings' runs.
  4. `run(EFFECT_RENDER)` → `runQueue` → `runEffect`, then `run(EFFECT_USER)`.
- **`resolve` / `reject`**: the flight settles, and `drain()` runs the microtasks in FIFO order:
  1. Any earlier `queueMicrotask(flush)` runs (a no-op unless `scheduled`).
  2. The reaction runs `inTransaction` (action.ts:38): `setQuestion` → `joinFuture(t)` → `step(v)` or `step(e, true)` (the body's second slice, or the uncaught throw) → `done` (open−1, `schedule`, settle the action promise) → `flush()`.
  3. A later microtask delivers the action promise's `.then`, which logs `action`.

  Then `S.flush()`.
- **`read`** (untracked): `read` (core.ts:2106).
  - `s`: the fast path returns `_value`. With an unflushed staging it takes the slow path → `serve(el, null)` → `readerSeesCommitted` → `_value`.
  - `o` with CONFIG_OVERRIDE: `laneRead(null, o)` → `laneValueOf`.
- **teardown**: `disposeRootSelf` → `disposeChildren`. A child with REACTIVE_FRAME_READ or pending nodes `schedule`s. Then `clearDeps` → `unlinkSubs`, `runDisposal`, and the effect cleanup. Then `flush()`.

## Function call counts and Rust counterparts

Calls over seeds 1–1000 (V8 function counts, TS copy). Everything not listed was never entered. All are ported in `crates/runtime/src/slice1/<file>.rs` under the same name in snake_case, except where noted.

| Solid (file:lines) | calls | Rust |
| --- | ---: | --- |
| action.ts:127-245 `action`, 160 `done`, 165 `step`, 205 `run`, 38 `inTransaction` | 3000 / 3000 / 6000 / 4485 / 3000 | `action.rs` `action`, `action_done`, `step_action` (+`run`), `resume_action` |
| scheduler.ts:330 `newTransaction`, 405 `txOf`, 410 `liveTx`, 414 `resolveTx`, 421 `joinFuture`, 433 `merge` | 5623 / 26648 / 6604 / 64645 / 7459 / 855 (body: 0) | `scheduler.rs` same |
| scheduler.ts:466 `blocked`, 501 `ownFlights`, 516 `blockedBy` | 14536 / 2623 / 10149 | same. `blocked_by` is constant false: every candidate needs STATUS_PENDING |
| scheduler.ts:616 `holdNode`, 624 `list`, 735/738 `enter/exitAction`, 751/754 `setQuestion`/`nextQuestion`, 777 `schedule` | 4953 / 12557 / 6000 / 12000 / 3000 / 26812 | same |
| scheduler.ts:935 `GlobalQueue.flush`, 981 `settle`, 1169 `run`, 1176 `enqueue`, 1199 `notify` | 10010 / 10010 / 20020 / 9688 / 8866 | `global_flush`, `settle`, `run`, `enqueue`. `notify` is a no-op here (no boundary, no pending) and is not ported |
| scheduler.ts:1235 `reruns`, 1292 `land`, 1327 `releaseQueues`, 1351 `staleReader`, 1358 `queuePendingNode` | 6487 / 3000 / 9110 / 1942 / 2763 | same |
| scheduler.ts:1374 `bumpNotifyEpoch`, 1378 `insertSubs`, 1431 `laneDirty`, 1477 `sameLane`, 1482 `applyStaged`, 1489 `commitPendingNode`, 1562 `commitPendingNodes`, 1608 `flush`, 1695 `runQueue` | 12688 / 9288 / 2623 / 800 / 7959 / 7959 / 3406 / 20027 / 6392 | same (`flush` → `flush_all`) |
| core.ts:201 `GlobalQueue._update`, 364 `recompute` | 9688 / 10688 | `core.rs` `update`, `recompute` |
| core.ts:2106 `read`, 2469 `serve`, 2557 `stagedRead`, 1342 `frameRead`, 1292 `joinPass`, 1406 `bornInto` | 39376 / 1821 / 10081 / 7386 / 5444 / 1942 | `read_node`, `serve`, `staged_read`, `frame_read`, `join_pass`, `born_into` |
| core.ts:2693 `setSignal`, 2680 `isSame`, 1996 `stashFlushed`, 1972 `markUnflushedStaged`, 2016 `resyncUnflushedCompanions`, 1957 `readerSeesCommitted` | 5019 / 13068 / 1279 / 2763 / 10010 / 1821 | `set_signal`, `is_same`, `stash_flushed`; inlined in `queue_pending_node` / `serve` |
| core.ts:1452 `createEffectNode`, 1590 `setupComputedNode`, 1618 `signal`, 1259 `ext` | 1000 / 1000 / 2000 / 17803 | same. `ext` is unnecessary: extension fields live on `Node` |
| effect.ts:70 `effect`, 186 `runEffect`, 123 `notifyEffectStatus` | 1000 / 10688 / 8866 | `effect.rs` `effect`, `run_effect`. The status notifier is a no-op |
| lanes.ts:186 `optimisticWrite`, 147 `guessedValueOf`, 154 `pendingGuessOf`, 1049 `applyGuessesAt`, 220 `applyGuesses`, 119 `newLane` | 3000 / 3000 / 3000 / 10010 / 2623 / 2623 | `lanes.rs` same |
| lanes.ts:716 `laneRead`, 283 `enterLane`, 408 `laneStage`, 847 `laneCorrections`, 510 `supersede`, 554 `dissolveLane` | 7604 / 4981 / 4981 / 6510 / 2623 / 2623 | same |
| lanes.ts:1082 `laneSeams`, 872 `laneSeam`, 906 `endLanes`, 945 `lanesBlocked`, 954 `nestedBlocked`, 365 `linkBlocked`, 374 `unlink`, 826 `guessFlights`, 818 `covered`, 339 `isVerdict` | 10010 / 3887 / 3000 / 7526 / 7526 / 3487 / 2623 / 2623 / 2623 / 12585 | same. `linkBlocked`/`unlink` have no links; `guessFlights` is constant false; `isVerdict` is constant false |
| truth.ts:23 `laneValueOf` | 10227 | `lane_value_of` |
| heap.ts:19 `enqueueSub`, 37/54 `(actual)insertIntoHeap`, 86 `deleteFromHeap`, 123 `runHeap` | 9688 / 9688 / 10688 / 12633 | `heap.rs` same |
| graph.ts:147 `link`, 25 `unlinkSubs`, 62 `trimStaleDeps`, 79 `clearDeps`, 126 `sweepDormant` | 21376 / 2000 / 11014 / 1000 / 10010 | `graph.rs` same. The dormant set is always empty |
| owner.ts:381 `createOwner`, 486 `createRoot`, 204 `linkChild`, 95 `disposeChildren`, 212 `runDisposal`, 366 `disposeRootSelf`, 2868(core) `runWithOwner` | 1000 each / 2000 / 4000 | `owner.rs` `create_root`, `link_child`, `dispose_children`, `dispose_root`, `with_owner` |

## Reached but inert for this graph (not ported)

These are reached, but they compute nothing for scalar signals with no boundaries, stores, marks or flights:

- `boundaries.ts` `catchStatus` (no boundary returns false), `hiddenBy`/`heldRun`/`boundaryOf` (undefined boundary), `boundarySeam` (empty `collecting`).
- `verdict.ts` `attachWaits`/`valueInserts` (numbers are not objects).
- `store/*` `storePark`/`park`/`drainFolds`/`sweepOverlaid` (empty lists).
- `affects.ts` ambient marks (empty).
- `async.ts` `clearStatus` (status cleared, notifier no-op), `releaseFlightTeardown`/`clearInFlight`/`isThenable` (no flights).

## Branch-level findings that matter for traces

- Every flush that carries an action's first slice runs **two passes** of `view`. Take the reduced case `s=2, o=1`, where the action guesses `o=7`, writes `s=3`, then flushes:
  1. **Staged truth.** The flush's own `runHeap` re-runs `view` (log: `compute 3`). It reads `s`'s staging through `serve` → `stagedRead` (3), and `o`'s committed value (1): the guess is still in `pendingGuesses`. The value 4 goes to the effect's private value slot, and its run is queued. The seam has joined the action's transaction (`flushTransaction` was set by `action()`), so `settle` parks `s` (`holdNode`) and stashes the run in the transaction's queues. The run is never shown: by the landing, `_modified` is false.
  2. **Lane presentation.** `settle` → `applyGuesses` opens a lane, and `laneDirty` marks `view` REACTIVE_LANE_DIRTY. The next round re-runs it (log: `compute 4`). It reads the held `s` as a stale reader (`frameRead` → `staleReader`, committed 2), and `o` through `laneRead` → `enterLane` (7). `laneStage` lists `view` in the lane, and its run goes to the lane's queue. Then `laneSeam` reveals the lane, and the run applies 9 over 3 (`effect_cleanup 3`, `effect 9 3`).

  The old slice computed only pass 2 (the old `compute/effect_cleanup` class).
- An ordinary write outside the action to a held node (`write s; flush` during the hold) goes through `setSignal` → `joinFuture(txOf(s))`, which sets the flush's transaction to the hold. The flush recomputes `view`: `frameRead` finds the flush's own transaction, so it calls `joinPass`, and the fast path serves the staging. The value and run are parked with the hold. Untracked reads keep serving `_value`. This was the old `compute/read` class.
- At the body's end (`_open` back to 0), `laneCorrections` supersedes each guess with its truth (`covered` = committed `_value`). `dissolveLane` then commits the effect's lane value as shown, and the next round re-derives from the parent's world.
- Never entered in seeds 1–1000 (and so ported only where cheap, or as an explicit panic):
  - `merge`'s body;
  - `reruns` with REACTIVE_FRAME_READ still set;
  - `laneRead`'s held-lane screen read;
  - `laneWrite`;
  - `endLanes` → `dissolveLane(l, null)`;
  - `heldTrim`;
  - `joinPassTx`;
  - `linkLanes`;
  - `take`.

  The like plan reaches `laneOutcome`, `endLanes` → `dissolveLane(l, null)`, `pullComputed`/`updateIfNecessary` and born-held commits. The private probe below reaches `merge`, `reruns` frames, the held-lane screen read, `heldTrim` and user effects.

## Out-of-distribution probe (not an official score)

[tools/probe.mjs](slice1-fuzz/parity/tools/probe.mjs) uses the same worker oracle and exact comparison as `fuzz/run.mjs`, with a wider program family:

- three sources (`s`, `t`, optimistic `o`);
- an optional memo;
- one or two effects (render or user);
- 14 random steps of writes, flushes, reads, actions (one or two slices) and resolves/rejects in random order;
- in `overlap` mode, up to three concurrently open actions.

It needed one driver addition: a `memo` operation. Results are in [parity/probe.json](slice1-fuzz/parity/probe.json).
