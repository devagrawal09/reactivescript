# Plan fuzz: the Rust plan v2 consumer against native Solid

The generator, runner and gate live in `../frontend` (`plan/fuzz/`, `scripts/plan-fuzz.ts`;
`plan/docs/PLAN-V2.md`, "Plan fuzz"). For each seed it generates a program inside the plan v2
subset as Solid TSX, RX and (where the yield dialect can say it) yield; emits the v2 plan from
each frontend, which must be byte-identical; records a scenario v2 on native Solid; and replays
it on four legs:

1. native Solid: the TSX compiled by Solid's universal transform, on `@solidjs/universal` with
   the recording host (the host of `fuzz/plan-oracle.mjs`, with `createElement`'s static props);
2. compiled RX: upstream's compiler and runtime;
3. the plan built by the frontend's `plan/solid-plan.ts` on Solid 2's own primitives;
4. this folder's `target/debug/plan-trace PLAN SCENARIO` (`scenario::trace_v2`).

Each leg's result and full host log must equal native Solid's, entry for entry. A program the
emitter refuses counts as refused, with its diagnostic. A failed native recording is invalid
(`oracle-error`, `oracle-halted`, `oracle-timeout`). A difference in compiled RX alone counts as
`upstream` only when a probe that changes one upstream RX lowering makes RX give native's exact
trace.

| file | what |
| --- | --- |
| `summary-1-1000.json` | `npm run plan-fuzz -- --seeds 1000 --start 1` in ../frontend |
| `summary-1001-3000.json` | `npm run plan-fuzz -- --seeds 2000 --start 1001` (held out) |
| `summary-async-1-1000.json`, `summary-async-1001-3000.json` | the plan v2.1 fuzz (`npm run plan-fuzz -- --async …`): 878 and 1748 programs agree on all four legs, this consumer's included; 0 `rust-unsupported`, 0 divergent; 122 and 252 refused by the emitter ([PLAN-V2-CONSUMER.md](../PLAN-V2-CONSUMER.md), "Plan v2.1"); the async eval fuzz's are `../eval/summary-async-*.json` |

## Results

| seeds | agree | upstream (compiled RX only) | refused | divergent | invalid | generator bug |
| --- | --- | --- | --- | --- | --- | --- |
| 1..1000 | 861 | 8 (3 AC-3, 5 path write) | 131 (43 `*`, 49 `-`, 39 constant hole) | 0 | 0 | 0 |
| 1001..3000 (held out) | 1694 | 19 (9 AC-3, 10 path write) | 287 (89 `*`, 91 `-`, 107 constant hole) | 0 | 0 | 0 |

The agreeing programs replay 9,651 scenario steps and 301,340 host log entries per leg (1..1000), and 19,959 steps
and 610,856 entries per leg (held out). On every program the emitter accepted, `solid-plan.ts` and Rust's `plan-trace`
equal native Solid: the upstream programs differ in compiled RX alone.

The Rust leg (`plan-trace`) equals native Solid on every program the emitter accepted. Every
`upstream` program is one where only compiled RX differs, by one of two upstream RX lowerings
(frontend PLAN-V2.md, "Remaining classes"): its optimistic sources are a guess layer over a
computed signal (AC-3), one node deeper than native's `createOptimistic(fn)`, so effects can
apply in a different order within a flush; and its path writes evaluate keys and value before
the store setter, so under a pending transaction that holds the node it writes a different
value.

## In this folder

- `crates/runtime/tests/plan_fuzz.rs` replays 12 recorded programs
  (`crates/runtime/tests/fixtures/plan-fuzz/seed-*.json`: the plan, the recorded scenario and
  native Solid's trace) and requires native's result and log, entry for entry; a second test
  requires the corpus to contain every expression op, step op (both writes, both guesses), view
  kind (static and dynamic text) and source kind of the schema. The corpus is picked from seeds
  1..300 by `frontend/scripts/plan-fuzz-corpus.ts`.
- `fuzz/plan-oracle.mjs` builds the plan exactly as `solid-plan.ts` does (the compiler's
  template order, one-`Get` field reads, path writes inside the setter, condition memos in
  `when`/`each`), so `fuzz/plan-diff.mjs` still compares this consumer with Solid's primitives
  on any plan and scenario.

## Reproduce

```sh
cargo build --bin plan-trace
cd ../frontend
nix shell nixpkgs#nodejs_24 -c npm run plan-fuzz -- --seeds 1000 --start 1 --rust ../rust-solid/target/debug/plan-trace
nix shell nixpkgs#nodejs_24 -c npm run plan-fuzz -- --seeds 2000 --start 1001 --rust ../rust-solid/target/debug/plan-trace
nix shell nixpkgs#nodejs_24 -c npm run plan-fuzz-corpus -- --start 1 --seeds 300 --max 12 \
  --out ../rust-solid/crates/runtime/tests/fixtures/plan-fuzz --rust ../rust-solid/target/debug/plan-trace
cd ../rust-solid && cargo test --test plan_fuzz
```
