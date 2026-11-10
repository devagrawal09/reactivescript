# Tier D: Loading and Errored boundaries, tracked verdicts and `affects` (plan v2.1's runtime)

Reference: Solid `2105ffb8` (rc.21), production builds (`dist/prod`). Read-only sources:
`packages/signals/src/` (`boundaries.ts`, `affects.ts`, `affects-marks.ts`, `core/verdict.ts`,
`core/lanes.ts`, `core/core.ts`, `core/scheduler.ts`, `core/effect.ts`, `core/error-hooks.ts`,
`flatten.ts`) and `packages/solid/src/client/flow.ts` (`Loading`, `Errored`). The port is in
`crates/runtime/src/slice1/` like the earlier tiers ([SLICE1.md](SLICE1.md)); every ported
function carries a `// Solid: file.ts:lines` comment.

## Status

| run | agree | other |
| --- | ---: | --- |
| `--boundaries` seeds 1–1000 | **985/1000** | 15 `oracle-timeout` (invalid: Solid never finishes; the Rust driver does not either, below) |
| `--boundaries` held out 1001–3000 | **1979/2000** | 21 `oracle-timeout` (the same) |
| frontend plan v2.1 fuzz 1–1000 / 1001–3000, Rust leg (`plan-trace`) | 878 / 1748 of the programs the emitter accepts | 122 / 252 refused by the emitter; 0 divergent |
| frontend async eval fuzz 1–1000 / 1001–3000, Rust leg | 878 / 1748 | 122 / 252 refused (Rust fails with the refusal, as every leg) |
| tracker-async (18 steps) | 18 frames; host log 399/399 | |
| `--slice1/2a/2b/2c/--render/--strings` 1–1000 | byte-identical to the recorded summaries | |

Every valid program of every run agrees with Solid, trace for trace (full host logs on the plan
legs, the op log on `--boundaries`). Summaries: [boundaries-fuzz/summary-1-1000.json](boundaries-fuzz/summary-1-1000.json),
[boundaries-fuzz/summary-1001-3000.json](boundaries-fuzz/summary-1001-3000.json); the plan legs in
[PLAN-V2-CONSUMER.md](PLAN-V2-CONSUMER.md), "Plan v2.1".

Readiness, kept apart: the *syntax* is the frontends' (plan v2.1, `frontend/plan/docs/PLAN-V2.md`);
the *verified subset* is the programs above (the generators' shapes, the tracker-async slice);
*full readiness* is not claimed (`on`, `<Reveal>`, hydration and server rendering of boundaries
are not ported; see "Not ported").

## Method: coverage first

As for tiers 2a–2c: measure what Solid runs for the new programs that it never ran for the
programs the port already agrees on, then port exactly that, and fail closed on the rest.

- **Base** (what the port agreed on before this tier): V8 coverage of Solid's prod files over the
  plan v2 fuzz's plan leg (seeds 1–300, 265 programs) and the slice fuzzes' oracle (`--slice1`,
  `--slice2a`, `--slice2b`, `--slice2c`, `--strings`, seeds 1–300 each), every program in a fresh
  worker.
- **New**: the plan v2.1 fuzz's plan leg (`solid-plan.ts` on the recording host, seeds 1–300, 254
  programs; the Rust consumer mirrors it call for call) and the `--boundaries` oracle (seeds
  1–300).
- Lines are counted per file at each line's first non-blank character (the rule of
  `docs/slice2c-fuzz/tools/cov-lines.mjs`), summed over workers.

Result ([boundaries-fuzz/coverage-delta-union.txt](boundaries-fuzz/coverage-delta-union.txt)):
**655 lines** in **53 functions** that the base never ran, 615 from the plan v2.1 programs and 617
from `--boundaries` (the union of the two). By file: `boundaries.js` 348, `verdict.js` 101,
`affects.js` 58, `affects-marks.js` 32, `core.js` 23, `heap.js` 18, `error-hooks.js` 15,
`universal.js` 14, `lanes.js` 13, `solid.js` 10, `flatten.js` 10, `effect.js` 8, `store/affects.js`
3, `scheduler.js` 2. `--boundaries` reaches 46 of the 53 functions (all but solid-js's `Loading`
and `Errored` wrappers, which it calls below) and three the plan programs do not: `reset`,
`insertIntoHeapHeight` and `adjustHeight`. The line lists with source are
[coverage-delta-lines-plan-v21.txt](boundaries-fuzz/coverage-delta-lines-plan-v21.txt) and
[coverage-delta-lines-boundaries.txt](boundaries-fuzz/coverage-delta-lines-boundaries.txt).

Line coverage alone misses arms the earlier tiers kept constant on a line the base also ran (a
condition evaluated false everywhere before). Those were found by the port's own markers: each
earlier "no verdict lanes", "no boundary", "no `affects()` mark", "CONFIG_VERDICT is never set"
note at a site (`grep`), and the fail-closed panics they guarded. Each is now the full arm.

