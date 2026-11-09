# ReactiveScript frontends: a small checked subset

This package lowers a narrow Solid TSX subset onto ReactiveScript. A separate [yield frontend](docs/YIELD.md)
lowers directly to the same RX AST. This is an experiment, not a full Solid frontend or a browser/SSR parity claim:
slice 5's server rendering is verified on a generated subset only (below).

The gate keeps the counter, composition, tracker, stale-write checks, boundary checks, fuzzer, verifier, yield tests,
the [like slice](docs/SCENARIO-FORMAT.md) (native Solid plus all three compiled frontends), and the slice-2
[tracker scenario](docs/SCENARIO-FORMAT.md#version-2-slice-2-the-tracker) on the same four legs, with its
[v2 plan](plan/docs/PLAN-V2.md) emitted equally by all three frontends and rendered from the plan alone with Solid,
and the [plan fuzz](plan/docs/PLAN-V2.md#plan-fuzz): generated programs whose native Solid, compiled RX, plan and Rust
legs must give one result and one full host log; the [live evaluator](docs/EVAL.md) (slice 3): `eval(code, bindings)`
in RX and `createEval(() => code, bindings)` in TSX, code strings compiled at run time through the same frontend, checker
and plan, gated by the eval slice (code that changes over time) and the eval fuzz against static native twins on JS and
Rust; and slice 5's [server rendering](docs/RESULTS.md#slice-5-server-rendering): rust's server HTML of a plan must be
Solid's renderToString HTML of its TSX twin byte for byte, and Chromium must hydrate it with Solid's client build and
replay the scenario. The old broad port and its known-failure catalog were removed rather than carried forward.

## Run

- **npm run verify:subset**: pins, strict types, every kept TSX/yield test, fuzz seeds 0–199, plan fuzz seeds 1–100,
  eval fuzz seeds 1–100 and SSR fuzz seeds 1–100 (Chromium: on PATH or `$CHROMIUM`).
- **OUT=.out/repin-fdbcad92 sh scripts/verify-pinned.sh --rust**: also run upstream and Rust checks.
  This full check fails at the pin: upstream's interpreter fails S-store-8. No exit code is waived.
- **npm run fuzz -- --seeds 200 --start 0 --no-reduce**: write five-backend traces and a summary.
- **RUST_SOLID=$PWD/../rust-solid npm run plan-fuzz -- --seeds 1000 --start 1**: the plan fuzz (the gate runs seeds 1–100).
- **RUST_SOLID=$PWD/../rust-solid npm run eval-fuzz -- --seeds 1000 --start 1**: the eval fuzz (the gate runs seeds 1–100);
  `npm run eval-slice` re-records the eval slice's artifacts.
- **RUST_SOLID=$PWD/../rust-solid npm run ssr-fuzz -- --seeds 1000 --start 1 --dev**: the SSR fuzz (the gate runs seeds 1–100).
- **sh scripts/canary.sh REV [--dry-run] [--rust]**: check committed HEAD against another revision in a fresh layout.

The subset gate permits only listed interpreter-only fuzz differences in baselines/fuzz-upstream.json. It rejects
frontend/semantics differences, generator errors, new upstream differences, missing tests, skips and incomplete output.
A passing subset is not full backend parity. See [results](docs/RESULTS.md) and [upstream issues](docs/UPSTREAM-ISSUES.md).

## Accepted TSX

Literal-seeded scalar signals and stores; synchronous memos; plain-value or accessor-based optimistic values;
synchronous handlers; generator actions with try/catch; functional setters and store draft writes; module-level
components with inline value/callback props (including parameterized forwarding); JSX/fragments, Show and For.
The counter, tracker, composition, yield twins and fuzzer define the tested combinations. JS calls use RX declaration
files. Build output is the universal renderer only.

Other forms fail with **outside the verified subset: <construct>**. Async callbacks retain issue #20's generator-action
guidance; effects and object-valued signals retain their semantic explanations; the checker still refuses
STALE_WRITE_BACK. Source contexts, server helpers, effects, async/derived stores, previous/deferred values, general
setup helpers/constants and cross-module component imports are not supported. See [the boundary](docs/SUBSET.md).

## Clean pinned layout

ReactiveScript fdbcad921c6bc1cae59cbebe9905eeabc480e88f; Solid 2105ffb8ca2fced55f5fac0763177fc93f97c2c2
(upstream ref/SOLID_NEXT, Solid 2.0.0-rc.21). Node 24.18.0, pnpm 11.20.0, Rust 1.97.1.
Remaining versions and measured upstream baselines are in pins.json.

Use sibling directories frontend/, rust-solid/, reactivescript/, solid-next/: this package is frontend/ of the
solid-model repository, whose scripts/setup.sh clones and builds the two pinned checkouts at its root (gitignored).
frontend/upstream links to ../reactivescript, and the gate's default RUST_SOLID is ../rust-solid.
Upstream and Solid must be clean. There is no patch queue. Patch 0001 was removed with server support;
that does not mean its defect was fixed upstream.

Build Solid with RUSTUP_TOOLCHAIN=1.97.1 sh ref/scripts/solid-next.sh from the RX checkout; run npm ci in
reactivescript/ref and this package. Build Rust with RUSTUP_TOOLCHAIN=1.97.1 cargo build --release in reactivescript/compiler.

Code: tsx/subset.ts is the syntax boundary, tsx/lower.ts lowers it, tsx/modules.ts loads/checks modules, and tsx/rx/
is the only upstream import boundary. yield/ is independent of TSX lowering.
