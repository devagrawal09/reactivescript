# Slice 1: resolved like plan → Rust text frames

## Status

The slice runtime is now a **structural port of the Solid scheduler paths this slice reaches**: transactions, lanes, pending/held queues, the flush and its seam, the speculative compute passes, the effect queue split, and `setSignal` hold/join/equality. It lives in `crates/runtime/src/slice1/`. The call map is in [SLICE1-PARITY.md](SLICE1-PARITY.md).

Results on the existing exact-trace fuzzer (unchanged worker oracle, generator and comparator; no filtering or normalization):

- Seeds 1–1000: **1000/1000 exact traces agree**, 0 invalid.
- Held-out seeds 1001–3000: **2000/2000**, 0 invalid.

The like scenario still gives native frames `0`, `1`, `0`, `1`, `1`. Run summaries are in [slice1-fuzz/parity](slice1-fuzz/parity/).

## Placement

The port is a separate module, **beside M1**. `crates/runtime/src/slice1/` replaces the earlier `slice1.rs`, which wrapped M1's graph with ad-hoc parking and flush logic. The new module reuses nothing from `lib.rs`: M1's dependency graph, effect queue and scheduler have different semantics (no seam, no stashed queues, no lane passes). M1 and its 15 tests are untouched.

Read-only source: Solid `2105ffb8ca2fced55f5fac0763177fc93f97c2c2`, rc.21, `packages/signals/src/core/`. One Rust file per Solid file. Every ported function has a `// Solid: file.ts:lines` comment, and module-level `let`s become fields of `Runtime` (`mod.rs`).

## Source correspondence

