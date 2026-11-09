# Status — 2026-11-07

**M1 is incomplete.** The requirement was full async parity from the start. This checkpoint contains a working Rust runtime and differential harness, but does not meet that requirement. Remaining Rust divergences are real bugs / missing semantics, not accepted differences.

## Final result

- Runtime and generator snapshot: 1dbeb4a; isolated-oracle harness: d1f17ba.
- cargo test: **15 passed**, no failed or ignored tests.
- node fuzz/run.mjs --seeds 2000 --out out/isolated-final-2000
- Seeds 1–2000: **1148 exact matches / 2000 = 57.4%**.
- **837 Rust/reference mismatches**, plus **14 oracle timeouts and 1 oracle error**. Oracle failures remain in the 2000 denominator; none count as agreement.
- Every original failure has full logs in the local out/isolated-final-2000 directory. All 13 failure buckets have checked-in reduced programs and logs below.
- Two earlier complete runs matched 966/2000 and 1148/2000. Those are preliminary: a fresh replay exposed shared oracle state in one reduced case. The harness now starts a fresh JS worker for every original and reduced program. The final isolated run independently matched 1148/2000; all 13 new reduced cases reproduced in separate replay commands. See [replay checks](results/replay-check.json). Earlier summaries and repros remain as history, not proof. These are 2000 unique seeds run three times, not 6000 unique seeds.

| Program family | Exact matches |
|---|---:|
| Eager sync graphs | 330 / 333 |
| Async memos (including loading / refresh / rejection) | 285 / 334 |
| Same-tick overlapping actions | 0 / 334 |
| Later overlapping actions | 0 / 333 |
| Handled errors / recovery | 333 / 333 |
| Lazy graphs | 200 / 333 |

In particular, **all 667 generated action programs still fail** exact comparison. Having an action API and passing focused transaction tests is not action parity.

Machine-readable results: [final](results/final-2000.json), [baseline](results/baseline-2000.json). The fuzzer exits 1 when there are failures. The earlier run without timeout isolation stopped at seed 71 and was not counted as a complete run.

## Implemented

- Rc/RefCell single-threaded graph; integer test domain; generic homogeneous Rust value type.
- Staged signal writes; implicit per-turn batching; explicit flush; custom equality.
- Eager and lazy memos, dynamic dependencies, untrack, queued refresh.
- Split compute/apply effects, render vs user order, previous applied values, returned cleanups, defer.
- Owner trees, cleanup/disposal, typed computation failures, effect handlers and basic Rust owner error handlers.
- Controlled one-shot flights; initial loading, pending and latest; loadingValue; late-answer checks; async rejection; cached promise identity.
- Coroutine actions, held source writes, same-tick merging and same-slot joining, plain optimistic signals with base restoration. These are partial mechanisms, not a completed transition system.
- JSON drivers, seeded generator, exact logs, operation coverage, bounded reducer, per-driver time limits and isolated JS oracle workers.

Owner error routing is unit-tested; the differential generator primarily observes effect error handlers. Deep dynamic owner creation inside computation bodies is not generated. No renderer was added.

## Remaining divergence buckets

These labels are mechanical first-difference buckets, not 13 independent root causes. Reduction preserves a mismatch (or the original driver-failure category), but can reach another ordinary mismatch. The broad diagnosis is given without claiming every internal cause has been proven. Each row links a runnable JSON program and exact logs; there is no ignored-failure allowlist.

