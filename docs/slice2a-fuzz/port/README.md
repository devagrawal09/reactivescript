# Slice 2a port: run artifacts

These are the runs of the ported runtime (`crates/runtime/src/slice1/`, slices 1 + 2a). Results and diagnosis are in [../../SLICE1.md](../../SLICE1.md). The pre-port baseline is in [../](../) (`summary-*.json`).

| file | run |
| --- | --- |
| `summary-1-1000.json` | `node fuzz/run.mjs --slice2a --seeds 1000`: 991/1000, 8 invalid, 1 `rust-panic` |
| `summary-1001-3000.json` | `node fuzz/run.mjs --slice2a --start 1001 --seeds 2000 --no-reduce`: 1984/2000, 16 invalid |
| `slice1-gate-summary-1-1000.json` | `node fuzz/run.mjs --slice1 --seeds 1000`: 1000/1000. Identical to `../../slice1-fuzz/parity/summary-1-1000.json`. |
| `slice1-gate-summary-1001-3000.json` | `node fuzz/run.mjs --slice1 --start 1001 --seeds 2000`: 2000/2000 |
| `fail-629.json` | the one valid program that does not agree (seed 629, family `async-lanes`) |
| `reduced-rust-panic-629.json`, `.logs.json` | its class-preserving reduction (13 ops) by `run.mjs` |

Tools in [../tools](../tools/):

- `trace-copy.mjs`, `trace-diff.mjs`: internal scheduler traces of Solid and of the port, and their first divergence.
- `mark-reduce.mjs`: a minimal program reaching a cut site.
- `unit-programs.json`, `unit-expectations.mjs`: the programs behind `crates/runtime/tests/slice2a.rs` and their Solid traces.
