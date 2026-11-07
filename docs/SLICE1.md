# Slice 1: resolved like plan → Rust text frames

## Status

The like scenario passes with freshly emitted plans from RX, TSX and yield TSX. Exact native and Rust frames: `0`, `1`, `0`, `1`, `1`. This does **not** establish signals-level parity: the scalar subset fuzzer finds compute/effect trace differences. No logs are filtered and no expectations are changed.

## Placement and source correspondence

The port is **beside M1**, in `crates/runtime/src/slice1.rs`. It uses M1's dependency graph, memo computations and effect queue, but not M1's `Transaction`, action execution, guessed-value rollback map, or transaction scheduler. This separation keeps existing M1 tests unchanged and makes the narrow port independently fuzzable through `slice1-driver`. It is not a complete structural port of Solid's graph/effect scheduler.

Read-only source: Solid `2105ffb8ca2fced55f5fac0763177fc93f97c2c2`, rc.21, `packages/signals/src/`. Source correspondence verified against code (not just the supplied notes):

| Solid | Rust slice |
| --- | --- |
| `signals.ts:458–475`, `createOptimistic(fn)` creates a computed and binds `optimisticWrite` | `optimistic`: real seed memo; a presentation memo chooses truth or lane. The two graph memos represent the two views; they are not independent committed source values. |
| `core/action.ts:152–164,188–250`, open/acted transaction, generator `next`/`throw`, resume through `inTransaction` | `begin_action`, `finish_action`, `plan::App::run/settle`: a suspended instruction stack retains its transaction, catch stack and locals; settlement rejoins it and flushes the resumed slice. |
| `core/scheduler.ts:260–347`, `Transaction`, `newTransaction` | `Transaction`: nodes, into, parent, lane, open, acted, shown. Lane/effect queues, reruns and verdict links outside this scalar path are **not ported**. |
| `core/scheduler.ts:414–451`, `resolveTx`, `joinFuture`, `merge` | `resolve_tx`, `join_future`, `merge`: follow merged transaction links, merge same-tick action work, add open counts, append held nodes; lanes do not merge as peers. |
| `core/scheduler.ts:616–630`, node ownership/listing | `list`: held source records the owning transaction; transaction owns its node list. |
| `core/core.ts:2693–2742`, `setSignal` | `write`: an existing hold joins before equality; a fresh equal write does not queue a node or acquire a hold. Two regression tests distinguish these cases. |
| `core/lanes.ts:137–209`, pendingGuesses, `guessedValueOf`, `optimisticWrite` | pending guess triples; updater reads the latest queued guess, then lane, then truth; writes do not overwrite truth. |
| `core/lanes.ts:220–280`, `applyGuesses` | `apply_guesses`: route guesses to a lane under the action transaction, or discard an unheld guess. Reuse the lane for other guesses in the same pass. |
| `core/lanes.ts:872–904`, `laneSeam` | scalar lane reveal at flush; no async computed blockers exist in this slice. |
| `core/lanes.ts:554–630,906–942`, `dissolveLane`, `endLanes` | `end_lanes`: clear the guess/override and re-derive from truth; do not restore a captured stale value. |
| `core/scheduler.ts:1093–1137`, landing and release ordering | `flush`: park ordinary writes while open; publish held writes on closure, end lanes, then run graph effects. **Speculative truth/lane compute passes and separate held callback queues are not yet represented**, which the full-log fuzz comparison exposes. |

Node state has separate committed truth (M1 graph node), `pending_value`, `lane`, `transaction`, `guess` and question stamp. The graph presentation uses an override flag and lane-value signal to keep dependency tracking real. Optimistic truth is a memo, so a server answer different from the guess corrects the text; an equal answer leaves the text unchanged.

Question stamps are currently monotonic at optimistic writes rather than fully restoring the action's question across all nested callbacks. The example has one optimistic write per invocation, so it does not distinguish these. General question provenance, take/revert/rebase, per-row lanes and nested async computations remain outside this port.

## Evaluator and host boundary

`plan.rs` deserializes data-only expressions into closures over real runtime nodes. The action interpreter has explicit blocks, local values and catch frames. Await asks a `HostRegistry` function for a flight ID; no source code is executed. Rejection is delivered at that wait point, so an empty catch completes normally while its unconfirmed guess disappears.