| Bucket | Seeds | First seed | Broad diagnosis | Reduced repro |
|---|---:|---:|---|---|
| 2-compute-effect_cleanup | 334 | 2 | Same-tick action speculation / optimistic visibility | [program](repros/reduced-2-compute-effect_cleanup.json) · [logs](repros/reduced-2-compute-effect_cleanup.logs.json) |
| 3-compute-effect_cleanup | 333 | 3 | Overlapping action speculation / optimistic visibility | [program](repros/reduced-3-compute-effect_cleanup.json) · [logs](repros/reduced-3-compute-effect_cleanup.logs.json) |
| 5-compute-compute | 84 | 17 | Lazy pull, refresh, or dormant-node scheduling | [program](repros/reduced-5-compute-compute.json) · [logs](repros/reduced-5-compute-compute.logs.json) |
| 1-compute-read | 49 | 49 | Async failure recovery and downstream recomputation | [program](repros/reduced-1-compute-read.json) · [logs](repros/reduced-1-compute-read.logs.json) |
| 5-effect_cleanup-compute | 10 | 59 | Lazy pull, refresh, or dormant-node scheduling | [program](repros/reduced-5-effect_cleanup-compute.json) · [logs](repros/reduced-5-effect_cleanup-compute.logs.json) |
| 5-compute-read | 10 | 65 | Lazy pull, refresh, or dormant-node scheduling | [program](repros/reduced-5-compute-read.json) · [logs](repros/reduced-5-compute-read.logs.json) |
| oracle-timeout | 14 | 71 | Reference stalls in lazy-refresh teardown | [program](repros/reduced-oracle-timeout.json) · [logs](repros/reduced-oracle-timeout.logs.json) |
| 5-read-compute | 11 | 299 | Lazy pull, refresh, or dormant-node scheduling | [program](repros/reduced-5-read-compute.json) · [logs](repros/reduced-5-read-compute.logs.json) |
| 5-effect-compute | 1 | 485 | Lazy pull, refresh, or dormant-node scheduling | [program](repros/reduced-5-effect-compute.json) · [logs](repros/reduced-5-effect-compute.logs.json) |
| 0-compute-compute | 3 | 582 | Dynamic dependency-height / compute ordering | [program](repros/reduced-0-compute-compute.json) · [logs](repros/reduced-0-compute-compute.logs.json) |
| oracle-error | 1 | 1193 | Reference deleteFromHeap TypeError | [program](repros/reduced-oracle-error.json) · [logs](repros/reduced-oracle-error.logs.json) |
| 5-read-read | 1 | 1577 | Lazy pull, refresh, or dormant-node scheduling | [program](repros/reduced-5-read-read.json) · [logs](repros/reduced-5-read-read.logs.json) |
| 5-compute-effect_cleanup | 1 | 1727 | Lazy pull, refresh, or dormant-node scheduling | [program](repros/reduced-5-compute-effect_cleanup.json) · [logs](repros/reduced-5-compute-effect_cleanup.logs.json) |

Replay a program with node fuzz/run.mjs --replay docs/repros/FILE.json. [Fresh-worker replay checks](results/replay-check.json) record whether the saved cases still fail independently.

### Reference failures

The reduced lazy-refresh timeout occurs during root teardown and also reproduces with a **10-second** budget, not just the normal 1.5-second budget. The other reference failure is a TypeError in deleteFromHeap, reached through unobserved / sweepDormant. Both were replayed in fresh workers: [timeout](results/oracle-timeout-recheck.json), [error](results/oracle-error-recheck.json). No Solid files were changed. Rust is not deliberately made to hang or corrupt a heap; these remain unresolved compatibility cases.

## Fixes driven by differential failures

Fixed stale-before-flush refresh behavior; downstream status-only propagation; error callback cleanup timing; memo vs effect equality; deferred first-apply previous values; height-ordered scheduling; lazy previous-value retention and idle release; asynchronous completed flights; repeated promise identity; and old-error visibility during a replacement request. The generator was expanded with loading values, async refresh and rejected memo flights, not narrowed to improve agreement.

## Not implemented / not generated

Full served-reader holds, graph snapshots and optimistic lanes; optimistic memo/source truth confirmation; loading/error boundary trees and reveal queues; writable memos; stores; streams; arbitrary Future polling; heterogeneous JS values; Reactivescript/RX integration; renderer APIs. General native-loop wake/cancel/resource reclamation is only designed. The generator does not emit those APIs. Partially implemented actions and lazy/async cases stay enabled and fail normally.

Current technical limits include retained arena/flight slots, no conversion of user panics into reactive errors, no proven shared-flight action/memo reaction order, and no production work-budget policy. See [DESIGN](DESIGN.md) for the event-loop host model and [OP-LANGUAGE](OP-LANGUAGE.md) for the exact test surface.

## Operation coverage (final 2000 seeds)

Counts exclude reducer attempts and replay checks.

| Op | Executions |
|---|---:|
| signal | 4667 |
| owner | 2000 |
| cleanup | 4000 |
| memo | 4331 |
| effect | 3999 |
| read | 19117 |
| latest | 14739 |
| pending | 14739 |
| flush | 9731 |
| resolve | 2687 |
| refresh | 2419 |
| write | 12621 |
| reject | 431 |
| action | 1334 |
| dispose | 999 |

## Next milestone

Port staged/committed computation state and transaction membership before extending the surface. The current delayed-write map cannot reproduce the multiple compute views that Solid uses while an optimistic lane is visible. Then fix dynamic-height / lazy sweep ordering and async failure recovery using the checked-in cases. Only after those pass should the same generator be broadened to born-held owners, served-reader holds, and optimistic source confirmation.
