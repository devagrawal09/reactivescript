# solid-model

Write Solid-style code in other syntaxes (Solid TSX, solid-yield's generator syntax), lower it onto ReactiveScript's
(RX) existing AST, and accept a program only if it behaves exactly like native Solid; refuse everything else, with a
diagnostic. The broader direction: **"Solid" is a semantic model plus a conformance suite.** Syntaxes, host languages,
runtimes (Solid JS, a Rust port), renderers and client/server placement are plugins around that core.

Everything here is a verified subset, not full readiness: each claim below is a gate that compares against native Solid
2 (rc.21) exactly. Start with [docs/HANDOFF.md](docs/HANDOFF.md) for the state of the work and the open decisions.

## Layout

| Path | What |
| --- | --- |
| [`frontend/`](frontend/README.md) | The TSX and yield frontends onto RX, the differential fuzzer, plan schemas v1 and v2 and their emitter, the plan fuzz, the live evaluator (slice 3, [`docs/EVAL.md`](frontend/docs/EVAL.md)), the SSR and hydration oracle (slice 5) and the gate. Results: [`frontend/docs/RESULTS.md`](frontend/docs/RESULTS.md) |
| [`rust-solid/`](rust-solid/README.md) | A Rust port of Solid 2's runtime: the scheduler (slice 1), async memos, stores and lists (tiers 2a–2c), the `@solidjs/universal` renderer, the plan v2 consumer, the eval table and the server renderer |
| [`docs/`](docs/HANDOFF.md) | [`HANDOFF.md`](docs/HANDOFF.md), [`HISTORY.md`](docs/HISTORY.md) (the branches this repository was consolidated from) and `scratch/` research notes and drafts |
| [`dashboard/`](dashboard/README.md) | A local status dashboard; [`notes.json`](dashboard/notes.json) is the narrative state |
| [`scripts/setup.sh`](scripts/setup.sh) | Clones and builds the pinned checkouts below, links `frontend/upstream` and installs the folders' dependencies. Run it with `sh` |
| `reactivescript/`, `solid-next/` | Pinned checkouts created by `scripts/setup.sh`, gitignored and kept clean: [ryansolid/reactivescript](https://github.com/ryansolid/reactivescript) at `fdbcad92` and [solidjs/solid](https://github.com/solidjs/solid) at `2105ffb8` (2.0.0-rc.21, reactivescript's `ref/SOLID_NEXT`) |

The folders keep the sibling layout they were developed in, so their relative paths resolve: `frontend/upstream` links
to `../reactivescript` (a symlink `scripts/setup.sh` creates; below); the frontend's Solid packages are `file:../solid-next/packages/*`; the gate's default
`RUST_SOLID` is `../rust-solid`; the Rust fuzz oracles import `../solid-next/packages/*/dist`.

## Setup

Needs git, Node 24 with npm, and a Rust toolchain (the native Solid compiler is built from source). The pins are Node
24.18.0 and Rust 1.97.1 (`frontend/pins.json`); the recorded runs used Node 24.11.1 and rustc 1.96.0 from nixpkgs.

```sh
sh scripts/setup.sh           # in the Tembo sandbox: nix shell nixpkgs#nodejs_24 -c sh scripts/setup.sh
sh scripts/setup.sh --check   # changes nothing; reports whether the layout is ready
```

It is idempotent. It clones `reactivescript/` at `fdbcad92` and `npm ci`s its `ref/`; clones `solid-next/` at `2105ffb8`
and builds it as reactivescript's `ref/scripts/solid-next.sh` does (`npx -y pnpm@11.1.1 install --frozen-lockfile`;
signals, solid, web and universal: build, then types if present; the compiler), skipping the build when the checkout did
not move and its outputs exist (`SETUP_REBUILD=1` forces it); then `npm ci` in `frontend/` and `cargo build` in
`rust-solid/`. It never moves a checkout with local changes. Existing clones can stand in for it: symlink them as
`reactivescript` and `solid-next` at the root.

Before `npm ci` it creates `frontend/upstream -> ../reactivescript` if it is missing (`[ -L frontend/upstream ] || ln -s
../reactivescript frontend/upstream`, from the root). Everything that reaches reactivescript from `frontend/` goes through
that link: the `"#rx/*": "./upstream/ref/*"` imports in `frontend/package.json`, the strict type check of upstream's sources
(`frontend/baselines/upstream-tsc.txt`), `frontend/scripts/verify-pinned.sh` (`cd "$HERE/upstream"`) and
`frontend/tsx/boundary.test.ts`. Without it the frontend gate fails, so run setup (or that one line) in every fresh clone or
worktree. The link is gitignored, not committed, and the scripts are committed as mode 100644 and run with `sh`: this
branch is pushed through `tembo commit`, whose API rejects files with mode 100755 (executable) or 120000 (symlink).

## Gates

Prefix node and npm commands with `nix shell nixpkgs#nodejs_24 -c` in the sandbox. Every count below is the recorded
result; a run that differs is a failure, not a tolerance.

### Frontend (`frontend/`)

```sh
npm run verify:subset   # Result: PASS, Tests: 106, pass 106, fail 0
```

`scripts/verify-pinned.sh --subset` checks the pins (both checkouts clean, at `pins.json`'s commits and reactivescript's
`ref/SOLID_NEXT`), builds `scenario`, `plan-trace` and `ssr` in `RUST_SOLID` (default `../rust-solid`), and runs strict
types (0 package diagnostics, the 12 baseline upstream ones), the 106 listed tests, the TSX fuzz on seeds 0–199 (179
agree, 21 listed interpreter-only differences), and the plan, eval and SSR fuzz on seeds 1–100 (85 agree and 15 refused
each; the SSR fuzz hydrates in Chromium, on PATH or `$CHROMIUM`). `report.ts` checks each against `baselines/`.

Longer runs, whose summaries are recorded in `rust-solid/docs/` (byte-identical on seeds 1–1000):

```sh
RUST_SOLID=$PWD/../rust-solid npm run plan-fuzz -- --seeds 1000 --start 1        # docs/plan-fuzz/summary-1-1000.json: 861 agree, 8 upstream, 131 refused
RUST_SOLID=$PWD/../rust-solid npm run eval-fuzz -- --seeds 1000 --start 1        # docs/eval/summary-1-1000.json: 869 agree, 131 refused
RUST_SOLID=$PWD/../rust-solid npm run ssr-fuzz -- --seeds 1000 --start 1 --dev   # docs/ssr-fuzz/summary-1-1000.json: 869 agree, 0 HTML or hydration failures
```

The held-out seeds 1001–3000 are recorded beside each (`summary-1001-3000.json`).

### Rust (`rust-solid/`)

```sh
cargo test                                              # 132 passed
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
git diff --check
```

The scenarios: the tracker plan (v2) and the like plans (v1 and v2) give the native frames, and the Rust host log
equals Solid's entry for entry (`plan-diff`: 453/453 and 34/34).

```sh
F=crates/runtime/tests/fixtures
cargo run -q --bin scenario -- $F/tracker.plan.json $F/tracker.scenario.json   # the 13 tracker frames
cargo run -q --bin scenario -- $F/like.plan.json $F/like.scenario.json         # ["0","1","0","1","1"]
cargo run -q --bin scenario -- $F/like.plan-v2.json $F/like.scenario.json      # ["0","1","0","1","1"]
node --conditions=browser fuzz/plan-diff.mjs $F/tracker.plan.json $F/tracker.scenario.json   # entries 453/453
node --conditions=browser fuzz/plan-diff.mjs $F/like.plan-v2.json $F/like.scenario.json      # entries 34/34
```

The fuzz modes compare the Rust port with Solid JS exactly, trace for trace (`node fuzz/run.mjs MODE --seeds 1000 --start 1
--out out/MODE`; `summary.json` must be byte-identical to the recorded one):

| Mode | What | Seeds 1–1000 | Recorded summary |
| --- | --- | --- | --- |
| `--slice1` | the scheduler, scalar actions | 1000/1000 | `docs/slice1-fuzz/parity/summary-1-1000.json` |
| `--slice2a --no-reduce` | async memos | 991/1000 (8 invalid, seed 629 fails closed) | `docs/slice2a-fuzz/port/summary-1-1000.json` |
| `--slice2b` | stores, per-row optimistic writes | 1000/1000 | `docs/slice2b-fuzz/port/summary-1-1000.json` |
| `--slice2c --no-reduce` | mapArray/For, Show, parked frames | 999/1000 (seed 493 invalid) | `docs/slice2c-fuzz/port/summary-1-1000.json` |
| `--render` | the universal renderer | 993/1000 (7 invalid: they throw in Solid) | `docs/render-fuzz/port/summary-1-1000.json` |
| `--strings` | string values and the tracker's strings | 1000/1000 | `docs/strings-fuzz/port/summary-1-1000.json` |

Held-out ranges (`summary-1001-3000.json`, and 3001–8000 for 2b and 2c) are recorded beside them. `--slice2c` with
reduction crashes while reducing seed 493 (a Solid bug throws uncaught), so its summaries use `--no-reduce`.

### Dashboard (`dashboard/`)

```sh
node --test test.mjs
```

## History

This repository's `solid-model` branch consolidates seven branches of `devagrawal09/reactivescript`
(`tsx-frontend-workspace`, `tsx-frontend-slice1-like`, `tsx-frontend-slice1-plan`, `rust-solid-main`,
`rust-solid-slice1`, `project-docs`, `project-dashboard`). It starts at `tsx-frontend-workspace`'s `7791984`, so the
frontend keeps its history; [docs/HISTORY.md](docs/HISTORY.md) records the others' SHAs, logs and ancestry.
