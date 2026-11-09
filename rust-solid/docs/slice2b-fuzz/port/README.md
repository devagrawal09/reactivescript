# Slice 2b port: run artifacts

These are the runs of the ported runtime (`crates/runtime/src/slice1/`, slices 1 + 2a + 2b: the store tier in `slice1/store/`). Results, deviations and diagnosis are in [../../SLICE1.md](../../SLICE1.md). The pre-port baseline (0/1000) and the coverage method are in [../](../) and [../../SLICE2B-COVERAGE.md](../../SLICE2B-COVERAGE.md).

| file | run |
| --- | --- |
| `summary-1-1000.json` | `node fuzz/run.mjs --slice2b --seeds 1000`: **1000/1000**, 0 invalid. No failing class, so no reduced case. |
| `summary-1001-3000.json` | `node fuzz/run.mjs --slice2b --start 1001 --seeds 2000 --no-reduce`: **1999/2000**, 1 invalid (`oracle-error`, seed 1430) |
| `summary-3001-8000.json` | `node fuzz/run.mjs --slice2b --start 3001 --seeds 5000 --no-reduce` (extra seeds, not a gate): **4997/5000**, 3 invalid (4623 `oracle-error`; 5270, 7335 `oracle-halted`), all the suspected Solid bug below |
| `fail-1430.json` | the held-out invalid program with the oracle's error (the suspected Solid bug below) |
| `slice1-gate-summary-1-1000.json` | `node fuzz/run.mjs --slice1 --seeds 1000`: 1000/1000. Identical to `../../slice1-fuzz/parity/summary-1-1000.json`. |
| `slice1-summary-1001-3000.json` | `node fuzz/run.mjs --slice1 --start 1001 --seeds 2000 --no-reduce` |
| `slice2a-gate-summary-1-1000.json` | `node fuzz/run.mjs --slice2a --seeds 1000 --no-reduce`: 991/1000, the same 8 `oracle-nonscalar` and 1 `rust-panic` (629). Identical to `../../slice2a-fuzz/port/summary-1-1000.json`. |
| `slice2a-summary-1001-3000.json` | `node fuzz/run.mjs --slice2a --start 1001 --seeds 2000 --no-reduce` |
| `solid-bug-take-held.json` | the suspected Solid bug's minimal op program (9 ops, from seed 5270): `node fuzz/run.mjs --slice2b --replay docs/slice2b-fuzz/port/solid-bug-take-held.json` reports `oracle-error` (the `TypeError` in `resolveTx`) |
| `solid-bug-take-held.mjs` | the same program on Solid's API alone: `node docs/slice2b-fuzz/port/solid-bug-take-held.mjs` throws `TypeError: Cannot read properties of null (reading 'eo')` in `resolveTx` |
| `solid-bug-take-held-1430.json`, `solid-bug-take-held-4623.json` | seeds 1430 and 4623 reduced the same way (12 ops each) |

## Suspected Solid bug: `take` of a held slot

`take(n, l, true)` (lanes.ts:174-181), which `GlobalQueue._slotTake` (optimistic.ts:353-374) calls for a derived optimistic store's other guessed slots when its derive re-asks in another action's lane, nulls the slot's `_x._transaction` and clears CONFIG_GUESS|CONFIG_OVERRIDE, but keeps CONFIG_HELD (set by `laneWrite`, lanes.ts:982-990, when a landing was held beneath the guess). The next `txOf` of that slot throws in `resolveTx(null)`: the re-ask's landing writing it (`reconcileState` → `applyAdopt` → `notifyKeyDiff` → `leafSet` → `setSignal`'s CONFIG_HELD arm, `joinFuture(txOf(el))`), or a render effect reading it (`read` → `frameRead`). An instrumented copy of the source shows `take(d)` on a held node before each throw (seeds 1430, 4623, 5270, 7335). Not reported upstream; the port fails closed there (`tx_of` panics) rather than imitating the throw.

## Tools ([../tools](../tools/))

- `replay-diff.mjs`: one program on the strict oracle and on the driver, with the first differing event.
- `trace-copy.mjs`: the instrumented Solid copy for `docs/slice2a-fuzz/tools/trace-diff.mjs`, with store slot nodes labelled and `SS`/`IS` events.
- `mark-reduce.mjs`, `check-marks.mjs`: a minimal program reaching a site mark of `marks.mjs`, and the marks a set of programs reaches.
- `unit-programs.json`, `unit-expectations.mjs`: the programs behind `crates/runtime/tests/slice2b.rs` and their Solid traces.
- `bug-reduce.mjs`: a 1-minimal program that still makes Solid throw with a given stack signature.
