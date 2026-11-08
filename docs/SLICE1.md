# Slices 1, 2a, 2b and 2c: a structural port of Solid's scheduler, stores and lists (resolved like plan → Rust text frames; async memos; stores; mapArray, owners and parked frames)

## Status

The slice runtime is a **structural port of the Solid scheduler, store and list paths that slices 1, 2a, 2b and 2c reach**. It lives in `crates/runtime/src/slice1/` (the module keeps its slice-1 name).

- Slice 1: transactions, lanes, pending/held queues, the flush and its seam, the speculative compute passes, the effect queue split, and `setSignal` hold/join/equality. Call map: [SLICE1-PARITY.md](SLICE1-PARITY.md).
- Slice 2a adds:
  - async memos over host flights (`handleAsync`, the landing `asyncWrite`, the rejection `handleError`);
  - pending and error status with its walks (`notifyStatus`, `propagateStatus`, `settlePendingSource`, pending sources as JS `Set`s);
  - staged errors (D-41: `stageError`, `stageMark`, the commit's publish);
  - loading values and loading windows;
  - `refresh()` and its truth-reading waiter;
  - the untracked `latest`/`isPending` windows (`verdictValue`);
  - `blockedBy`/`ownFlights` over pending nodes;
  - the pass-scoped transaction (`passTx`);
  - linked lanes;
  - user-effect error handlers.

  The measured Solid delta is in [SLICE2A-COVERAGE.md](SLICE2A-COVERAGE.md).
- Slice 2b (tier B of [SLICE2B-DESIGN.md](SLICE2B-DESIGN.md)) adds the store tier, one Rust module per Solid file under `slice1/store/`:
  - plain stores (`store.rs`): targets and one proxy per target, lazy slot nodes (leaf, presence, container), the pending backing (CoW clones, `ensurePB`, `privatizeCommitted`), write-time notification (`notifyWrites`, written keys), adoption (`adoptPB`), the fold at the flush's commit (`drainFolds`, `foldTarget`), the scheduler's store hooks (`storePark`, the commit hook), which backing a read serves (`readSource`, `heldKeyChanged`, `adoptChild`, `nodeValue`, `serveDataKey`) and the proxy traps;
  - reconcile (`reconcile.rs`: keyed and positional `applyAdopt`, `descend`);
  - optimistic stores (`optimistic.rs`): guesses on leaf, presence and container nodes (`notifyOptimisticWrites`, `LaneView` arrangement guesses), composed reads (`optimisticView`, `optimisticHas`), and the lane hooks: `_slotTake`, `_laneRebase`, `fold`/`foldedRead`, `_echoes`, `ask`/`stands`/`park`, `sweepOverlaid`;
  - derived stores (`projection.rs`): the derive computed, `runProjectionComputed` with its per-pass `commit`/`onError`, `wakeFamily`/`errorFamily`/`settleFamily`/`familyStatus`;
  - the reached core arms the earlier slices held constant: `take`/`kept`/`reverted`, `laneOutcome`, store slots in `laneWrite`/`dissolveLane`/`covered`/`inFlight`, folded and re-based lanes (`laneRead`, `frameRead`, `laneSeam(s)`, `verdictValue`), `stagedScreen`/`holdStaging`/`joinPassAt`, promoted writes, `setSignal`'s custom comparators and D-8 netting, `handleAsync`'s object results and setters, `attachWaits`/`valueInserts`;
  - a JS value model (`value.rs`): objects and arrays by identity, store proxies, `undefined`, booleans.

  The measured Solid delta is in [SLICE2B-COVERAGE.md](SLICE2B-COVERAGE.md); every one of its 184 functions has a cited Rust counterpart.
- Slice 2c (tier C of [SLICE2B-DESIGN.md](SLICE2B-DESIGN.md)) adds lists, Show and children built inside computations:
  - `map.ts` → `map.rs`: `mapArray` and `updateKeyedMap` in its three keying modes (identity, `keyed: false` index rows, a key function with optional index signals; the mapper's arity decides the index signals), with every path the programs reach: empty plus fallback, create-all and its abort, the prefix (`writeRow`, `compare`) and suffix skips, "no structural change", the small-move probe, `trySmallMove`/`commitSmallMove` (with the duplicate decline), `stageRemoval`, the keyed map with its duplicate chains, the #2903 abort and retry, `commitWindow`; `_items` is the ECMA-262 `slice(0)` through the store traps;
  - owners (`owner.rs`): `createOwner` with `_parentComputed` (a field now; `map.ts` re-points it per pass), `onCleanup`/`cleanup` disposal lists run last-registered first (`runDisposal`), `markDisposal`, the zombie drain of `disposeChildren` (a parked frame dying with its owner), `disposeRootSelf`;
  - parked frames and zombies in the core: recompute's frame step (a CONFIG_STAGED pass's children die on the spot with `deferredReleases`; otherwise `parkChildren`), the CONFIG_STAGED queueing of a parked frame, `GlobalQueue._update`'s zombie arms (`deferZombie`, `laneFrameMember`), `holdFrame` over the live child chain, `settle`'s deferred zombies (sorted and cancelled at a park, survivors re-run at a commit), `onScreen`'s `removalStagedBy`, `reruns` voiding the children's queued runs, and the parked frame retired by `commitPendingNode`, `laneSeam`, a never-shown lane's dissolve and `handleError`'s published error;
  - CONFIG_SYNC (recompute's prod fast arm) and user comparators (`options.equals`) for Show's `condition` memo;
  - shallow stores (`store/store.rs`, `store/types.rs`, `store/reconcile.rs`): `serveShallow` at every trap site, the `set` trap's raw value and `markRawOne`, `createStore({shallow})` with `markRawIngest`, `rawValues` in `wrap` and `descend`, reconcile's shallow arms, and the list driver's `shallowView`; the `get` trap's `$TRACK` arm (the container read `mapArray` makes);
  - in the driver: the `owner`, `cleanup` and `dispose` ops, `list` (mapArray and For), `show` (the three memos of solid-js `Show`, element, function and keyed children), memo/effect `children` and `cleanup`, the row/child kinds, the expressions `item`, `index`, `call`, `local`, `concat`, `reverse`, the `moveKey` edit, and the `row`, `fallback`, `branch` events and `{f}` values.

  The measured Solid delta is in [SLICE2C-COVERAGE.md](SLICE2C-COVERAGE.md): each of the 55 functions the valid programs reach (`coverage-delta-lines-valid-only.txt`) has a cited Rust counterpart (below). The 6 more that only invalid seed 493 reaches are Solid's halt path (`haltReactivity`, `notifyHalted`, `escalate`'s halt), which the port records as an error instead, as before.

Results on the exact-trace fuzzer (worker oracle, generators and comparator as committed; no filtering or normalization). The run summaries are in [slice2c-fuzz/port](slice2c-fuzz/port/) (and [slice2b-fuzz/port](slice2b-fuzz/port/), [slice2a-fuzz/port](slice2a-fuzz/port/) for the earlier ports).

| run | agree | invalid (oracle) | other failures |
| --- | ---: | ---: | --- |
| `--slice2c` seeds 1–1000 | **999/1000** | 1 `oracle-halted` (seed 493: a suspected Solid bug, below) | none |
| `--slice2c` held-out seeds 1001–3000 | **1998/2000** | 2 `oracle-error` (seeds 2723, 2907: the same family) | none |
| `--slice2c` extra seeds 3001–8000 (not a gate) | **4988/5000** | 12 (9 `oracle-error`, 3 `oracle-halted`), the same family | none |
| `--slice2b` seeds 1–1000 | **1000/1000** | 0 | none |
| `--slice2b` held-out seeds 1001–3000 | **1999/2000** | 1 `oracle-error` (seed 1430: a suspected Solid bug, below) | none |
| `--slice2b` extra seeds 3001–8000 (not a gate) | **4997/5000** | 3: `oracle-error` 4623, `oracle-halted` 5270 and 7335 (the same suspected Solid bug) | none |
| `--slice2a` seeds 1–1000 (gate) | **991/1000** | 8 `oracle-nonscalar` | 1 `rust-panic` (seed 629, fail-closed; see below); summary identical to `slice2a-fuzz/port/summary-1-1000.json` |
| `--slice2a` held-out seeds 1001–3000 | **1984/2000** | 16 `oracle-nonscalar` | none |
| `--slice1` seeds 1–1000 (gate) | **1000/1000** | 0 | none; summary identical to `slice1-fuzz/parity/summary-1-1000.json` |
| `--slice1` seeds 1001–3000 | **2000/2000** | 0 | none |

- Slice 2c: before this port the score was 0/1000 (every program panicked at its first `list`, `show` or `owner` op, or at a shallow store). Every family agrees on every valid seed of 1–8000: list-ints, list-store, list-lanes, list-opt-store, list-show, list-nested, list-bulk and tracker (1–1000: 131/131, 132/132, 132/132, 131/132, 129/129, 86/86, 86/86, 172/172).
- The first full run after the port agreed on 978/1000: the 21 other programs panicked at shallow stores, the one arm then still cut; with shallow stores ported every valid program agrees.
- All gates are byte-identical to their recorded summaries: `--slice1` 1–1000 and 1001–3000, `--slice2a` 1–1000 and 1001–3000, `--slice2b` 1–1000 and 1001–3000 (copies in [slice2c-fuzz/port](slice2c-fuzz/port/)). The slice-1 private probe still agrees on 4600/4600.
- Slice 2b: before this port the score was 0/1000 (every program panicked at its first `store` op). Every family agrees on every valid seed: store-plain 125/125, store-actions 126/126, opt-memo-rows 168/168, opt-store-rows 168/168, opt-store-derived 126/126, store-provenance 123/123, tracker 164/164.
- The first full run after the port agreed on 884/1000; one missing arm accounted for every difference: `setSignal`'s custom-comparator gate and D-8 netting for store slot nodes (`slotNodeEquals`: a row adopted by its target is the same slot). The extra seeds found one more arm, `laneStage` assigning `display(el)` — NOT_PENDING for a node with nothing on screen — to `_value` (seed 7625); both are ported.

- Every valid slice-2a program agrees except seed 629. Before the 2a port the score was 0/1000: every program panicked at its first async memo.
- The slice-1 private probe ([SLICE1-PARITY.md](SLICE1-PARITY.md), `probe.mjs plain|overlap 1 2300`) still agrees on 4600/4600.
- The like scenario still gives native frames `0`, `1`, `0`, `1`, `1`.

## Remaining classes

**Slice 2c: none.** Every valid `--slice2c` program of seeds 1–8000 agrees. The invalid ones (15) are the suspected Solid bug family below, never counted as agreement; on them the port reaches the same `undefined` row and fails closed (the driver's key function panics where Solid's throws a `TypeError`).

**Slice 2b: none.** Every valid `--slice2b` program of seeds 1–8000 agrees. The invalid ones are the suspected Solid bug below (seeds 1430, 4623, 5270, 7335), never counted as agreement. On those programs the port fails closed: `txOf` of a held node with no transaction panics (`scheduler.rs` `tx_of`) where Solid throws a `TypeError`.

**Slice 2a, `rust-panic`: seed 629, a staged error served as a lane value.** Reduced case (13 ops, class-preserving): [slice2a-fuzz/port/reduced-rust-panic-629.json](slice2a-fuzz/port/reduced-rust-panic-629.json).

- Async memo `a` is held when its flight `q:2` rejects. `stageError` stages the `StatusError` in `a._pendingValue`, and `stageMark` copies it onto `m = a + o`. `m` is a derivation in the guess lane of `o` (CONFIG_OVERRIDE).
- The user effect `watch` then reads `m`. `read` → `laneRead` → `laneValueOf(m)` returns `_pendingValue` for a non-guess node, with no CONFIG_STAGED_ERROR test. Solid hands the reader the error **object** as a value.
- `watch` computes `"Error: memo-failed41"`, a string; this was checked by logging the computed value on `dist/prod`. The commit then publishes the error, and `watch` runs its error handler instead of applying the string. So the string never reaches the trace, and the oracle counts the program as valid.
- Values in the port are integers. `read` panics "a staged error served as a lane value (truth.ts:24) is not ported" (`core.rs` `served_as_value`) instead of inventing a value.
- This is the same reference behaviour as the "error object becomes a memo's value" shape in the invalid seeds. It looks like a missing CONFIG_STAGED_ERROR test in `laneValueOf`/`laneRead`, and was not triaged further.
- Slice 2b reaches `laneValueOf` returning a staged error in 5 `store-provenance` seeds (89, 521, 593, 905, 930), but only through `dissolveLane`'s `latest` (where the staging stays the staging); no read serves it, and those seeds agree. The read arm still fails closed.

**`oracle-nonscalar` (invalid, never counted as agreement):**

- Seeds 1–1000: 225, 339, 427, 488, 663, 683, 704, 873.
- Seeds 1001–3000: 1360, 1438, 1637, 1693, 1778, 1950, 2037, 2215, 2253, 2443, 2558, 2582, 2583, 2667, 2762, 2972.

These are exactly the seeds the generator report lists ([slice2a-fuzz/invalid-seeds.json](slice2a-fuzz/invalid-seeds.json)). Solid observes `undefined` or an Error object there. There were no oracle timeouts, oracle errors or halts. The parked lazy-refresh hang and the `deleteFromHeap` TypeError do not appear, because no slice-2a program is lazy.

## Suspected Solid bug (slice 2b): `take` of a held slot

`take(n, l, true)` (lanes.ts:174-181) nulls the taken node's `_x._transaction` and clears CONFIG_GUESS|CONFIG_OVERRIDE, but keeps CONFIG_HELD. `GlobalQueue._slotTake` (optimistic.ts:353-374) calls it for a derived optimistic store's other guessed slots when its derive re-asks in another action's lane. A slot whose guess had a landing held beneath it (`laneWrite`, lanes.ts:982-990: `el._config |= CONFIG_HELD`) is then held with no transaction. The next `txOf` of it throws in `resolveTx(null)` (`TypeError: Cannot read properties of null (reading 'eo')`): the re-ask's landing writing it (`reconcileState` → `applyAdopt` → `notifyKeyDiff` → `leafSet` → `setSignal`'s CONFIG_HELD arm, `joinFuture(txOf(el))`), or a render effect reading it (`read` → `frameRead`). Inside a flush's effects the reactivity halts.

- Seeds 1430 (`oracle-error`), 4623 (`oracle-error`), 5270 and 7335 (`oracle-halted`) all reach it; an instrumented copy shows `take(d)` on a held node before each throw.
- Minimal repros: [slice2b-fuzz/port/solid-bug-take-held.json](slice2b-fuzz/port/solid-bug-take-held.json) (9 ops; `node fuzz/run.mjs --slice2b --replay` reports `oracle-error`) and the same program on Solid's API alone, [slice2b-fuzz/port/solid-bug-take-held.mjs](slice2b-fuzz/port/solid-bug-take-held.mjs) (`node docs/slice2b-fuzz/port/solid-bug-take-held.mjs`). Reduced with [bug-reduce.mjs](slice2b-fuzz/tools/bug-reduce.mjs) from seed 5270 (1430 and 4623 reduce to 12-op programs of the same shape: a guess, a refresh, a pre-answered re-ask, a nav action guessing the derive's input).
- Not reported upstream. The port does not imitate it.

## Suspected Solid bug family (slice 2c): array views with holes

A store array hands `mapArray` an `undefined` row, and the program's key function `x => x.id` throws a `TypeError` inside `updateKeyedMap`. Two mechanisms (details, repros and seeds in [slice2c-fuzz/port/README.md](slice2c-fuzz/port/README.md) and [SLICE2C-COVERAGE.md](SLICE2C-COVERAGE.md) section 8):

1. **`has` and `get` disagree inside a map pass**: `length` covers index `i` and `list[i]` is a row, but `i in list` is false, so `_items = newItems.slice(0)` keeps a hole that the next pass's `compare` hands to the key function.
   - On an optimistic store under overlapping guesses: seed 493 (`oracle-halted`).
   - On a **plain store** whose container a pending action holds (its edit was a `{key, is}` miss and wrote nothing) while mainline reconciles and pushes: extra seeds 4857, 5042, 7869. Minimal repros: [slice2c-fuzz/port/solid-bug-plain-store-hole-4857.json](slice2c-fuzz/port/solid-bug-plain-store-hole-4857.json) (12 ops; `node fuzz/run.mjs --slice2c --replay` reports `oracle-halted`) and the same on Solid's API alone, [slice2c-fuzz/port/solid-bug-plain-store-hole.mjs](slice2c-fuzz/port/solid-bug-plain-store-hole.mjs), which logs a pass seeing `length 1 [false:8]` and the key function then receiving `undefined`.
2. **A lasting hole in an optimistic view**: overlapping pending move/remove/push guesses compose into `[undefined]` / `[undefined, row 6]`: seeds 2723 and 2907 (`oracle-error`; repros [slice2c-fuzz/repro-2723-optimistic-hole.json](slice2c-fuzz/repro-2723-optimistic-hole.json), [slice2c-fuzz/solid-bug-optimistic-hole-2.mjs](slice2c-fuzz/solid-bug-optimistic-hole-2.mjs)).

The extra seeds 4081, 4220, 5117, 5138, 5554, 6174, 6888, 6910 and 7645 (`list-opt-store`) throw the same `TypeError`; they were not triaged between the two. The port does not imitate the throw. It does reproduce the holes: with the list replaced by a render effect over `plain(list, [id])`, 2723 and 2907 are valid programs and the port agrees with Solid's `[undefined]` and `[undefined, row 6]` ([slice2c-fuzz/port/hole-view-2723.json](slice2c-fuzz/port/hole-view-2723.json), [hole-view-2907.json](slice2c-fuzz/port/hole-view-2907.json)). Not reported upstream.

## Placement

The port is a separate module, **beside M1**. The module reuses nothing from `lib.rs`: M1's dependency graph, effect queue and scheduler have different semantics (no seam, no stashed queues, no lane passes). M1 and its 15 tests are untouched.

- Read-only source: Solid `2105ffb8ca2fced55f5fac0763177fc93f97c2c2`, rc.21, `packages/signals/src/`.
- One Rust file per Solid file: `async.ts` → `async.rs` (`mod r#async`), `verdict.ts` → `verdict.rs`, `store/store.ts` → `store/store.rs`, and so on. `value.rs` is not a Solid file: it models the JS values the store tier works on.
- Every ported function has a `// Solid: file.ts:lines` comment.
- Module-level `let`s become fields of `Runtime` (`mod.rs`); the store files' are `Runtime::store` (`store/mod.rs` `StoreState`).
- Installed hooks are direct calls: in the prod bundle every hook the store tier installs (`storeParkHook`, `storeCommitHook`, `optHooks`, `setSlotUnobserved`, `GlobalQueue._slot*`, `_echoes`, `_laneRebase`) is always present.

## Source correspondence

| Solid | Rust (`crates/runtime/src/slice1/`) |
| --- | --- |
| `types.ts` `Signal`/`Computed`/`Owner`; core.ts:1259-1279 `NodeExtension`; core.ts:1668-1724 `slotSignal` | `mod.rs` `Node`. The extension fields are inlined: an absent extension and a default one behave alike on every ported path (`clearStatus` on a status-free node changes nothing). `_pendingSources` is a `JsSet` (shared by reference, JS iteration order); a `StatusError` held in `_pendingValue` is `pending_err`. A slot node's `_host`, `_key`, `acc`, `px`/`pxv` and a derive's `_fam` are fields; `_equals` is `Equals` (`isEqual`, an effect's `false`, `slotNodeEquals`, `containerEquals`). |
| `constants.ts` flag bits | `mod.rs` `REACTIVE_*`, `CONFIG_*`, `STATUS_*` (same values) |
| `error.ts` `NotReadyError`, `StatusError`, `unwrapStatusError` | `error.rs` `Thrown` (`Rc`, compared by identity) |
| scheduler.ts:266-327 `Transaction` | `mod.rs` `Transaction`: nodes, queues, reruns, into, parent, lane, links (an index into `link_groups`), open, acted, shown, held, `folded` (set only to `foldedRead`), `over` |
| scheduler.ts:330-449 `newTransaction`, `joinPassTx` (397-402, with `passTx`), `txOf`, `liveTx`, `resolveTx`, `joinFuture`, `merge` | `scheduler.rs` same names; `join_pass_tx` in `core.rs` |
| scheduler.ts:466-579 `blocked`, `ownFlights`, `ownSource`, `blockedBy`, `onScreen` | `scheduler.rs` |
| scheduler.ts:599-653 `heldTrim`, `holdNode`, `list`, `holdFrame` | `scheduler.rs` (`holdFrame` visits no children here) |
| scheduler.ts:735-787 `enterAction`/`exitAction`, `setQuestion`/`nextQuestion`, `schedule` | `scheduler.rs`. `schedule` pushes `Microtask::Flush` |
| scheduler.ts:935-1168 `GlobalQueue.flush`, `settle` (with `storeParkHook` and `storeCommitHook`) | `scheduler.rs` `global_flush`, `settle` |
| scheduler.ts:1169-1225 `run`, `enqueue`, `notify` | `scheduler.rs` |
| scheduler.ts:1235-1332 `reruns`, `land`, `releaseQueues` | `scheduler.rs` |
| scheduler.ts:1351-1571 `staleReader`, `queuePendingNode`, `insertSubs`, `laneDirty` (with the pending re-seat), `queueEffectRun`, `sameLane` (link groups), `applyStaged`, `commitPendingNode(s)` (in-flight commits, staged-error publish) | `scheduler.rs` |
| scheduler.ts:1608-1707 `flush`, `runQueue` | `scheduler.rs` `flush_all`, `run_queue` |
| core.ts:201-224 `GlobalQueue._update`; 364-1090 `recompute` (seat, held re-pass, async result, status catch, staged error, re-park sweeps, born-held pending, `keepReaders`) | `core.rs` `update`, `recompute` |
| core.ts:1092-1137 `updateIfNecessary` (error retry); 2028-2044 `pullComputed` (CONFIG_FRESH_READ) | `core.rs` |
| core.ts:1144-1253 `computed` (`loadingValue`, `_extraConfig`); 1452-1566 `createEffectNode`; 1590-1616 `setupComputedNode`; 1618-1662 `signal` | `core.rs` `computed_node`, `create_effect_node`, `setup_computed_node`, `signal_node` |
| core.ts:1292-1420 `joinPass`, `joinPassAt`, `frameRead` (`laneServed` for lane work, a re-based lane's `over`), `bornInto`, `creatorPass` | `core.rs` |
| core.ts:1909-1939 `prepareComputed`; 1957-2023 `readerSeesCommitted`, `unflushedValue`, `stashFlushed`, `markLateLinker`, `resyncUnflushedCompanions`; 2624-2628 `notePromotedWrite` | `core.rs` |
| core.ts:2090-2104 `servesStaged`; 2106-2447 `read` (verdict dispatch, pending/error arms, error retry, a folded lane's screen); 2452 `throwShown`; 2469-2523 `serve`; 2557-2570 `stagedRead`; 2585-2612 `stagedScreen` | `core.rs` `serves_staged`, `read_node`, `throw_shown`, `serve`, `staged_read`, `staged_screen` |
| core.ts:2680-2797 `isSame`, `setSignal` (also an async landing; custom comparators, D-8 netting, promoted writes); 2915-2952 `markRefresh` | `core.rs` |
| async.ts:69-136 `addPendingSource`, `removePendingSource`, `clearInFlight`, `clearPendingSources`, `retryReaches`, `parkLoadingWindow`, `setPendingError` | `async.rs` |
| async.ts:138-406 `forEachDependent`/`walkDependents`, `releaseIfSettledUnobserved`, `releaseSettledDependents`, `stageError`, `settleErroredDependents`, `settlePendingSource` | `async.rs` |
| async.ts:458-934 `handleAsync` for a promise or a plain object (`asyncWrite` with or without a setter, `handleError` with `onError`, `settleAutodispose`, the reaction) | `async.rs` `handle_async_result`, `handle_async`, `async_write`, `handle_error`, `settle_autodispose`, `flight_reaction` |
| async.ts:936-1143 `clearStatus`, `landStatus`, `notifyStatus`, `propagateStatus` | `async.rs` |
| verdict.ts:240-426 `quietPending`, `heldNotFinal`, `pendingVerdict`, `markVerdictReader`, `latest`, `isPending`, `staged`, `heldLatest` | `verdict.rs` (`latest_window`, `is_pending_window`) |
| verdict.ts:450-700 `verdictValue` (untracked; a folded lane's `latest`); 736-749 `holdWork`; 766-790 `stageMark`; 796-813 `keepReaders`; 836-860 `valueInserts`, `attachWaits`; 873-890 `holdStaging` | `verdict.rs` |
| truth.ts:23-58 `laneValueOf`, `truthRead`, `truthConfirmed`, `truth` | `truth.rs` |
| lanes.ts:119-273 `newLane`, `display`, `guessedValueOf`, `pendingGuessOf`, `take`, `rerun`, `optimisticWrite`, `inFlight`, `applyGuesses`; 1049-1052 `applyGuessesAt` | `lanes.rs` |
| lanes.ts:283-380 `enterLane`, `under`, `linkLanes`, `linkBlocked`, `unlink` | `lanes.rs` |
| lanes.ts:408-492 `laneStage` (pending propagation's leaf arm); 510-542 `supersede` (a confirmation tells truth readers); 554-695 `dissolveLane` (first loads, in-flight corrections) | `lanes.rs` |
| lanes.ts:716-832 `laneRead` (folded lanes, truth readers, pending members), `covered`, `guessFlights` | `lanes.rs` |
| lanes.ts:847-1052 `laneCorrections` (`reverting`), `laneSeam`, `endLanes` (`kept` guesses back), `lanesBlocked`, `nestedBlocked`, `laneWrite` (slot takes, re-bases), `laneOutcome`, `stale`, `answered` | `lanes.rs` |
| lanes.ts:1082-1249 `readsHeld`, `laneSeams`, `laneServed` | `lanes.rs` |
| effect.ts:70-121 `effect`; 123-184 `notifyEffectStatus`, `escalate`; 186-286 `runEffect` (user error arm) | `effect.rs` (`effect_with`) |
| action.ts:38-48 `inTransaction`; 127-245 `action` (`done`, `step`, `run`) | `action.rs` `resume_action`, `action`, `action_done`, `step_action` (+`run`) |
| heap.ts (whole file) | `heap.rs` |
| graph.ts:23-102 `unlinkSubs` (the slot nodes' release hook), `trimStaleDeps`, `clearDeps`, `unobserved`; 149-190 `link` | `graph.rs` |
| owner.ts:46-53 `markDisposal`; 55-64 `dispose`; 76-85 `runCleanup`; 95-210 `disposeChildren` (the zombie drain, a parked frame dying with its owner), `linkChild`; 212-238 `runDisposal`; 316-318 `getOwner`; 338-344 `cleanup`; 362-371 `isDisposed`, `disposeRootSelf`; 387-449 `createOwner` (`_parentComputed`); 487-496 `createRoot`; core.ts:2868 `runWithOwner`; signals.ts:99-128 `onCleanup` | `owner.rs` (`_disposal` is a `Vec` run last-first; `_parentComputed` a node field) |
| map.ts:67-108 `mapArray`; 110 `pureOptions`; 150-219 `trySmallMove`; 228-302 `commitSmallMove`; 312-342 `stageRemoval`; 350-397 `commitWindow`; 400-401 `writeRow`; 403-702 `updateKeyedMap` (the `mapper` closures 429-452, the empty, create-all and general paths); 827-829 `compare`; 843-858 `MapData` | `map.rs` (`Body::Map`; `MapData` in `Runtime::maps`) |
| core.ts:201-224 `GlobalQueue._update` (zombie arms), 229-236 `laneFrameMember`; 509-524 the frame step (die on the spot, `parkChildren`); 620-624 the CONFIG_SYNC arm; 1058-1066 the queueing of a parked frame; 1436-1444 `parkChildren` | `core.rs` `update`, `lane_frame_member`, `recompute`, `park_children` |
| scheduler.ts:586-592 `removalStagedBy` (in `onScreen`); 605-612 `deferredZombies`, `deferZombie`; 644-653 `holdFrame`; 1048-1072 the park's `holdFrame` and zombie sort; 1157-1164 zombies re-run at a commit; 1278-1281 `reruns` voiding the children's runs; 1552-1559 the commit retiring the parked frame | `scheduler.rs` |
| lanes.ts:676-677 a never-shown lane's dissolve retiring a frame; 896-898 `laneSeam` retiring it; async.ts:581 `handleError`'s zombie drain; graph.ts:50-56, 95-96 `deferredReleases` | `lanes.rs`, `async.rs`, `graph.rs` |
| store.ts:1492-1496 `serveShallow`, its trap sites (1820, 2138, 2248, 2252; 2209 is the accessor arm, not ported), 2350/2383 the `set` trap's raw value and `markRawOne`, 2594-2596 `createStore({shallow})`, 2623-2627 `shallowView`, 2100-2110 the `get` trap's `$TRACK`; types.ts:111-145 `rawValues`, `isRawValue`, `markRawOne`, `markRawIngest`; reconcile.ts:105-107, 120, 196, 244, 330 the shallow and raw arms | `store/store.rs`, `store/types.rs`, `store/reconcile.rs` |
| boundaries.ts:251-334, 1080-1084 `catchStatus`, `armedOver`, `hiddenBy`, `freshHook` (no boundary) | `boundaries.rs` |
| signals.ts:413-654 `createSignal`, `createOptimistic`, `createMemo` (+`loadingValue`), `createEffect` (+`error`), `createRenderEffect` | `mod.rs` / `effect.rs` public API |
| signals.ts:800-851 `watch`; 923-1004 `refresh` | `signals.rs` `watch`, `waiter_body`, `refresh`, `refresh_waiter`; a store's (`$REFRESH`, its derive): `store/mod.rs` `refresh_store` |
| store/target.ts `StoreTarget`, `StoreFamily`, `setLookup`, `isOwned`, `lookupTarget`, `markDescendants` | `store/target.rs` |
| store/types.ts:156-184 `isWrappable`, `setWriteOverride` | `store/types.rs` |
| store/store.ts:157-1049 `TargetShape`/`createTarget`, `wrap`, `unwrapValue`, `slotNodeEquals`, `sameKey`, `LaneView`, `asBacking`, `containerEquals`, `sameLogicalSlot`, `releaseSlot`, `noteNode`, `slotKept`, `bornStaged`, `getNode`, `getHasNode`, `getContainerNode`, `stageOn`, `deriveHolds`, `storePark`, `notifyContainer`, `cloneRaw`, `copyOwn`, `scanAccessorsOnce`, `plainProto`, `ensurePB`, `privatizeCommitted`, `parentSlotKey`, `adoptPB`, `queueFold`, `preBatch`, `drainFolds`, `_slotFlight`, `_slotCovered`, `runDirect`, `foldTarget` | `store/store.rs` (`LaneView` in `value.rs`) |
| store/store.ts:1135-1468 `userWriting`, `heldDerivation`, `notifyWrites`, `targetsEqual`, `arrayStructureChanged`, `membershipChanged`, `leafSet`, `notifyKeyDiff`, `notifyKeyValue`, `notifyFoldTail`, `notifyFold` | `store/store.rs` |
| store/store.ts:1480-2036 `scopeKey`, `inDraft`, `draftServe`, `committed`, `stagingReader`, `readSource`, `heldKeyChanged`, `rawsOf`, `sameRow`, `adoptChild`, `familyAhead`, `keyChanged`, `changedBetween`, `nodeValue`, `serveDataKey`, `linkedTo`, `pullFamily`, `holdWithDerive`, `optRead`, `touch` | `store/store.rs` |
| store/store.ts:2088-2615 the traps (`get`, `has`, `set`, `deleteProperty`, `getPrototypeOf`), `storeSetter`, `createStore` | `store/store.rs` `trap_*`, `store_setter`, `create_plain_store`; `store/mod.rs` `js_get`/`js_has`/`js_set`/`js_delete` (JS property access on any value) |
| store/reconcile.ts `reconcileState`, `applyAdopt`, `descend`; store/index.ts:113-118 `reconcile` | `store/reconcile.rs`; `store/mod.rs` `store_reconcile` |
| store/optimistic.ts `writerBacking`, `optimisticDraft`, `notifyOptimisticWrites`, `arrangement`, `rowSame`, `echoes`, `arrangementEqual`, `_slotTake`, `_laneRebase`, `fold`, `foldedRead`, `sameRow`, `laneSet`, `pairRows` (fail-closed), `ask`, `stands`, `park`, `held`, `sameAction`, `shallowKeys`, `markOverlaid`, `sweepOverlaid`, `nodesOf`, `laneNodeOf`, `overlaid`, `shown`, `optimisticHas`, `optimisticView`, `createOptimisticStore` | `store/optimistic.rs` |
| store/projection.ts `wrapDraft` (its `get`), `cloneState`, `wakeFamily`, `errorFamily`, `settleFamily`, `familyStatus`, `forEachFamilyNode`, `runProjectionComputed` (with `asking`, `commit`, `onError`), `createProjectionInternal` | `store/projection.rs`; `wrapDraft`'s `get` is `store/store.rs` `draft_get`; the derive computed is `Body::Projection` |

## Deviations from Solid's structure, and why

**Not ported, because these slices keep them constant.** Each is noted at its site:

- tracked verdict readers: CONFIG_VERDICT, `verdictRead`, `route`, `watchVerdict`, `provisionalVerdict`, `observeFlight`, verdict lanes `_verdict`, `ahead`/`entered`;
- boundaries (only their inert hook answers are ported), `affects()` marks, snapshots;
- async iterators, synchronously settled thenables;
- in the stores: accessor properties (getters/setters on store data, `acc`, FORCE), prototype-overlay drafts (records over 32 keys), chained backings (a store over another store's proxy, §7b), shallow stores and families, the deep witness (`deep()`), `snapshot`, the `ownKeys`/`getOwnPropertyDescriptor`/`defineProperty` traps, `optimisticOwnDescriptor`, `latestView`, a derive that writes its draft (the write override's `mutate`, `pairRows`), `wrapCommit`/`aroundDraftWrite`, and a user's `reconcile` on an optimistic store (`reconcileDraft`);
- `adoptParked`'s parked flight (only `laneSeams`' unanswered-probe arm parks one);
- the dormant-node sweep and reawakening;
- the dev/observe tiers; owner ids and `_childCount`, context;
- `repeat`/`updateRepeat`, the observe tier's list census (`listChurn`) and the dev name wrapper of `mapArray`;
- the cleanup-error channel (`cleanupError`: no cleanup here throws);
- tracked effects (EFFECT_TRACKED: `_update`'s arm is ported, no op creates one).

For these graphs, Solid's hooks for them are reached but compute nothing.

**Fail-closed panics.** Arms these programs never enter panic with a "not ported" message, so a fuzz run reports `rust-panic` instead of silently diverging:

- reawakening a dormant memo, and the dormant-node sweep;
- a verdict window inside a pass (three arms in `verdict.rs`), and `observeFlight`;
- a `NotReadyError` rejection of a loading node;
- applying a staged error as a value, a lane seam over one, and a lane read serving one (seed 629, above);
- each store arm in the list above (the message names it);
- `txOf` of a held node with no transaction (the suspected Solid bug above: Solid throws a `TypeError` there);
- in the driver: a key function over an `undefined` row (the array-hole family: Solid's `x => x.id` throws), and the `message` of a thrown string read where JS gives `undefined`.

In slice 2c only the driver's key-function arm fires (the 15 invalid programs). Before that, only the lane-read arm fired (seed 629). None fired in the other 2999 slice-2a seeds, in 3000 slice-1 seeds, in the 8000 slice-2b seeds bar the 4 the suspected bug makes invalid, in 4600 probe programs or in the like scenario. The take and `undefined`-effect-value cuts of the earlier slices are ported now (slice 2b reaches them).

**Errors.**

- Errors are `Rc<Thrown>` objects compared by identity, as Solid compares `_error`.
- A render effect's error with no boundary halts reactivity in Solid (`escalate` → `haltReactivity`, then a throw). The port records the message in `Runtime::errors` instead, and the plan evaluator fails the run on it. A fuzz program that reaches this is invalid on the reference (`oracle-halted`), and the slice-2a generator avoids it.
- A user effect without an `error` handler (`console.error`) is recorded the same way.

**One struct holds all state.** JS module state is the `Runtime` struct. Effect callbacks are data (`QueueCallback::RunEffect`, `::ReleaseQueues`).

**Explicit microtasks and promises.** The JS promise layer is an explicit FIFO of microtasks:

- `Flush`;
- `Resume` and `Settled` (actions);
- `Landing` (an async memo's reaction);
- `Waiter` and `Deliver` (`refresh`).

A host flight is a `Flight`: one JS promise that settles once. Its reactions (action resumes and memo reactions) are queued in registration order when it settles, or at once when it already has, as `.then` on a settled promise does. A rejection is one `Error` object shared by every reaction.

The host drains the queue and then calls `flush()`, as `fuzz/solid.mjs`'s `drain()` does. The refresh promise is not modelled: nothing awaits it, and its no-op reactions change no observable order.

**Compute bodies.** A computed's `_fn` is `Body::User(BodyFn)`, `Body::Waiter` (the refresh waiter's body, with no closure) or `Body::Projection` (a derived store's derive, around the user's derive body). `BodyFn` returns `Out::Value` or `Out::Flight(name)` (a promise) and throws `Error`, so a read's `NotReadyError` keeps its identity and source. The slice-1 `ComputeFn`/`EffectFn` API (integers, `Option<i64>` for `undefined`) is wrapped. A derive pass's closure state (`first`, the shadow, the draft, the key: what its flight's `commit` and `onError` close over) is a `ProjPass`, registered with the flight's reaction (`Microtask::Landing`).

**Generator bodies.** JS generators are `ActionBody::step(rt, Resume)` returning `Yield(flight)`, `Return` or `Throw`. Async generators are not ported.

**Lists.** `MapData`'s JS arrays: `_items` and `_mappings` are `JsObj` arrays (`_mappings`' identity is the change signal, `_items` keeps holes), the bookkeeping and stage arrays (`_nodes`, `_rows`, `_indexes`, `tempNodes`) are `Vec<Option<NodeId>>`, and `newIndices` is a `Map` kept as a vector in insertion order (keys compared with `===`; lists are small). The mapper, key function, list accessor and fallback are host closures (`MapFn`, `KeyFn`, `ListFn`, `FallbackFn`); a mapper argument is a raw value or an accessor (`MapArg`). `_disposal` is a `Vec` of `FnOnce` cleanups (a single function and an array of one run alike). A user comparator is an index into `Runtime::comparators` (`Equals::User`).

**Values.** A value is a JS value (`value.rs`): `undefined`, a boolean, an integer, a raw object or array (an `Rc`, compared by identity, with JS property order and the `$OWNER` stamp), a store proxy (one per target, compared by target), a projection draft wrapper, a `LaneView`, a prototype function (`constructor` and the array methods the ops call, `slice` included, as a store's `get` trap answers them), a host function value (`Builtin::Host`: a For accessor a Show hands out, compared by identity; the renderer tier's function values, `function.rs`, are of this kind), Solid's `NOT_PENDING` sentinel where JS assigns it as a value (`laneStage`'s `el._value = display(el)`), and, since the renderer tier ([RENDERER.md](RENDERER.md)), a string (`Value::Str`, `===` by content) and a renderer host node (`Value::Node`, by identity). Raw objects carry ids; the WeakMaps keyed by them (`storeLookup`, `fam.map`, `frameRaws`) are maps by id. `Symbol.asyncIterator` is `Key::Sym`. An Error used as a value cannot be represented: the one site where Solid makes one is a fail-closed panic (seed 629). Comparators are `isEqual`, an effect's `false`, and the store's `slotNodeEquals`/`containerEquals`; custom user equality is not ported.

**Proxy traps and JS semantics.** Solid's internal property reads of a value that may be a proxy (a key fn over a row, `valueInserts`, `handleAsync`'s thenable probe) go through `js_get`/`js_has`, so a trap's side effects (`pullFamily`, `readSource`'s staging reads, node creation) happen as in JS. Reads of a backing (always raw) are direct.

## Evaluator and host boundary

`plan.rs` deserializes data-only expressions into compute closures over runtime nodes. Each action becomes an `ActionBody`: an instruction stack with explicit blocks, locals and catch frames.

- An await asks a `HostRegistry` function for a flight ID and yields it. No source code is executed.
- A rejection is thrown in at that yield point. So an empty catch completes normally, while its unconfirmed guess is corrected at the body's end (`laneCorrections`).
- `click` and `settle` drain the microtasks, then flush.
- Evaluator failures, render errors and uncaught rejections fail the run.

`scenario.rs` and `renderer.rs` are unchanged.

`src/bin/slice1-driver.rs` mirrors `fuzz/solid.mjs` for the four slices:

- signals (plain and optimistic, any JSON value);
- memos, with an optional flight prefix and loading value, and optimistic memos (`createOptimistic(fn)`, its setter registered);
- render effects, and user effects with a logged `error` handler;
- writes, reads, `latest`, `pending` and `refresh` (of a node or a store), and their expression forms;
- flushes, actions (legacy slices, and extended ones with `steps`, the yielded value as `sent`, and `catch`), resolve/reject and `drain`;
- the tier-B ops: `store` (plain, optimistic, derived optimistic), `store_set` (path edits with `{key, is}` segments and `miss`, `returns`, `reconcile`), `update` (a functional updater, logged);
- every expression of `evalExpr`/`evalExprB`: `read`, `add`, `mod`, `choose`, `untrack`, `fail`, `prev`, `store`, `get`, `has`, `len`, `eq`, `not`, `elem`, `pos`, `filter`/`count`/`find`/`replace` (an index loop, or `native` with ECMA-262's `Get`/`HasProperty`/`ArraySpeciesCreate` sequence through the traps), `obj`, `arr`, `lit`, `plain`, `arg`, `sent`, `draft`;
- the dynamic expression context `CX` (`within`), and the log encoding: `out`/`enc` (identity tokens numbered in first-logged order, children before their record) and `lg` at the legacy sites.

- tier C (`childC`, `makeList`, `makeShow`, `childPass`, `memoC`, `effectC`): the `owner`/`cleanup`/`dispose` ops (`makeOwner`: a detached root disposed by a cleanup on its parent; `owned(o.owner, …)` on every op that names one), `list` (mapArray with the mapper's exact arity; For: the owner captured at the op, the mapArray created on the first call, a labelled host function value), `show` (`conditionValue`, `condition` with `!a === !b` and `sync`, the outer `sync` memo; element children built in the pass, function children under `untrack` with the narrowed accessor, keyed children with the raw value), memo/effect `children` and `cleanup` (built untracked, then the pass cleanup), the row/child kinds (`effect`, `memo`, `list`, `show`, `cleanup`, `read`), the context `{row, scope}` with `item`/`index`/`local`, `call`, `concat`, `reverse`, `moveKey`, and the `row`/`fallback`/`branch` events and `{f}` encoding.

Laziness of memos and the legacy `equals` option stay outside its op set.

The driver parses programs with `serde_json`'s `preserve_order` feature (`crates/runtime/Cargo.toml`; it adds `indexmap` to `Cargo.lock`): a JSON value's keys and an `obj` expression's fields keep their order, which is JS's insertion order — it orders a record's properties, the store's key walks and the `{r, v}` encoding.

## Debugging aid

`SLICE1_TRACE=1 target/debug/slice1-driver` prints scheduler events to stderr, interleaved with the trace. [slice2b-fuzz/tools/trace-copy.mjs](slice2b-fuzz/tools/trace-copy.mjs) builds an instrumented copy of the Solid source in `out/solid-trace` that prints the same lines (slice 2b adds store slot nodes to the node labels, and `SS` setSignal / `IS` insertSubs events; the 2a copy is [slice2a-fuzz/tools/trace-copy.mjs](slice2a-fuzz/tools/trace-copy.mjs)). [trace-diff.mjs](slice2a-fuzz/tools/trace-diff.mjs) shows the first internal divergence of one program (against the 2b copy: the runtime prints `SS`/`IS` lines too); [slice2b-fuzz/tools/replay-diff.mjs](slice2b-fuzz/tools/replay-diff.mjs) the first differing trace event. The trace check costs one `bool` test when off.

## Reproduce

```sh
cargo test
cargo run --bin scenario -- crates/runtime/tests/fixtures/like.plan.json crates/runtime/tests/fixtures/like.scenario.json
node fuzz/run.mjs --slice2c --seeds 1000 --out out/slice2c-1000
node fuzz/run.mjs --slice2c --start 1001 --seeds 2000 --no-reduce --out out/slice2c-heldout
node fuzz/run.mjs --slice2c --start 3001 --seeds 5000 --no-reduce --out out/slice2c-extra
node docs/slice2c-fuzz/tools/unit-expectations.mjs > crates/runtime/tests/fixtures/slice2c-units.json
node fuzz/run.mjs --slice2c --replay docs/slice2c-fuzz/port/solid-bug-plain-store-hole-4857.json   # oracle-halted
node docs/slice2c-fuzz/port/solid-bug-plain-store-hole.mjs                                        # the same on Solid's API
node fuzz/run.mjs --slice2c --replay docs/slice2c-fuzz/port/hole-view-2723.json                    # agrees: [undefined]
node fuzz/run.mjs --slice2b --seeds 1000 --out out/slice2b-1000
node fuzz/run.mjs --slice2b --start 1001 --seeds 2000 --no-reduce --out out/slice2b-heldout
node fuzz/run.mjs --slice2b --start 3001 --seeds 5000 --no-reduce --out out/slice2b-extra
node fuzz/run.mjs --slice2a --seeds 1000 --out out/slice2a-1000
node fuzz/run.mjs --slice2a --start 1001 --seeds 2000 --no-reduce --out out/slice2a-heldout
node fuzz/run.mjs --slice1 --seeds 1000 --out out/slice1-1000
node fuzz/run.mjs --slice1 --start 1001 --seeds 2000 --out out/slice1-heldout
node fuzz/run.mjs --slice2a --replay docs/slice2a-fuzz/port/reduced-rust-panic-629.json
node docs/slice2a-fuzz/tools/unit-expectations.mjs   # the traces in tests/fixtures/slice2a-units.json
node docs/slice2b-fuzz/tools/unit-expectations.mjs > crates/runtime/tests/fixtures/slice2b-units.json
node fuzz/run.mjs --slice2b --replay docs/slice2b-fuzz/port/solid-bug-take-held.json   # oracle-error
node docs/slice2b-fuzz/port/solid-bug-take-held.mjs                                     # the same on Solid's API
```

Validation:

- `cargo test`: **114 tests pass** (the 80 below; 19 of the renderer tier, [RENDERER.md](RENDERER.md): 13 in `tests/render.rs`, 11 Solid-logged renderer programs and 2 API tests, and 6 in `tests/strings.rs`, 4 Solid-traced string programs and 2 API tests; and the 15 plan v2 tests in `tests/tracker.rs`, [PLAN-V2-CONSUMER.md](PLAN-V2-CONSUMER.md)).
  - 2 library tests, M1's 15, and the 10 slice-1 tests.
  - 11 slice-2a tests (`tests/slice2a.rs`).
    - Nine run op programs through the driver and compare Solid's traces: first load holding a render effect, rejection to an error handler, loading values, same-key promise reuse with `refresh`, an action entangled with a flight, chained async memos, linked lanes, the pass-scoped transaction, and a staged error.
    - Two call the API directly: loading versus pending, settle-once, and stale-while-revalidate.
  - 17 slice-2b tests (`tests/slice2b.rs`).
    - Sixteen run op programs through the driver and compare Solid's traces ([slice2b-fuzz/tools/unit-programs.json](slice2b-fuzz/tools/unit-programs.json)): plain-store notifications (leaf, presence, container, delete, move), keyed and positional reconcile and adoption, a key held by an action beside a mainline write, `take` of a guessed memo by another action's lane, a taken guess restored at the taker's revert, a truth landing beneath a guessed memo (`laneOutcome`), a row guess reverting at the body's end, a push guess (presence, arrangement), linked lanes over one store, a derived store's first load/refresh/new question, an older answer re-basing a keyed arrangement guess (#4525), a current truth folding beneath one, a derive re-asking in another action's lane (`_slotTake`, kept guesses), a guess standing in for its family's flight, a staged derive rejection, and the tracker demo script. The mechanism programs come from fuzz seeds reduced while they reach the site ([mark-reduce.mjs](slice2b-fuzz/tools/mark-reduce.mjs), [check-marks.mjs](slice2b-fuzz/tools/check-marks.mjs)), with observations appended.
    - One calls the API directly: proxy identity, a write outside the setter ignored, the committed frame before the flush, a positional reconcile keeping a row's proxy (checked with the same calls on `dist/prod`).
  - 25 slice-2c tests (`tests/slice2c.rs`).
    - Twenty-four run op programs through the driver and compare Solid's traces ([slice2c-fuzz/tools/unit-programs.json](slice2c-fuzz/tools/unit-programs.json)). Twenty are fuzz seeds reduced while they reach one site ([mark-reduce.mjs](slice2c-fuzz/tools/mark-reduce.mjs)): Show parking its previous frame, a staged pass's children dying on the spot, a dirtied zombie deferred, a lane frame member's dirty cancelled, a held pass holding its frame, a surviving zombie re-run at commit, the commit retiring the parked frame, a zombie whose removal the hold stages, a staged removal taking a zombie off screen (seed 980, also reduced while `removal_staged_by` forced to false still disagrees, `--disagree`; it fails under that mutant), a lane dissolve and a lane seam retiring a frame, a parked frame dying with its owner, mapArray's create-all abort, keyed abort and retry (#2903), small move and its duplicate decline, a shallow store's view, the fallback, index rows and index signals. Three are hand-written (owners, cleanups in LIFO order and disposal; a function-child Show's narrowed accessor; a keyed Show with a For), and one is the tracker demo with Show + For (8 frames).
    - One calls `map_array` directly: an unchanged arrangement keeps the mapped array, a reorder reuses rows, removals dispose them (the same calls on `dist/prod`).
- `cargo fmt --check`, `git diff --check` and `cargo clippy --all-targets` are clean.

## Fuzz scope

- `generate-slice1.mjs` is unchanged. It generates scalar sources (including optimistic), one render effect, ordinary and optimistic writes, reads, two-slice actions, flushes, resolves and rejects, with three actions per seed.
- `generate-slice2a.mjs` adds the following (families and rationale in [SLICE2A-COVERAGE.md](SLICE2A-COVERAGE.md)):
  - async memos over flights, with same-key promise reuse and loading values;
  - chained async memos and derived memos;
  - `refresh`, and `latest`/`pending` probes;
  - rejected memo flights, read by user effects with error handlers;
  - actions that feed or await memo flights;
  - a second optimistic signal (linked lanes).

- `generate-slice2b.mjs` (tier B, [SLICE2B-COVERAGE.md](SLICE2B-COVERAGE.md)) adds plain stores (path edits, `returns`, `reconcile`), stores in actions, optimistic memos over store rows, optimistic stores with per-row claims, derived optimistic stores over a server model, provenance (older answers under newer guesses) and the tracker demo's shape.
- `generate-slice2c.mjs` (tier C, [SLICE2C-COVERAGE.md](SLICE2C-COVERAGE.md)) adds mapArray/For lists in every keying mode and arity (over int signals, plain, shallow and optimistic stores, optimistic memos, nested lists, 66–100-row windows), Show (element, function and keyed children), children and cleanups built inside memos and effects, owners and their disposal, and the tracker with Show + For.

Excluded from all four: laziness of memos, the legacy `equals` option, tracked `latest`/`isPending`, `repeat`, `Switch`/`Match`, `children()`, and boundaries.

History:

- slice 1: `3911d2e` 5/1000, then `2752ca0` 7/1000, then `147d971` 1000/1000.
- slice 2a: `147d971` 0/1000 (every program panicked at its first async memo), then the 2a port 991/1000.
- slice 2b: the 2a port 0/1000 (every program panicked at its first `store` op), then the 2b port 884/1000 at its first run and 1000/1000 with `setSignal`'s custom comparators.
- slice 2c: the 2b port 0/1000 (every program panicked at its first `list`, `show` or `owner` op or shallow store), then this port 978/1000 at its first run (21 shallow-store panics, 1 invalid) and 999/1000 with shallow stores (every valid program).

## Next risks

- **Tracked verdict readers.** `latest`/`isPending` inside a computation make it a verdict reader: CONFIG_VERDICT, verdict lanes, `route`, `watchVerdict`, `observeFlight`, `ahead`/`entered`, `holdStaging`. These arms panic here. They need an expression form of `latest`/`pending` in the op language (an additive op) and the same coverage-first method.
- **Tier C sites that are thin or unobservable.** `removalStagedBy` runs in 6 seeds of 1–1000; making it always false changes the trace of seed 980 only, and of its seed-980 unit program, not of the seed-37 one; a parked frame dying with its owner (3 seeds), a lane dissolve retiring a frame (2), zombies re-run at a commit (8), the small-move duplicate decline (2) and the #2903 abort (3) are thin. `adoptParked`'s parked flight, the zombie park's CONFIG_VERDICT recompute and promoted writes are ported or constant but never taken. Not in the op language: `repeat`/`Repeat`, `Switch`/`Match`, `children()`, boundaries, hydration.
- **Store arms tiers B and C do not reach** (fail-closed here): a derive that writes its draft after an `await` (`pairRows`, D-34 per-key pairing, the write override's `mutate`), a user's `reconcile` on an optimistic store, `ownKeys`/descriptor reads (`optimisticOwnDescriptor`, `membershipChanged` over an observed key set), `latestView`, `deep`/`snapshot`, shallow derived families, accessors, prototype overlays (records over 32 keys) and chained stores. `laneOutcome`'s stale arm and a lane seam over a staged error are ported but never run.
- **The array-hole family** makes some optimistic and held plain-store list programs invalid; a fix upstream changes those traces, and the driver's fail-closed key function there would become a path to compare.
- **What a Rust renderer still needs for the full tracker end to end** (`frontend/tsx/fixtures/demo/tracker.tsx`; the runtime side of every reactive step it takes is ported and fuzzed through the op encoding, the 8 demo frames included):
  - the plan language (`plan.rs`, `scenario.rs`): stores and store paths, `createOptimistic(fn)` over a store list with a functional updater (`list.map(...)` building fresh rows), memos with `filter`/`length`, Show/For in the markup (today a plan's markup is static elements and text over integer equations), actions whose awaited host value is written into a store path, and per-row event handlers bound to the row's item (`onAssign={() => claim(issue.id)}`);
  - strings as values: done in the renderer tier (`Value::Str`, [RENDERER.md](RENDERER.md) "Strings"; `--strings` fuzz);
  - the renderer side: done as a port of Solid 2's `@solidjs/universal` (`insert`, `reconcileArrays`, `normalize`/`flatten`), `Show`, `For` and `createComponent` ([RENDERER.md](RENDERER.md); `--render` fuzz); `spread`/`mergeProps`/`ref` are not ported;
  - event delegation and handlers with arguments: done as a port of `@solidjs/web`'s delegation (`[handler, data]` tuples, `handler(data, event)`), [RENDERER.md](RENDERER.md) "Events";
  - `assignIssue` as a host function returning a promise of a string, and rejections carrying the error message the catch formats.
- **The suspected Solid bug** (`take` of a held slot) makes some `nav`-variant derived-store programs invalid; any fix upstream changes those traces, and the port's fail-closed panic there would become a path to port.
- **Lazy async memos and dormant reawakening.** These are excluded because of the parked oracle hang and the `deleteFromHeap` TypeError.
- **JS values.** Strings are values now ([RENDERER.md](RENDERER.md)); Error objects as values are still not representable: the Error-as-value traces of the 2a invalid seeds and of seed 629 stay out of reach.
- **Reclamation.** Transaction, lane, link-group and pending-source-set records are never reclaimed (arena indices). This is fine for tests, not for a long-running host.