| Solid | Rust (`crates/runtime/src/slice1/`) |
| --- | --- |
| `types.ts` `Signal`/`Computed`/`Owner`; core.ts:1259-1279 `NodeExtension` | `mod.rs` `Node`. The extension fields are inlined: an absent extension and a default one behave alike on every ported path. |
| `constants.ts` flag bits | `mod.rs` `REACTIVE_*`, `CONFIG_*`, `STATUS_*` (same values) |
| scheduler.ts:266-327 `Transaction` | `mod.rs` `Transaction`: nodes, queues, reruns, into, parent, lane, open, acted, shown, held |
| scheduler.ts:330-449 `newTransaction`, `txOf`, `liveTx`, `resolveTx`, `joinFuture`, `merge` | `scheduler.rs` same names |
| scheduler.ts:466-568 `blocked`, `ownFlights`, `blockedBy` | `scheduler.rs` (`blocked_by` is constant false: see deviations) |
| scheduler.ts:599-629 `heldTrim`, `holdNode`, `list` | `scheduler.rs` |
| scheduler.ts:735-787 `enterAction`/`exitAction`, `setQuestion`/`nextQuestion`, `schedule` | `scheduler.rs`. `schedule` pushes `Microtask::Flush` |
| scheduler.ts:935-974 `GlobalQueue.flush` | `scheduler.rs` `global_flush` |
| scheduler.ts:981-1168 `settle` (corrections, guesses, park/commit, lane seams, landings, queue order) | `scheduler.rs` `settle` |
| scheduler.ts:1169-1184 `run`, `enqueue` (lane work → the lane's queues) | `scheduler.rs` `run`, `enqueue` |
| scheduler.ts:1235-1332 `reruns`, `land`, `releaseQueues` | `scheduler.rs` |
| scheduler.ts:1351-1479 `staleReader`, `queuePendingNode`, `insertSubs`, `laneDirty`, `queueEffectRun`, `sameLane` | `scheduler.rs` |
| scheduler.ts:1482-1571 `applyStaged`, `commitPendingNode(s)` | `scheduler.rs` |
| scheduler.ts:1608-1707 `flush`, `runQueue` | `scheduler.rs` `flush_all`, `run_queue` |
| core.ts:201-224 `GlobalQueue._update`; 364-1090 `recompute` (seat, held re-pass, staging/publish/lane slot, effect enqueue, `heldTrim`, pending queue) | `core.rs` `update`, `recompute` |
| core.ts:1092-1137 `updateIfNecessary`; 2028-2044 `pullComputed` | `core.rs` |
| core.ts:1144-1253 `computed`; 1452-1566 `createEffectNode`; 1590-1616 `setupComputedNode`; 1618-1662 `signal` | `core.rs` |
| core.ts:1292-1420 `joinPass`, `frameRead`, `bornInto`, `creatorPass`; scheduler.ts:397-403 `joinPassTx` | `core.rs` |
| core.ts:1984-2023 `unflushedValue`, `stashFlushed`, `resyncUnflushedCompanions` (A28) | `core.rs` |
| core.ts:2106-2447 `read`; 2469-2523 `serve`; 2557-2570 `stagedRead` | `core.rs` `read_node`, `serve`, `staged_read` |
| core.ts:2680-2797 `isSame`, `setSignal` (join a hold before the equality gate; a fresh no-op queues nothing; stash a held rewrite) | `core.rs` `is_same`, `set_signal` |
| truth.ts:23-29 `laneValueOf` | `lanes.rs` `lane_value_of` |
| lanes.ts:119-200 `newLane`, `display`, `guessedValueOf`, `pendingGuessOf`, `optimisticWrite` | `lanes.rs` |
| lanes.ts:220-273 `applyGuesses`; 1049-1052 `applyGuessesAt` | `lanes.rs` |
| lanes.ts:283-347 `enterLane`, `under` | `lanes.rs` |
| lanes.ts:408-492 `laneStage`; 510-542 `supersede`; 554-695 `dissolveLane` | `lanes.rs` |
| lanes.ts:716-832 `laneRead`, `covered`, `guessFlights` | `lanes.rs` |
| lanes.ts:847-962 `laneCorrections`, `laneSeam`, `endLanes`, `lanesBlocked`, `nestedBlocked` | `lanes.rs` |
| lanes.ts:969-1042 `laneWrite`, `laneOutcome`, `stale`, `answered` | `lanes.rs` |
| lanes.ts:1082-1215 `readsHeld`, `laneSeams` | `lanes.rs` |
| effect.ts:70-121 `effect`; 186-286 `runEffect` | `effect.rs` |
| action.ts:38-48 `inTransaction`; 127-245 `action` (`done`, `step`, `run`) | `action.rs` `resume_action`, `action`, `action_done`, `step_action` |
| heap.ts (whole file) | `heap.rs` |
| graph.ts:23-100 `unlinkSubs`, `trimStaleDeps`, `clearDeps`, `unobserved`; 149-190 `link` | `graph.rs` |
| owner.ts:95-210 `disposeChildren`, `linkChild`; 366-496 `createRoot`; core.ts:2868 `runWithOwner` | `owner.rs` |
| signals.ts:413-475, 519, 648 `createSignal`, `createOptimistic` (value and fn), `createMemo`, `createRenderEffect` | `mod.rs` / `effect.rs` public API |

## Deviations from Solid's structure, and why

- **Not ported, because the slice keeps them constant.** Each is noted at its site:
  - flights and STATUS_PENDING (`handleAsync`, pending sources, `blockedBy` candidates, `inFlight`, `guessFlights`);
  - verdict windows (`_verdict`, CONFIG_VERDICT, `ahead`/`entered`);
  - linked lanes (`_links`);
  - `take`/`kept`/`reverted`;
  - stores and slots, boundaries, `affects()` marks, snapshots;
  - staged errors (D-41);
  - parked child frames, zombies and `holdFrame`;
  - the dev/observe tiers.

  For this graph, Solid's hooks for these are reached but compute nothing (listed in SLICE1-PARITY.md).
- **Fail-closed panics.** Four reachable-in-principle arms that the slice never enters panic with a "not ported" message, so a fuzz run reports `rust-panic` instead of silently diverging: `joinPassTx`'s pass-scoped transaction, `linkLanes`, `take`, and reawakening a dormant memo. None fired in 3000 fuzz seeds, 4600 probe programs or the like scenario.
- **Errors are simplified.** A failing computation records the error (`STATUS_ERROR`), leaves the value unpublished and fails the plan run. There are no error boundaries or effect error handlers.
- **One struct holds all state.** JS module state is the `Runtime` struct. Effect callbacks are data (`QueueCallback::RunEffect`, `::ReleaseQueues`).
- **Explicit microtasks.** The JS promise layer is an explicit FIFO of `Microtask::{Flush, Resume, Settled}`, so `queueMicrotask(flush)`, flight reactions and the action promise's `.then` keep JS order. The host drains it and then calls `flush()`, as `fuzz/solid.mjs`'s `drain()` does.
- **Generator bodies.** JS generators are `ActionBody::step(rt, Resume)` returning `Yield(flight)`, `Return` or `Throw`. Async generators are not ported.
- **Values.** Values are `i64` with `Option` for `undefined`. Equality is the default comparator only (effects use `_equals: false`).

## Evaluator and host boundary

`plan.rs` deserializes data-only expressions into compute closures over runtime nodes. Each action becomes an `ActionBody`: an instruction stack with explicit blocks, locals and catch frames. An await asks a `HostRegistry` function for a flight ID and yields it; no source code is executed. A rejection is thrown in at that yield point, so an empty catch completes normally while its unconfirmed guess is corrected at the body's end (`laneCorrections`). `click` and `settle` drain the microtasks, then flush. Evaluator failures, render errors and uncaught rejections fail the run.

`scenario.rs` is unchanged. It registers the declared hosts with call-order IDs (`save:1`, `save:2`) per mount, validates arity and numeric signatures/results, rejects duplicate or unknown settlements, and rejects requests still pending at the end.

`renderer.rs` is unchanged. Frames concatenate text node bytes, with no escaping, trimming, separators or hidden frame filtering.

## Reproduce

```sh
cargo test
cargo run --bin scenario -- crates/runtime/tests/fixtures/like.plan.json crates/runtime/tests/fixtures/like.scenario.json
node fuzz/run.mjs --slice1 --seeds 1000 --out out/slice1-1000
node fuzz/run.mjs --slice1 --start 1001 --seeds 2000 --out out/slice1-heldout
node fuzz/run.mjs --slice1 --replay docs/slice1-fuzz/final/reduced-scalar-actions-compute-effect_cleanup.json
```

Validation:

- `cargo test`: **27 tests pass**: 2 library tests, M1's 15, and 10 slice tests. The slice tests cover the like scenario, wrong frames, duplicate settlement, render errors, held write vs lane, updater composition, same-tick actions, the equality/join rules, and the staged-truth-then-lane compute order. Their expected values were checked against Solid with `docs/slice1-fuzz/parity/tools/unit-expectations.mjs`.
- `cargo fmt --check`, `git diff --check` and `cargo clippy` are clean.
- The frontend integration test in `slice1-plan` (`RUST_SCENARIO=…/scenario`) lives outside this worktree and was not rerun. The `scenario` binary's interface is unchanged.

## Fuzz scope

`generate-slice1.mjs` is unchanged. It generates scalar sources (including optimistic), one render effect, ordinary and optimistic writes, reads, two-slice actions, flushes, resolves and rejects, with three actions per seed. Excluded: stores, lists, async memos, refresh, custom equality, loading/pending probes, owner changes, and overlapping actions.

The private probe in SLICE1-PARITY.md reaches transaction merges, landing reruns, held-lane screen reads, re-guesses, memos, user effects and up to three overlapping actions. It agrees on all 4600 programs. That is evidence, not an official score.

History:

- `3911d2e`: 5/1000.
- `2752ca0` (ad-hoc slice): 7/1000, with classes compute/read 105 and compute/effect_cleanup 888.

Both old reduced cases now agree. [slice1-fuzz/README.md](slice1-fuzz/README.md) records the historical artifacts.

## Slice 2 risks

- Async memos, `refresh`, loading probes, verdict windows (`latest`/`isPending`) and linked lanes are the next Solid paths. Each is cut at a marked site in `slice1/` (STATUS_PENDING, CONFIG_VERDICT, `_links`). They need the same coverage-first method.
- Lists need ownership, keyed identity, node moves and disposal, plus lane-aware child frames. The parked-frame machinery (`parkChildren`, zombies, `holdFrame`) is not ported.
- Stores need per-slot truth/pending/lane state and the store hooks that are inert here.
- Per-row optimistic writes need question provenance across actions, `take`/revert/rebase, and independent flights.
- Transaction and lane records are never reclaimed (arena indices). This is fine for tests, not for a long-running host.