`scenario.rs` registers the declared hosts with call-order IDs (`save:1`, `save:2`), per mount. It validates arity, requires supported numeric signatures/results, rejects duplicate or unknown settlements, and rejects requests still pending at the end. This runtime currently supports integer expressions, not every scalar type allowed by scenario v1; unsupported types fail explicitly.

`renderer.rs` defines create_element/create_text/replace_text/set_prop/insert/remove/parent/next_sibling/event. `TextRenderer` stores a tree and handler IDs. Frames concatenate text node bytes; tags, attributes and events add no text. No escaping, trimming, separators or hidden frame filtering. Click enumeration is depth-first over live click handlers.

## Reproduce

```sh
cargo test
cargo run --bin scenario -- crates/runtime/tests/fixtures/like.plan.json crates/runtime/tests/fixtures/like.scenario.json
# Fresh frontend → checker → plan → Rust gate, from slice1-plan:
YIELD_FRONTEND=../slice1-js RUST_SCENARIO=/Users/devagr/rx-tsx-refresh/rust-solid/target/debug/scenario node --experimental-strip-types --test plan/plan.test.ts
# Same existing worker oracle, comparator and reducer; new runtime adapter:
node fuzz/run.mjs --slice1 --seeds 1000 --out out/slice1-1000
```

The Rust fixture is a byte copy of the emitted plan and native scenario. Cargo tests cover that scenario, wrong expected frames, duplicate settlement, held writes, a server answer differing from the guess, updater composition, and two same-tick actions. The frontend integration tests verify all three fresh outputs, not just this saved fixture.

## Fuzz scope

`generate-slice1.mjs` keeps the existing JSON operation protocol and seeded RNG. It generates scalar sources (including optimistic), render effects, ordinary and optimistic writes, reads, action slices, flushes, resolves and rejects. Each seed has three actions, with varied ordinary writes before and during holds. Excluded: stores, lists, async memos, refresh, custom equality, loading/pending probes, owner changes, and nested/overlapping action generation. The original generator/oracle remain available unchanged without `--slice1`. No expected/actual event is dropped.

Final run at runtime commit `2752ca0`: **7/1000 exact traces agree (0.7%), 993 diverge, 0 invalid**. Remaining first-difference classes: compute/read (105) and compute/effect_cleanup (888). Both reduced cases expose missing staged-truth computation/held callback work, not a text-format workaround.

The initial run at `3911d2e` had 5/1000 agreement and four classes. A fresh no-op write acquiring a hold caused the effect/effect value mismatch; the source equality gate fixed that. Historical cases and all final reduced cases plus exact traces are checked in under [slice1-fuzz](slice1-fuzz/README.md). The full local final corpus remains `out/slice1-verified/`. Reducers now retain each first-difference class.

Validation: **26 Rust tests pass** (15 existing, 11 added); **4 frontend integration tests pass**, with none skipped when `RUST_SCENARIO` is set. `cargo fmt --check` and `git diff --check` pass. The fresh three-frontend test uses sol's committed lowering from `694e509` (worktree now at `158bea5`). The plan copies in frontend, scratch and Rust have the same SHA-256: `d5fb8d4bc7794ddeb1a37af8919e310173e63214916155653e15cb4554072403`.

This establishes the end-to-end frame skeleton, **not the requested complete structural scheduler fidelity**. The M1 graph/effect substrate must be replaced or extended with the missing Solid staging passes before claiming that stronger result. Transaction records are also retained for this small run; lifetime/reclamation is not production-ready.

## Slice 2 risks

- Preserve speculative compute passes and separate lane/held callback queues before trusting effect-level equivalence. A passing text frame alone hides these differences.
- Lists need ownership, keyed identity, node moves and disposal, plus lane-aware child frames. The renderer operations exist; list evaluation does not.
- Stores need per-slot truth/pending/lane state, structural enumeration, and stable identity. Scalar source-wide holds are not a store model.
- Per-row optimistic writes need question provenance, rebase/take/revert, independent flights and correct transaction entanglement. None can be inferred from the single sequential like scenario.
- CP-6 still lacks executable expressions, control flow and markup; the frontend's explicit AST fallback list is in `plan/docs/PLAN.md`.
