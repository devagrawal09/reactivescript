# rust-solid

Single-threaded Rust reactive-runtime spike against Solid 2 rc.21. **Not parity-complete; M1 remains open.** See [status](docs/STATUS.md), [design](docs/DESIGN.md), and [reference quirks](docs/SOLID-QUIRKS.md).

## Run

Requires Rust (tested 1.88) and Node (tested 24). The JS oracle uses the built, read-only sibling checkout at ../solid-next/packages/signals/dist/prod/index.js. Cargo downloads serde and serde_json; there is no npm install step here.


env CARGO_TERM_COLOR=never cargo test

node fuzz/run.mjs --seeds 2000 --out out/check

node fuzz/run.mjs --replay docs/repros/PROGRAM.json


The fuzzer exits nonzero for any mismatch or invalid reference program. That is expected while the port is incomplete. It writes coverage, exact expected/actual logs, full failing programs, and reduced programs. No log filtering is used to improve agreement.

## Layout

- crates/runtime/src/lib.rs — graph, owners, scheduler, flights, coroutine actions
- crates/runtime/src/bin/driver.rs — JSON-lines Rust program runner
- crates/runtime/tests/core.rs — focused runtime tests
- fuzz/solid.mjs — rc.21 reference runner
- fuzz/generate.mjs — deterministic seeded program generation
- fuzz/run.mjs — exact comparison, reduction, and coverage
- docs/ — design, current results, quirks, and checked-in counterexamples

No renderer, RX compiler work, frontend changes, pushes, or GitHub setup are part of this repo.