## The reached code and its Rust counterpart

| Solid | Rust |
| --- | --- |
| boundaries.ts:95-139 `Boundary`; 167 `collecting`; 169-183 `boundaryOf`, `behindError`, `isCollecting`; 186-225 `record`, `caught` (the error signal, `reportClientError`); 241-246 `redraw` | `boundaries.rs` `Boundary`, `Collecting` (a JS `Set`), `JsMap` (`_readers`), `boundary_of`, `behind_error`, `is_collecting`, `record`, `caught`, `redraw`; `Node::boundary` is the context's `BOUNDARY`, inherited at creation (`add_node`) |
| 251-299 `catchStatus` (`catchHook`); 303-306 `armedOver`; 310-334 `hiddenBy` (`hiddenHook`); 347-352 `heldRun` (`heldRunHook`); 357-369 `release` | `catch_status` (0, 1 or CAUGHT_REARMED), `armed_over`, `hidden_by` (`Hidden`), `held_run`, `release` |
| 377-392 `caughtBelow`, `reads`; 417-460 `prune`; 480-539 `boundarySeam` (`boundarySeamHook`) | `caught_below`, `reads`, `prune`, `boundary_seam` |
| 668-673 `reset`; 698-930 `createBoundary` and the output's pass (787-924, the deferred `drop`); 932-992 `fallback` (a lazy computed beside the output); 1038-1074 `createLoadingBoundary`, `createErrorBoundary`; 1078-1088 the hooks (`freshHook`) | `reset`, `create_boundary`, `output_pass`, `drop_fallback` (`QueueCallback::DropFallback`), `show_fallback`, `loading_boundary`/`error_boundary` (and their accessors), `fresh_hook_value` |
| solid/src/client/flow.ts:442-461 `Errored`, 530-543 `Loading` | `flow.rs` `errored_component`, `loading_component` (`ErroredProps`, `LoadingProps`) |
| affects.ts:43-174 `release`, `register`, `affects`, the mark hooks, `inFlight`; affects-marks.ts:38-99 `repoll`, `marked`, `mark`, `unmark`, `GlobalQueue._marked` | `affects.rs` |
| verdict.ts:110-305 `watchVerdict`, `route`, `observeFlight`, `verdictRead`, `provisionalVerdict`, `pendingVerdict` (the `ahead` list and `Transaction.latest`); 312-333 `markVerdictReader`; 450-700 `verdictValue` with a reader (`_askedIn`, marks, the held, staged and flight arms); 873-890 `holdStaging` | `verdict.rs` (the whole file is now the tracked engine) |
| lanes.ts:283-337 `enterLane` (a verdict lane's value read by the hold's own work stays the frame's); 339 `isVerdict`; 389-391 `verdictLane`; 554-563 `dissolveLane`'s verdicts; 716-814 `laneRead` (a verdict seat, `entered`); 1058-1075 `heldBy`; 1082-1215 `laneSeams` (`ahead`, verdict lanes judged at their birth seam, `entered`) | `lanes.rs` `enter_lane`, `is_verdict`, `verdict_lane`, `dissolve_lane`, `lane_read`, `held_by`, `lane_seams` |
| core.ts:364-1090 `recompute`: the verdict-lane seat, a held verdict reader born into its hold, the verdict posture at the pass's end (CONFIG_VERDICT, CONFIG_OWN_PROBE, CONFIG_AHEAD), CAUGHT_REARMED at a born-held effect; 1342-1399 `frameRead` (verdict readers); 1426-1430 `creatorReads`; 1909-1939 `prepareComputed` (reawakening a dormant memo); 2106-2447 `read` (F-6 marks, `observeFlight`, a verdict reader's `stagedScreen`); 2469-2523 `serve`; 2557-2570 `stagedRead`; 2585-2612 `stagedScreen`; `computed(…, { lazy })` | `core.rs` |
| scheduler.ts:433-449 `merge` (`_marks`); 516-568 `blockedBy` (CONFIG_AHEAD); 981-1168 `settle` (`latestOpened`, the ambient marks, `boundarySeamHook`); 1199-1225 `notify` (the error passed to `catchHook`); 1235-1289 `reruns` (verdict readers); 1292-1321 `land` (`releaseMarksHook`); 1431-1465 `laneDirty` (a verdict memo's render effect) | `scheduler.rs` |
| effect.ts:70-121 `effect` (a first run's lane: `node._x?._transaction`, undefined without an extension); 179-184 `escalate`; 186-286 `runEffect` (`heldRunHook`) | `effect.rs`; `Node::x` records the extension (`ext()`), set at each of Solid's `ext()` sites |
| flatten.ts:42-80 `flattenArray` (a NotReadyError deferred to the end) | `flatten.rs` (already ported for the renderer tier) |
| error-hooks.ts:27-69 `hookFor`, `reportClientError` | `caught` records the error in `Runtime::reported`; no hook is configured, so nothing else runs |
| store/affects.ts:135-140 `releaseMarkScope` (no store mark scope: a lookup) | a no-op in `affects.rs` |
| truth.ts:23-29 `laneValueOf` (a staged error served as the `StatusError` object) | `truth.rs` `pending_value`, `lane_value_served`; `Value::Error` |
| universal.ts:185-220, 318-339 (`insertExpression`'s array and replacement arms) | `universal.rs` (ported in the renderer tier) |

## The `--boundaries` fuzz mode

`node fuzz/run.mjs --boundaries --seeds N [--start S] --out DIR [--no-reduce]` runs
`fuzz/generate-boundaries.mjs` on `slice1-driver` against `fuzz/solid.mjs` in strict workers
(`worker.mjs` strict `boundaries`: the slice-2c value domain plus booleans, and the events
`bcontent`, `bfallback`, `berror`). Traces are compared whole and exactly.

**Ops (tier D, additive: new op names, child kinds and expression ops only; no earlier trace
changes).** `loading` / `errored` (an op, or a child kind of a boundary, a Show branch or a memo's
pass): `createLoadingBoundary(kids, () => fb())` / `createErrorBoundary(kids, (err, reset) =>
fb(err))`, where `kids` builds child specs in the boundary's children computed and returns its
`expr` (or its pass number), and `fb` builds the fallback's children and returns its negated pass
number (an Errored's fallback reads the error when `err` is set: `berror`); the boundary's
accessor is a node (read it from a render effect to put it on screen). `reset` calls an Errored's
`reset`. `affects` is an op and an action step. `pending` / `latest` are expression ops:
`isPending(() => of)` / `latest(() => of)` evaluated where the expression is (inside a memo or
effect: a tracked verdict window).

**Families** (`family = W[seed mod |W|]`): first-load (a Loading over content reading an async
memo; no rejection), errored (Errored > Loading or Errored alone; memo and action flights reject;
the fallback reads the error; `reset` and `refresh` retry), nested (Loading > Errored > Loading,
two Loadings under one Errored, a Loading in a toggling Show branch), probes (memos and effects
whose passes call `isPending`/`latest`; `affects` marks; `refresh` while pending), actions
(actions that declare `affects`, await, refresh after the await, write the memo's input, succeed
or fail; overlapping, settled out of order), owners (boundaries under a disposed owner; a boundary
in a memo's pass re-created by a write). Rejections occur only where every reader of the
rejecting memo has an Errored above it (an error that reaches a render effect with none halts
rc.21: `oracle-halted`).

**The host's microtask turns.** `fuzz/solid.mjs`'s `drain` is `for (32) await Promise.resolve();
S.flush()`, awaited by the op loop. The driver ran every queued microtask to the end instead. That
is the same while every chain ends within the turns, and it is on every earlier gate (their
summaries are byte-identical either way); a chain that never ends (a memo re-asking a rejected
cached flight, held-out seed 2171) hung the driver where Solid moves on after 32 turns. The driver
now runs exactly 32 turns (each one the continuation queued behind what is already queued,
`Runtime::run_microtask_turns`), then `flush()`, then one more turn for the op loop's own `await`.

**Results.** 1–1000: 985/1000; 1001–3000: 1979/2000. By family (1–1000): first-load 188/188,
errored 187/189, nested 125/126, probes 182/187, actions 179/186, owners 124/124; the shortfall is
`oracle-timeout` only. Every valid program agrees.

**Root causes found.**

1. *A first effect run's lane* (seeds 652, 957; also the plan's): `effect()` queues a user
   effect's first run with `node._x?._transaction`, which is `undefined` without an extension, so
   `enqueue` defaults to `passLane`: an effect a boundary's content creates while its pass is
   seated in a verdict lane runs at that lane's reveal, not with the parked frame. Fixed with
   `Node::x`.
2. *The drain's turns* (seed 2171): above.
3. Two generator fixes, not runtime ones: no arithmetic over a window's read (`latest` of a held
   node with no value is `undefined`, and `undefined + 1` is NaN, outside the op language; seed
   603), likewise for an `isPending` probe of a sum.

## Suspected Solid bug: a flush that never ends (`oracle-timeout`)

All 36 `oracle-timeout` programs (15 in 1–1000: seeds 21, 90, 141, 173, 216, 440, 460, 556, 588,
679, 781, 787, 826, 844, 985; 21 held out, first 1091) hang in Solid itself (the prod build; the dev build throws, below): the oracle does not
finish within 10 s (`tools/hangcheck.mjs`), and neither does the Rust driver, which follows the
same structure. Each has an `isPending` window in a boundary's content pass (the content's `expr`,
or a memo it reads) and an `affects` mark.

- Reduced (`tools/deep-reduce.mjs`, class preserved):
  [boundaries-fuzz/solid-bug-errored-pending-hang.json](boundaries-fuzz/solid-bug-errored-pending-hang.json)
  (8 ops; `node fuzz/run.mjs --boundaries --replay` reports `oracle-timeout`).
- On Solid's API alone:
  [boundaries-fuzz/solid-bug-errored-pending-hang.mjs](boundaries-fuzz/solid-bug-errored-pending-hang.mjs)
  (`node docs/boundaries-fuzz/solid-bug-errored-pending-hang.mjs` prints `hang`): an async memo
  `a` over `s`, `m = a + s`; an error boundary whose content is `isPending(() => m()) ? 100 : m()`
  and builds a second error boundary over `m() + a()` with a render effect reading it; an action
  that declares `affects(a)` and awaits; `s` written, its new question rejected; the action's
  promise resolved and `s` written again. On the prod build (the one the fuzz oracle loads) the last flush
  never returns. On the dev build (`solid.dev.js`, `--conditions=development`) the flush loop's guard
  (scheduler.ts:1667-1675, 1e5 rounds) throws "Potential Infinite Loop Detected. Kept alive by scheduled
  work; last staged node: effect" instead (`docs/scratch/solid-rc21-repros/5-errored-pending-hang.mjs`,
  from the repository root, records both).
- What loops (the Rust trace, `SLICE1_TRACE=1`, the same structure): the outer boundary's
  children computed is a verdict reader (CONFIG_VERDICT, its own window). Each landing re-derives
  it (`reruns`); its pass builds a fresh inner boundary over the pending flight; that boundary's
  render effect goes pending and opens a new transaction (`joinFuture(null)`); nothing blocks it
  (its reader is behind the new boundary's fallback, `hiddenBy`), so it lands at the same seam,
  and its landing re-derives the verdict reader again.
- Not reported upstream. The port does not special-case it; the fuzz counts these programs
  invalid, never as agreement.

## Not ported (fail closed or constant, noted at each site)

- Loading's `on` (`arm`, `flip`, a re-armed boundary's lane, `armedOver` true, CAUGHT_REARMED
  from `catchStatus`, `reportOutsideHold`): plan v2.1 refuses `on` and no op creates one;
  `_armed` stays false.
- `<Reveal>` (reveal.ts): its hooks are installed, but no controller exists, so `_reveal` is null
  and `_gated`/`_collapsed` false everywhere.
- `adoptParked` (R5: a frame flight parked by `laneSeams` for an unanswered probe and adopted by
  the landing): reached by neither fuzz; the two `laneSeams` arms that park one panic.
- The store half of `affects` (a store or record key as the target, `storeMarks`, the witness
  mark) and a mark's repoll through a derived store: panic.
- `hiddenBy` answering `true` (no boundary to name) to `heldRun`: Solid would throw; unreachable
  for effects.
- `latestOpened`: `openedByLatest` has no caller in rc.21, so the arm it guards never runs.
- Hydration (`hydratedCreateErrorBoundary`, `hydratedCreateLoadingBoundary`), snapshots, the
  dev and observe tiers.

## Tests

`crates/runtime/tests/boundaries.rs` replays op programs through the driver against Solid's
traces (`fixtures/boundaries-units.json`, regenerated by `docs/boundaries-fuzz/tools/unit-expectations.mjs`
from `docs/boundaries-fuzz/tools/unit-programs.json`), and `tests/plan_v21.rs` the plan side
([PLAN-V2-CONSUMER.md](PLAN-V2-CONSUMER.md), "Plan v2.1").

## Reproduce

```sh
node fuzz/run.mjs --boundaries --seeds 1000 --no-reduce --out out/boundaries-1000
node fuzz/run.mjs --boundaries --start 1001 --seeds 2000 --no-reduce --out out/boundaries-heldout
node fuzz/run.mjs --boundaries --replay docs/boundaries-fuzz/solid-bug-errored-pending-hang.json   # oracle-timeout
node docs/boundaries-fuzz/solid-bug-errored-pending-hang.mjs                                       # hang, on Solid's API
node docs/boundaries-fuzz/tools/hangcheck.mjs OPS.json...   # Solid and Rust each, 10 s budget
# coverage (base: the plan v2 fuzz's plan leg and the slice fuzzes; new: plan v2.1 and --boundaries)
NODE_V8_COVERAGE=out/cov-bnd node docs/boundaries-fuzz/tools/cov-slices.mjs boundaries 1 300 4
node docs/boundaries-fuzz/tools/cov-sum.mjs out/cov-bnd out/cov-bnd.json
node docs/boundaries-fuzz/tools/cov-diff.mjs out/cov-bnd.json out/cov-base.json
```
