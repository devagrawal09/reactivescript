# rust-solid

Single-threaded Rust reactive-runtime spike against Solid 2 rc.21. **Not parity-complete; M1 remains open.** See [status](docs/STATUS.md), [design](docs/DESIGN.md), and [reference quirks](docs/SOLID-QUIRKS.md).

## Run

Requires Rust (tested 1.88) and Node (tested 24). The JS oracle uses the built, read-only sibling checkout at ../solid-next/packages/signals/dist/prod/index.js (the repository's solid-next/, from scripts/setup.sh). Cargo downloads serde and serde_json; there is no npm install step here.

```sh
cargo test
node fuzz/run.mjs --seeds 2000 --out out/check
node fuzz/run.mjs --replay docs/repros/reduced-2-compute-effect_cleanup.json
node fuzz/run.mjs --render --seeds 1000 --out out/render     # docs/RENDERER.md
node fuzz/run.mjs --strings --seeds 1000 --out out/strings   # docs/RENDERER.md, "Strings"
cargo run --bin scenario -- crates/runtime/tests/fixtures/tracker.plan.json crates/runtime/tests/fixtures/tracker.scenario.json   # docs/PLAN-V2-CONSUMER.md
node --conditions=browser fuzz/plan-diff.mjs crates/runtime/tests/fixtures/tracker.plan.json crates/runtime/tests/fixtures/tracker.scenario.json
cargo test --test plan_fuzz   # recorded plan-fuzz programs against native Solid's host log (docs/plan-fuzz/README.md)
cargo test --test eval        # the live evaluator: the eval slice and eval fuzz programs, the host's eval table (docs/EVAL-CONSUMER.md)
cargo test --test ssr         # the server renderer against Solid's renderToString HTML (docs/SSR.md)
cargo run --bin ssr -- crates/runtime/tests/fixtures/tracker.plan.json   # a plan's server HTML
```

The fuzzer exits nonzero for any mismatch or invalid reference program. That is expected while the port is incomplete. It writes coverage, exact expected/actual logs, full failing programs, and reduced programs. No log filtering is used to improve agreement.

## Layout

- crates/runtime/src/lib.rs — graph, owners, scheduler, flights, coroutine actions
- crates/runtime/src/bin/driver.rs — JSON-lines Rust program runner
- crates/runtime/src/slice1/ — structural port of Solid's scheduler paths for slice 1 (see docs/SLICE1.md, docs/SLICE1-PARITY.md)
- crates/runtime/src/bin/slice1-driver.rs — the slice-1 fuzz adapter (`node fuzz/run.mjs --slice1`, also `--slice2a/2b/2c` and `--strings`)
- crates/runtime/src/slice1/universal.rs, flow.rs, flatten.rs, events.rs — the port of Solid 2's `@solidjs/universal` renderer, Show/For/createComponent and `@solidjs/web`'s event delegation; crates/runtime/src/renderer.rs — the host trait and the recording `TreeRenderer`; crates/runtime/src/bin/render-driver.rs — the renderer fuzz adapter (`node fuzz/run.mjs --render`, see docs/RENDERER.md)
- crates/runtime/src/ssr/ — slice 5: the port of Solid 2's server builds as `renderToString` runs them (owners and hydration ids, the server's signals, `Show`/`For`, `@solidjs/web`'s `ssr`/`escape`/resolvers) and the lowering of a v2 plan into the compiler's SSR output (docs/SSR.md); crates/runtime/src/bin/ssr.rs — `ssr PLAN`
- crates/runtime/tests/core.rs — focused runtime tests
- fuzz/solid.mjs — rc.21 reference runner
- fuzz/generate.mjs — deterministic seeded program generation
- fuzz/run.mjs — exact comparison, reduction, and coverage
- docs/ — design, current results, quirks, and checked-in counterexamples

No RX compiler work, frontend changes (the frontends are ../frontend), pushes, or GitHub setup are part of this folder. The renderer is a port of Solid 2's own `@solidjs/universal` (docs/RENDERER.md). The plan v2 consumer (`crates/runtime/src/plan_v2.rs`, `scenario` with a version-2 plan) runs the slice-2 tracker plan to its native-Solid frames and Solid's host log (docs/PLAN-V2-CONSUMER.md). The frontend's plan fuzz replays generated plans through `plan-trace` against native Solid's full host log (docs/plan-fuzz/README.md): a verified subset of the generated program shapes, not full readiness. Eval sites (frontend `docs/EVAL.md`) run from the host's table of compiled plans: `plan-trace PLAN SCENARIO EVALS` (docs/EVAL-CONSUMER.md). The server renderer (`crates/runtime/src/ssr/`, `ssr`) renders a v2 plan to the HTML Solid's `renderToString` renders for the plan's canonical TSX twin, byte for byte, and the frontend's oracle hydrates it with Solid's client in Chromium and replays the scenario (docs/SSR.md): verified on the plan fuzz's programs, seeds 1..3000, the tracker and like; async server data is not expressible in plan v2 and not ported.
