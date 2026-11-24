# The engine at Solid main (30e7805eb)

The slice runtime (`crates/runtime/src/slice1/`, minus `universal.rs`) was a structural port of
Solid 2.0.0-rc.21 (`2105ffb8`). This file records its move to Solid `main` at
`30e7805eb1bbd9e2601d0252558e91d2547e96f4` (2.0.3+): what changed upstream, what was ported, the
fuzz numbers before and after, which recorded summaries were re-recorded and why, and what is
not ported yet.

## Method

- `git -C solid-next diff 2105ffb8 30e7805eb -- packages/signals/src` is the upstream delta (138
  commits touching `packages/signals/src`, 259 first-parent commits in all).
- Every first-parent commit can be run as an oracle: `out/tools/at.sh COMMIT` extracts
  `packages/signals/src` at that commit (`git archive`, read-only) and bundles it with the
  checkout's own esbuild into a prod bundle (`__DEV__ = __OBSERVE__ = __TEST__ = false`). The
  bundle at `30e7805eb` gives byte-identical traces to `dist/prod/index.js` (checked on seeds
  1–300 of `--slice2a`, `--slice2b`, `--slice2c`, `--strings`, `--boundaries`), and the bundle
  at `2105ffb8` reproduces the rc.21 recorded numbers. `fuzz/run.mjs` takes it through
  `SOLID_SIGNALS_URL` (the worker inherits the env); the harness is unchanged.
