# Slice 2c port: run artifacts

These are the runs of the ported runtime (`crates/runtime/src/slice1/`, slices 1 + 2a + 2b + 2c: `map.rs`, the owner/frame machinery in `owner.rs`/`core.rs`/`scheduler.rs`/`lanes.rs`, shallow stores in `store/`, and the tier-C ops in `src/bin/slice1-driver.rs`). Results, deviations and diagnosis are in [../../SLICE1.md](../../SLICE1.md). The pre-port baseline (0/1000) and the coverage method are in [../](../) and [../../SLICE2C-COVERAGE.md](../../SLICE2C-COVERAGE.md).

| file | run |
| --- | --- |
| `summary-1-1000.json` | `node fuzz/run.mjs --slice2c --seeds 1000`: **999/1000**, 1 invalid (`oracle-halted`, seed 493). Every valid program agrees. |
| `summary-1001-3000.json` | `node fuzz/run.mjs --slice2c --start 1001 --seeds 2000 --no-reduce`: **1998/2000**, 2 invalid (`oracle-error`, seeds 2723 and 2907). Every valid program agrees. |
| `summary-3001-8000.json` | `node fuzz/run.mjs --slice2c --start 3001 --seeds 5000 --no-reduce` (extra seeds, not a gate): **4988/5000**, 12 invalid (9 `oracle-error`, 3 `oracle-halted`), all the suspected Solid bug family below. Every valid program agrees. |
| `fail-493.json`, `fail-2723.json`, `fail-2907.json` | the invalid programs of the gate ranges, with the oracle's verdict and the driver's fail-closed panic |
| `reduced-oracle-halted-493.json` (+`.logs.json`) | `run.mjs`'s class-preserving reduction of seed 493 (11 ops) |
| `hole-view-2723.json`, `hole-view-2907.json` | the optimistic-hole repros of [../](../) with the list replaced by a render effect and a probe over `plain(list, [id])`: valid programs, and the port **agrees** with Solid's `[undefined]` / `[undefined, row 6]` views — it reproduces the hole; it fails closed only where Solid's key function throws on it |
| `solid-bug-plain-store-hole-{4857,5042,7869}.json` | the plain-store member of the family (extra seeds; reduced to 12 ops each with [../tools/bug-reduce.mjs](../tools/bug-reduce.mjs), signature `reading 'id'`): `node fuzz/run.mjs --slice2c --replay …` reports `oracle-error` or `oracle-halted`, depending on timing: the class flips between runs of the same file, always with the same `TypeError` (`reading 'id'`) from the key function. Replays on 2026-11-08: 4857 40 `oracle-error` / 4 `oracle-halted`, 5042 20 / 2, 7869 20 / 3. The driver panics at the key function |
| `solid-bug-plain-store-hole.mjs` (+`.txt`) | seed 4857 on Solid's API alone: `node docs/slice2c-fuzz/port/solid-bug-plain-store-hole.mjs` prints, per map pass, what it sees untracked (the posture of `newItems.slice(0)`): `length 1 [false:8]` — `0 in list` is false while `list[0]` is row 8 — and then the key function receiving `undefined` (it logs instead of throwing) |
| `plain-store-view-4857.json` | the same program without the list (a render effect over `plain(list, [id])`): valid, agrees, no hole in the tracked view |
| `slice1-gate-summary-1-1000.json`, `slice1-summary-1001-3000.json` | `--slice1` 1–1000 (1000/1000) and 1001–3000 `--no-reduce` (2000/2000). Identical to `../../slice1-fuzz/parity/summary-1-1000.json` and `summary-1001-3000.json`. |
| `slice2a-gate-summary-1-1000.json`, `slice2a-summary-1001-3000.json` | `--slice2a --no-reduce` 1–1000 (991/1000: the 8 `oracle-nonscalar` and `rust-panic` 629) and 1001–3000 (1984/2000). Identical to `../../slice2a-fuzz/port/summary-*.json`. |
| `slice2b-gate-summary-1-1000.json`, `slice2b-summary-1001-3000.json` | `--slice2b` 1–1000 (1000/1000) and 1001–3000 `--no-reduce` (1999/2000, 1430). Identical to `../../slice2b-fuzz/port/summary-*.json`. |

No valid program fails, so there is no `rust-panic` or trace-difference class and no reduced failing case.

## Suspected Solid bug family: array views with holes

Every invalid tier-C seed of 1–8000 (15) is one family: a store array hands `mapArray` an `undefined` row and the program's key function `x => x.id` throws a `TypeError` inside `updateKeyedMap` (`oracle-error`, or `oracle-halted` when the throw reaches a render effect). Which of the two a run reports depends on timing, so the invalid classes in the summaries can differ between runs (see the plain-store repros above). Two mechanisms:

1. **`has` and `get` disagree inside a pass.** A map pass sees `length` cover index `i` and `list[i]` return a row, but `i in list` is false; `_items = newItems.slice(0)` (HasProperty, then Get) keeps a hole, and the next pass's `compare`/key map hands it to the key function.
   - On an optimistic store with overlapping guesses: seed 493 ([../repro-493-optimistic-hole.json](../repro-493-optimistic-hole.json), [../solid-bug-optimistic-hole.mjs](../solid-bug-optimistic-hole.mjs)).
   - **New here: on a plain store** whose container a pending action holds (the action's edit is a `{key, is}` miss: it writes nothing) while mainline reconciles and pushes: seeds 4857, 5042, 7869 (`list-store`), `solid-bug-plain-store-hole*.{json,mjs}` above. The tracked view of the same store has no hole (`plain-store-view-4857.json`).
2. **A lasting hole in an optimistic view**: overlapping pending move/remove/push guesses compose into `[undefined]` / `[undefined, row 6]` where `[row 1]` / `[row 6]` is expected: seeds 2723, 2907 ([../repro-2723-optimistic-hole.json](../repro-2723-optimistic-hole.json), [../repro-2907-optimistic-hole.json](../repro-2907-optimistic-hole.json), [../solid-bug-optimistic-hole-2.mjs](../solid-bug-optimistic-hole-2.mjs)).

The extra `list-opt-store` seeds 4081, 4220, 5117, 5138, 5554, 6174, 6888, 6910 and 7645 throw the same `TypeError` from the key function; they were not triaged between the two mechanisms.

The port reaches the same states (`hole-view-*.json` agree with Solid, and the driver's key function meets the same `undefined` row in all 15 programs). It does not imitate the throw: the driver's key function panics ("a key function over an undefined row (a TypeError) is outside the op language"), so these programs fail closed. Not reported upstream.

## Tools ([../tools](../tools/))

- `mark-reduce.mjs`: a minimal `--slice2c` program reaching a site mark of `marks.mjs` (the marked copy in `out/solid-mark`), valid on the strict oracle (`valid2c`). With `--disagree BIN`, every kept candidate must also make BIN, a driver built from a mutant of the port, disagree with Solid (seed 980 against `removal_staged_by` forced to false).
- `unit-programs.json`, `unit-expectations.mjs`: the programs behind `crates/runtime/tests/slice2c.rs` and their Solid traces (`crates/runtime/tests/fixtures/slice2c-units.json`).
- `bug-reduce.mjs`, `oracle-one.mjs`: the repros above.