- Each failing seed at the new pin was bisected over the first-parent commits (the first commit
  whose trace differs from rc.21's): `out/tools/bisect-all.mjs`. That ranks the upstream
  commits by how many fuzz programs they move (below) and names the commit behind each
  re-recorded summary.
- The Rust port then follows `main`'s source file by file (the rc.21→main diff of each
  function), not commit by commit: the lane model changed shape three times between the pins
  (#4717 two slots, #5137 two values, #5140 no take), and porting each intermediate model
  would be thrown away. The first two small commits (#4687, #4693) were ported and checked
  stepwise against their own commit's oracle (every mode identical to the rc.21 numbers),
  then the rest against `main`.
- `out/tools/trace-main.mjs` builds a traced copy of main's sources that prints the Rust
  `SLICE1_TRACE` lines (R RD SS J H S L IS C P E W N and LOG); `out/tools/tdiff.sh` shows the
  first internal divergence of one program. (These tools live in the worktree's `out/`, which
  is not committed.)

## Upstream commits that move the fuzz traces (first change per failing seed, all modes)

| commit | PR | seeds moved (slice1 / 2a / 2b / 2c / strings / boundaries) |
| --- | --- | --- |
| `eb31c8665` | #4908 Milo's lean.test.ts repros (sync glitches, netted ticks, holds) | 50 / 101 / 75 / 5 / 15 / 56 |
| `46a72c0b3` | #4717 a question is asked only of the truth (F-2 on the M1 lane model) | 0 / 117 / 174 / 46 / 182 / 41 |
| `99db9bce4` | #5101 refresh() while its answer is out waits for it, then re-asks once | 0 / 170 / 21 / 0 / 0 / 56 |
| `c98168082` | #4729 a guess's slot is the point of write (S-59 carriers) | 0 / 0 / 165 / 207 / 0 / 0 |
| `e2757be27` | #5137 a guessed node stores two values | 0 / 0 / 57 / 11 / 0 / 2 |
| `6b7474b2b` | #4687 a lane reveals whole beside its parent's landing | 0 / 10 / 24 / 4 / 2 / 29 |
| `dc33de680` | #4794 a landing's re-derived memo re-runs the held runs that read it stale | 0 / 0 / 5 / 0 / 1 / 25 |
| `eef34fd9d` | #4727 a ternary gate behaves like `<Show>` | 0 / 0 / 0 / 2 / 0 / 17 |
| others | 26 more commits, each 1–12 seeds | |

## Numbers

Before: the Rust port unchanged, against `main` (`--no-reduce`, seeds 1–1000). After: this
branch, the gate commands exactly as recorded (`dist/prod`, default 1500 ms timeout).

| mode | recorded (rc.21) | before | after, 1–1000 | after, held out 1001–3000 |
| --- | --- | --- | --- | --- |
| `--slice1` | 1000/1000 | 950/1000 | **1000/1000** (summary byte-identical) | **2000/2000** (byte-identical) |
| `--slice2a --no-reduce` | 991/1000 (8 invalid, 629 panic) | 520/1000 | **996/1000**, 4 invalid (re-recorded) | **1997/2000**, 3 invalid (re-recorded) |
| `--slice2b` | 1000/1000 | 412/1000 | **1000/1000** (byte-identical) | **2000/2000** (re-recorded: 1430 no longer invalid) |
| `--slice2c --no-reduce` | 999/1000 (493 invalid) | 714/1000 | **1000/1000** (re-recorded) | **1997/2000**, 3 invalid (re-recorded) |
| `--strings` | 1000/1000 | 793/1000 | **1000/1000** (byte-identical) | **2000/2000** (byte-identical) |
| `--boundaries --no-reduce` | 985/1000 (15 invalid) | 356/1000 | **988/1000**, 12 invalid (re-recorded) | **1982/2000**, 18 invalid (re-recorded) |

Every valid program of every range agrees; no class of Rust-vs-Solid disagreement is left in
the gates. The invalid programs are Solid's own (`oracle-nonscalar`, `oracle-halted`,
`oracle-timeout`), never counted as agreement.

## Ported

Each Rust function keeps its `// Solid: file.ts` name; the line numbers of the rc.21 comments
are stale where a function moved.

- **The two-value guess model** (#4717, #5137, #5140, #5156): `truth.rs` (`covers`, `latestOf`,
  `covered`, `underOf`, `landed`, `truth`), a new `guesses.rs` for `guesses.ts`
  (`optimisticWrite` with `readGuesses`/`readFrom` entanglement #4788, `applyGuesses` with the
  re-guess `wait`, `supersede` with zombie stale readers, `laneCorrections`, `guessWrite`,
  `laneOutcome`), and `lanes.rs` (`setLaneValue`, `reveal`, `screenOf`, `landBeneath`,
  `laneStage` merging another hold's guess instead of `take` #5140 and the derived family's
  rows, `dissolveLane`, `laneRead` with re-asks and display-ahead mounts, `laneSeam` revealing
  `covers`, `lanesBlocked` with `waits`/`holdsOn`/`heldMountUnder`/`r5`, `laneWait` S-57,
  `laneWrite`, `laneServed`'s flight arm #4859/#4862, `laneSeams` with `_reguessed`). The
  `_x._lane` slot, `take`, `kept`, `reverted` and `display` are gone, as upstream.
- **#4687** a lane reveals whole beside its parent's landing (`laneSeam`'s restored runs, the
  landing's `walk`/`waiting`, `attachWaits`); **#4693** a corrected shown guess keeps its
  hold open (`marked`).
- **scheduler.ts**: `joinFuture` joins only a live transaction (#5161), `merge` records
  `adopted` and `dropFlushTx` undoes them, `blocked` (the judge moves into `lanesBlocked`),
  `blockedBy` skips re-asks in a lane, `staleReader` pushes at every hold (#4932), `insertSubs`
  (MISSED_WAKE for a signal, REACTIVE_OWNER_READS #4848), `reasks`, `laneDirty`,
  `commitPendingNode`'s superseded staging (#4908 T1), `applyStaged` of a staged error,
  `revertHook` at the flush head.
- **core.ts**: `recompute` (the adopt hook, CONFIG_MOUNT_AHEAD S-46/S-58, `passHook`
  head/tail and the committed re-ask K1b, `laneServedHook`'s pending keep, value staging in a
  lane, `trimStaleDeps` for lane passes), `frameRead` (mount-ahead joins), `joinPass`
  (`adopter`), `read` (`fresh`/`readsFresh`, `reread`, the #4776 sync verdict memo re-derive
  `_readIn`, `bornOfLaneRerun`, lane work served a flight), `stagedRead` (may throw a served
  flight's wait), `stagedScreen` (`_opened`), `pullComputed`/`liftOwned`, graph `link`'s
  re-read answer, heap `adjustHeight`/`liftOwned`.
- **verdict.ts**: `markVerdictReader` (window kinds, the `left` arm, the joined-pass restart
  with `dropFlushTx`), `heldBeneath`, `aheadError` (D-22/D-41), `verdictValue`'s guess and
  lane arms (`parkUp`, held-lane probe), `keptGuess` in `latest`, `holdStaging` (`_readIn`,
  #4776), `attachWaits` (the hold search is gone upstream), `holdWork`, `stageMark` (#4841),
  `keepReaders` (`heldMountUnder`), the parked-flight machinery (`park`, `parkUp`, `seat`,
  `leave`, `reask`, `adoptParked`, `arm`, `r5`), `revert`/`unwake` (D-8 at the flush, #4908 K1),
  `pass`.
- **async.ts**: `retryReaches` (disposed, pending), `settlePendingSource` joins only when the
  source settled, `handleAsync` always marks CONFIG_ASYNC, `propagateStatus` settles a removed
  source and unholds a reader waiting only on re-asks (#4828).
- **effect.ts**: a user effect's run owed for a pass a new question made pending is void
  (#4908 T1).
- **signals.ts `refresh`**: while its answer is out it waits for that flight, then re-asks once
  (#5101): `Reaction::Refresh` → `Microtask::RefreshRe` → `Microtask::Waiter(…, Some(flight))`.
- **boundaries.ts**: an error boundary's lane (`_lane` from `caught`, the output entering it),
  `keeps` (a reader behind an error fallback keeps an error boundary), `freshAbove`,
  `heldRun` skipping a held/lane output (#4987), the shown held mount (`shown`), a pending tree
  caught on a settled pass, `isThenable(value)` on an error boundary's store value.

- **store/optimistic.ts** (S-59, #4729, and #4788, #4993, #5140, #4897/#4900, #4907/#4912,
  #4918/#4919, #4928/#4933, #4931/#4943, #4793): rewritten on main's carrier model — one
  `$PATCH` slot node per target per lane (`Equals::Patch` is `patchEquals`; its `wk`, `del`,
  `borrowed`, `removed`, `g` and `qs` live in `StoreState::carrier`), `guessFor`,
  `newestGuess`, `heldCarrier`, `writerBacking`/`guessView`/`writerFrame`/`ownedKeys`,
  `guessCarrier`/`entangle`, `reasked`, `carriedVerbatim`, `notifyOptimisticWrites`,
  `arrangementRow`, `reconcileDraft` (a setter's returned value is now diffed into the draft),
  `readersOf` with `_slotDirty`/`_slotMerge`, the carrier `_laneRebase`, `sameRows`, `fold`,
  `foldedRead`, `pairRows` (D-34, previously fail-closed), `noteRead`/`noteShape`, and the
  hooks `read`, `drafted`, `has`, `frame`, `covers`, `judge`, `ask`, `stands`, `park`, plus
  `sweepOverlaid`/`laneNodeOf` over carriers. `LaneView`, `optimisticView`, `optimisticHas`
  and `containerEquals`' arrangement are gone, as upstream.
- **store/store.ts**: `coveredSet` in `notifyWrites`/`leafSet` for carrier-served keys,
  `notifyContainer`'s guess test, `ensurePB` (#5096), `adoptPB`'s deferred releases (#5005)
  and `judge`, `releaseSlot` (dropping emptied node maps, #5024/#5120), `readSource`
  (`draftReadTx`, #5046; a leaf's own lane), `serveKeyValue` split out, `pullFamily`
  (`feeds`, #4970/#4972; verdict derives read their pending deps; `pullComputed`), the
  `$TRACK`/`get`/`has` traps' optimistic hooks, the `set` trap keeping another family's proxy
  (#4845), `storeSetter`'s returned value and `draftReadTx` join. **reconcile.ts**: the
  writer's `pair(t, incoming, true)` before the view.
- **map.ts**: one copy of the source per pass and `_items` is that copy (#4785), small-move
  runs as triples, and the duplicate decline over `oldItems.indexOf`.

## Re-recorded summaries, and why

Only where Solid's own output changed; every valid program agrees in each.

- `docs/slice2a-fuzz/port/summary-1-1000.json`: rc.21 had 8 `oracle-nonscalar` (225, 339, 427,
  488, 663, 683, 704, 873) and the fail-closed `rust-panic` 629. At main the invalid seeds are
  52, 327, 507, 873. First trace change per seed: 225, 339, 427, 683, 52, 327 → `eb31c8665`
  (#4908); 488, 663, 704, 629 → `46a72c0b3` (#4717); 507 → `99db9bce4` (#5101). Seed 629's
  staged error object is no longer served to the lane reader (#4717/#4841), so the program is
  valid and agrees.
- `docs/slice2a-fuzz/port/summary-1001-3000.json`: rc.21 16 invalid (1360 … 2972), main 3 (2037,
  2102, 2582). 1360, 1438, 1637, 1693, 1778, 1950, 2102, 2558, 2583, 2667 → `46a72c0b3`; 2215,
  2253, 2443, 2762, 2972 → `eb31c8665`.
- `docs/boundaries-fuzz/summary-1-1000.json`: the hang family (suspected Solid bug,
  BOUNDARIES-COVERAGE.md) shrank: 141 (→ #5101 `99db9bce4`), 173 (→ #5008 `59bfec756`), 826
  and 985 (→ #5161 `30e7805eb`) no longer hang and agree; 294 is newly `oracle-nonscalar`
  (first change #4908 `eb31c8665`). Invalid now: 21, 90, 216, 294, 440, 460, 556, 588, 679,
  781, 787, 844.
- `docs/boundaries-fuzz/summary-1001-3000.json`: 1389, 2507 (→ #5101) and 2735, 2762 (→ #5161) no
  longer hang; 2845 now hangs (first change #4717 `46a72c0b3`). 18 invalid, all
  `oracle-timeout`.
- `--slice1` and `--strings` summaries are unchanged (byte-identical, both ranges), and so
  is `--slice2b` 1–1000.

## Test fixtures re-generated

`crates/runtime/tests/fixtures/{boundaries,slice2a,slice2b,slice2c,strings}-units.json` were
regenerated with their own tools (`docs/*-fuzz/tools/unit-expectations.mjs`) against Solid
main; the op programs are unchanged, only Solid's traces moved, and the port agrees with
every one. First upstream change per changed unit: `a_refetch_keeps_the_content`,
`same_key_promise_and_refresh`, `pass_scoped_transaction` → #5101; `errored_catches_a_
rejection_and_recovers`, `equal_string_write` → #4908; `fuzz_seed_652`, `fuzz_seed_2171`,
`derived_store_arrangement_rebase`, `tracker_scenario` → #4717; `fuzz_seed_957` → #4687;
`optimistic_memo_take`, `kept_guess_restored`, `lane_outcome_truth_beneath_guess` → #5137;
`derived_store_slot_take` → #5140; `opt_store_linked_lanes` → #4788;
`a_surviving_zombie_reruns_at_commit` → #4727.

## More re-recorded summaries

- `docs/slice2b-fuzz/port/summary-1001-3000.json`: seed 1430 (the "take of a held slot"
  suspected Solid bug, SLICE1.md) is valid at main and agrees: `take` is gone upstream (first
  change #4729 `c98168082`; #5140 removed `take`).
- `docs/slice2c-fuzz/port/summary-1-1000.json`: seed 493 (array view with holes,
  `oracle-halted` at rc.21) is valid and agrees (first change #4729).
- `docs/slice2c-fuzz/port/summary-1001-3000.json`: 2723, 2907 (`oracle-error` at rc.21) are
  valid and agree (#4729); 1015, 2190, 2786 newly halt in Solid (first change #4785
  `e0f31bc58`, the per-pass copy: the same "key fn over an `undefined` row" family).

## Not ported (fail closed where reachable)

No fuzz program of any gate range reaches these:

- Adopting a parked frame flight (verdict.ts `adoptParked` visit 1: `handleAsync(r,
  parked.then())`, a chained promise): panics. The rest of the parked-flight machinery
  (`park`, `parkUp`, `r5`, `leave`, `seat`, `reask`, `arm`) is ported.
- Chained stores (a store over another store's proxy, §7b: `resolveChainedRaw`,
  `follow`), the deep witness (`deep()`), accessor keys (`isAccessorKey`), the ownKeys and
  getOwnPropertyDescriptor traps (`descriptor` hook) — as before; `Object.keys` of a store
  proxy outside a write panics in `reconcileDraft`.
- The dormant-node sweep, `swapHook` (web only), `refCallbackDepth`/`inRefCallback`
  (`read`'s ref-callback serve, `serve`'s born-held arm), `onFlush`'s trailing `flush()`,
  `Repeat`, observe/dev/`__TEST__` tiers, attribution.
- `lanes.ts rerun` / `_slotRerun` and `guesses.ts`'s `reverting` have no caller at main and
  were dropped.

## For the renderer side (not changed here)

- `tests/plan_v21.rs` fails 2 of 10 (`generated_async_programs_give_native_solids_host_log`
  seed-1: frame `reaskrefetchList5` where the recorded native host log has
  `reaskrefetchListLoadingsoon`; `async_eval_programs_give_the_static_twins_host_log` seed-56:
  `loadRows call #2 was not issued`). Both compare against host logs recorded from native
  Solid at rc.21 and both are refresh-shaped: Solid #5101 makes a `refresh()` issued while the
  answer is out wait for it and re-ask once (no second call yet). They need re-recording
  against native Solid main (frontend's plan fuzz) — not verified here.
- `universal.rs`/`ssr`/`frames` were not touched. If the renderer ports main's ref-callback
  serving (`refCallbackDepth` in core.ts `serve`) or `swapHook`, the engine side is where
  core.ts reads them; nothing in the engine fuzz reaches them.

## After the merge with the renderer: plan/eval fuzz v2.1 seed 19

- **Cause.** One condition of Solid #4826 (`5755ddd66`, "a pass that asks reads ahead on the
  screen as a sync pass does") was missed: in `verdictValue`'s held arm a probing reader `c`
  takes the "held reader" branch only when `c._config & CONFIG_HELD && !c._x._transaction?._lane`.
  The port tested CONFIG_HELD alone. In seed 19 the `<b>` text computed (`isPending(() =>
  issues().length + total())`) is held *and* seated in a lane at step 6 (`loadTotal#3`
  rejects while `loadIssues#2` is out), so Solid falls to the other branch, where
  `heldNotFinal(issues)` (pending, not a quiet re-ask) sets `probeFound`: "busy". Rust took the
  held-reader branch (stale reader, no verdict) and read "ready". Found by running
  `fuzz/plan-oracle.mjs` on a traced build of Solid main (`@solidjs/signals` redirected to
  the trace bundle) against `plan-trace` under `SLICE1_TRACE`: the internal event traces are
  identical up to step 6; the `isPending` probe's result (`IPE 0 1` vs `IPE 0 0`, trace lines
  now printed by both) is the first difference.
- **Fix.** `verdict.rs` `verdict_value`: the lane test. Also ported #4826's/#4862's two
  `projection.ts` deltas the store port had left (a derive's pass leaves a verdict lane seat;
  lane work served a flight's committed value keeps its family pending). Native is
  deterministic on this program (fresh runs give byte-identical logs).
- **Regression test.** `tests/fixtures/plan-fuzz-async/seed-19.json` (plan, scenario and
  native Solid main's full host log from `fuzz/plan-oracle.mjs`), checked by
  `plan_v21::generated_async_programs_give_native_solids_host_log`; it fails without the fix.
- **Numbers.** All six engine modes, seeds 1–1000: summaries byte-identical. `cargo test`,
  fmt, clippy clean. Plan fuzz v2.1 1–1000 with the Rust leg: 736 agree, 141 upstream (listed
  Solid #4730), 122 refused, 1 divergent (seed 419, `rx: request-createTextNode`, the RX
  leg), 0 Rust classes. Eval fuzz v2.1 1–1000: 878 agree, 122 refused, 0 divergent.
