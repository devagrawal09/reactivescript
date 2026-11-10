# Measured results

Layout note (2026-11-09): this tree is now `frontend/` of the solid-model repository, and rust-tracker, the Rust tree
these results were measured with, is its `rust-solid/`, the gate's default `RUST_SOLID`; plain `npm run verify:subset`
runs the integrated gate. The checkout names below (frontend-tracker, rust-tracker, rust-eval, rust-ssr and their
`/workspace/rx-tsx-refresh/...` paths) record where each measurement was taken; `docs/HISTORY.md` at the repository
root records the branches they came from.

## Slice 5: async data (renderToStream, renderToString, streamed hydration)

Measured 2026-11-09 in `solid-model` (Node 24.11.1 and rustc 1.96.0 from nixpkgs, Chromium 143, Solid 2105ffb8 rc.21,
reactivescript fdbcad92), uncommitted, on top of the sections below. rust-solid's server renderer now renders plan v2.1
apps (async memos, `Loading`, `Errored`, `isPending`, `latest`) as Solid's `renderToString` and, under a server answer
script, as Solid's `renderToStream`, chunk for chunk (rust-solid `docs/SSR.md`, "Async data and streaming": a structural
port of the server builds' async paths, of `renderToStream`, of the hydration serializer and of seroval 1.7.0's
`crossSerializeStream`, over a ported JS event loop). The oracle is `ssr/stream-core.ts`, `ssr/stream-leg.ts`,
`ssr/run-async.ts` and `ssr/browser.ts`'s `hydrateStream`; the fuzz is `scripts/ssr-fuzz.ts --async`. The gate, the
tests and both SSR fuzz v2.1 ranges ran on the final code (the summaries are rust-solid `docs/ssr-fuzz/summary-async-*.json`);
the Rust tiers, `plan-diff` and the 1–1000 runs of the existing fuzzers ran on it before a last dead-code cleanup in
`ssr/boundary.rs`, after which the v2 SSR fuzz 1–1000 was rerun (byte-identical).

| Check | Result |
| --- | --- |
| Kept tests | `npm run verify:subset`: PASS 131/131 (124 before, plus the 7 of `ssr/ssr-async.test.ts`), 0 failed/skipped/todo/cancelled; the new gate step, the SSR fuzz v2.1 on seeds 1–100, 84 agree and 16 refused (`baselines/ssr-fuzz-async.json`); every other summary unchanged (fuzz 179 + 21 listed; plan, eval, SSR fuzz 85 + 15; plan and eval fuzz v2.1 84 + 16); strict types 0 package diagnostics, 12 upstream (baseline) |
| rust-solid | `cargo test` 166 (156 before, none deleted, plus 6 in `tests/ssr_async.rs` and 4 unit tests in `src/ssr/js.rs` and `src/ssr/seroval.rs`; `tests/plan_v21.rs`'s refusal test now pins the renderToString HTML); `--slice1/2a/2b/2c/--render/--strings` and `--boundaries` on 1–1000 `--no-reduce` byte-identical to the recorded summaries; tracker, like and tracker-async scenarios pass; `plan-diff` tracker 453/453, like 34/34, tracker-async 399/399; fmt, clippy `-D warnings`, `git diff --check` clean |
| Tracker-async, four server answer scripts | `idle` (loadIssues #1 answered after the shell: 2 chunks), `now` (before it: 1 chunk), `idle-reject`, `now-reject`: Rust's stream equals Solid's event for event (chunks, settlements, end) and byte for byte; renderToString HTML equal (the Loading fallback and `"$$f"`) |
| Tracker-async in Chromium | Rust's and Solid's streams fed chunk by chunk and hydrated after the shell and after the last chunk (production builds) and after the shell (dev builds): no element created, none unclaimed, nothing on the console; stream frames `Loading issues…` then step 1's (`idle`) or step 1's (`now`); then the scenario continues from step 2 (the client's `loadIssues #2` is the scenario's), all 16 frames equal to native Solid's recording. Each renderToString HTML hydrates and replays all 18 steps from mount |
| Tracker-async, rejected first load | the failure fragment carries `Errored`'s fallback (`<template id="200" e>`) and the wire error `new Error("Internal Server Error")` under the boundary's id; hydrated, `retry` asks the client's `loadIssues #2` and shows the issues; after the shell Solid's client renders that fallback fresh (by design, #4287), after the last chunk it claims it, and Rust's stream is treated the same in each mode |
| Fail closed | a changed byte is a stream difference; a changed key in a chunk makes the client build the row fresh (prod) and warn "Hydration key miss" (dev); a changed text fails a frame |
| SSR fuzz v2.1, seeds 1–1000 | 878 agree, 0 stream, HTML or hydration differences, 0 Rust refusals, 122 refused by the emitter (64 `*`, 58 `-`), 0 invalid; 1,950,289 stream bytes in 1,685 chunks (629 multi-chunk streams, 106 failure fragments, 201 server rejections), 180,607 renderToString bytes, 7,024 hydrations (16,146 continuation steps, 17,015 from mount) |
| SSR fuzz v2.1, seeds 1001–3000 (held out) | 1747 agree, 0 differences, 0 Rust refusals, 252 refused (134 `*`, 118 `-`), 1 invalid: seed 1916, where Solid's own renderToString HTML, hydrated, does not replay native Solid's scenario (a `Show` toggled around `Errored` > `Loading` > `Loading` after a rejection shows nothing); Rust's HTML fails the same way; 3,958,861 stream bytes in 3,427 chunks, 13,976 hydrations |
| SSR fuzz v2.1, gate (1–100) | 84 agree, 16 refused, 0 differences (`baselines/ssr-fuzz-async.json`) |
| Existing fuzz, 1–1000 | v2 plan, eval and SSR (`--dev`) fuzz, and the plan v2.1 and async eval fuzz: summaries byte-identical to rust-solid `docs/plan-fuzz/summary-1-1000.json`, `docs/eval/summary-1-1000.json`, `docs/ssr-fuzz/summary-1-1000.json`, `docs/plan-fuzz/summary-async-1-1000.json`, `docs/eval/summary-async-1-1000.json` |

What a hydration run compares: each Rust run (after the shell and after the last chunk, production builds; after the
shell, dev builds) against the run of Solid's own stream in the same mode, which records the continuation with the
program's chooser: the frames after the shell and after each chunk, every continuation frame, the hydrated DOM, the
elements the client created instead of claiming, the keyed elements it left unclaimed, and the console. Solid's own
runs are not uniform, and the summary keeps what they observed as notes (`notes` in `summary.json`): the dev builds log
the errors the client's boundaries catch (rejections in the continuation, and the server's wire error the client
adopts); after the shell, a streamed failure's fallback is
rendered fresh; and an `<Errored>` over two `<Loading>`s, one failing and the other landing after it, ends with the
second boundary's content and no fallback when hydrated after the shell, with the fallback when hydrated after the last
chunk (a suspected Solid rc.21 bug, not filed). Every Rust run observed exactly what Solid's did.

## Plan v2.1 on Rust: the v2.1 consumer and Solid's boundaries ported

Measured 2026-11-09 in `solid-model` (Node 24.11.1 and rustc 1.96.0 from nixpkgs, Solid 2105ffb8 rc.21, reactivescript
fdbcad92), uncommitted, on top of the two sections below. rust-solid now consumes plan v2.1 (its
`docs/PLAN-V2-CONSUMER.md`, "Plan v2.1"): Solid's `Loading`/`Errored` boundaries, tracked `isPending`/`latest` and
`affects()` are ported structurally (its `docs/BOUNDARIES-COVERAGE.md`), and a `--boundaries` fuzz checks the boundaries
against Solid directly.

| Check | Result |
| --- | --- |
| Kept tests | `npm run verify:subset`: PASS 124/124 (123 before, plus `slices/tracker-async.test.ts :: plan v2.1: Rust consumes the tracker-async plan freshly emitted from each accepted frontend (TSX, RX)`); the four v2.1 tests that had Rust `rust-unsupported` now require Rust's trace to equal native's (renamed in `baselines/subset-tests.json`); strict types 0 package diagnostics, 12 upstream (baseline) |
| Tracker-async, Rust | rust-solid's `scenario` gives all 18 frames from the plan emitted by `.tsx` and by `.rx`; `plan-trace` gives native Solid's 399-entry host log (the yield twin is refused, so TSX and RX are the accepted syntaxes) |
| Plan v2.1 fuzz 1–1000 | 878 agree on all four legs (Rust included), 0 `rust-unsupported`, 122 refused, 0 divergent, invalid or generator bug; 17,015 steps, 232,260 host log entries per leg |
| Plan v2.1 fuzz 1001–3000 (held out) | 1748 agree, 0 `rust-unsupported`, 252 refused, 0 divergent, invalid or generator bug; 33,514 steps, 462,103 entries per leg |
| Async eval fuzz 1–1000 / 1001–3000 | 878 / 1748 agree (Rust with the host's eval table), 0 `rust-unsupported`, 122 / 252 refused (every leg, Rust's included, fails with the refusal), 0 divergent |
| Plan v2.1 and async eval fuzz (gate, 1–100) | 84 agree, 0 `rust-unsupported`, 16 refused each (`baselines/plan-fuzz-async.json`, `baselines/eval-fuzz-async.json` updated) |
| v2 plan, eval and SSR fuzz (gate, 1–100), TSX fuzz 0–199 | unchanged: 85 agree and 15 refused each; 179 agree and 21 listed |
| rust-solid | `cargo test` 156 (132 + 14 `tests/boundaries.rs` + 10 `tests/plan_v21.rs`); `--slice1/2a/2b/2c/--render/--strings` 1–1000 `--no-reduce` byte-identical to the recorded summaries; `--boundaries` 985/1000 and 1979/2000 (every valid program; the 36 others hang in Solid itself, a suspected Solid bug); `plan-diff` tracker 453/453, like 34/34, tracker-async 399/399; fmt, clippy `-D warnings`, `git diff --check` clean |

Root causes found in the Rust port (none in the frontend): a staged error served as a value (Solid hands a lane reader the
`StatusError` object; the port had failed closed there), a dormant lazy fallback reawakened, and a user effect's first
run queued in the creator's lane when the node has no extension (`node._x?._transaction` is `undefined`, so `enqueue`
defaults to `passLane`). Rust's slice-1 driver now runs the host's 32 microtask turns per `drain` as `fuzz/solid.mjs`
does (a never-ending microtask chain stops being observed, as in JS).

## Plan v2.1: the JS consumer's host log, the plan v2.1 fuzz, async data in evaluated code

Measured 2026-11-09 in `solid-model` (Node 24.11.1 and rustc 1.96.0 from nixpkgs, Solid 2105ffb8 rc.21, reactivescript
fdbcad92), uncommitted, on top of the tracker-async slice below. Schema, fuzz and root causes: `plan/docs/PLAN-V2.md`,
"Plan fuzz v2.1"; evaluated code: `docs/EVAL.md`, "Async data".

| Check | Result |
| --- | --- |
| Kept tests | `npm run verify:subset`: PASS 123/123 (115 before, plus 8: the tracker-async host log, 2 plan v2.1 fuzz tests, 2 eval v2.1 tests, the 2 tests of `slices/eval-async.test.ts`, the v2.1 summary check in `tsx/verifier.test.ts`), 0 failed/skipped/todo/cancelled |
| Tracker-async host log | On the plan fuzz's recording host (production builds) native Solid, compiled RX and the plan on `solid-plan.ts` give one full host log, 399 entries, and the 18 frames; Rust: `rust-unsupported` |
| Plan v2.1 fuzz 1–1000 | 0 agree, 878 `rust-unsupported` (every JS leg equals native, full host logs), 122 refused (64 `*`, 58 `-`), 0 upstream, divergent, invalid or generator bug; 17,015 scenario steps and 232,260 host log entries per leg |
| Plan v2.1 fuzz 1001–3000 (held out) | 0 agree, 1748 `rust-unsupported`, 252 refused (134 `*`, 118 `-`), 0 upstream, divergent, invalid or generator bug; 33,514 steps, 462,103 entries per leg |
| Plan v2.1 fuzz (gate, 1–100) | 0 agree, 84 `rust-unsupported`, 16 refused (8 `*`, 8 `-`), 0 divergent (`baselines/plan-fuzz-async.json`) |
| Async eval slice | 19 steps, 3 code strings (each compiled to a v2.1 plan), static twin, createEval and the plan: one 295-entry host log and the frames; Rust: `rust-unsupported` |
| Async eval fuzz 1–1000 | 0 agree, 878 `rust-unsupported` (static twin, createEval and the plan agree, full host logs), 122 refused (the `outside` family, each eval leg failing with the plan's diagnostic), 0 divergent, invalid or generator bug; 16,081 steps (1,475 code reloads), 240,093 entries per leg; 524 codes compiled to v2.1 plans, 480 with their own async memo |
| Async eval fuzz 1001–3000 (held out) | 0 agree, 1748 `rust-unsupported`, 252 refused, 0 divergent, invalid or generator bug; 32,027 steps, 479,170 entries per leg |
| Async eval fuzz (gate, 1–100) | 0 agree, 84 `rust-unsupported`, 16 refused, 0 divergent (`baselines/eval-fuzz-async.json`) |
| v2 plan, eval and SSR fuzz 1–1000 | summaries byte-identical to rust-solid `docs/plan-fuzz/summary-1-1000.json`, `docs/eval/summary-1-1000.json` and `docs/ssr-fuzz/summary-1-1000.json` (`--dev`), run on the final code |
| Fuzz seeds 0–199; plan, eval, SSR fuzz (gate, 1–100) | 179 agree and 21 listed; 85 agree and 15 refused each; summaries byte-identical to the previous gate run |
| Strict types | 0 package diagnostics (new files in `tsconfig.json` and `plan/tsconfig.json`); unchanged baseline of 12 upstream diagnostics |
| rust-solid | untouched (no file changed): `cargo test` 132, `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` clean; the 1000-seed tier runs were not repeated, since neither Rust nor any input they read changed |

Divergences found: none, on any JS leg (two planted consumer bugs were caught: PLAN-V2.md). The consumer was hardened
where the schema says so (an async memo read in a handler or action, `affects` in a plain handler). Remaining classes:
`rust-unsupported` on every program the v2.1 builder accepts (rust-solid's `plan-trace` stops at the plan's `version`:
`invalid type: floating point `2.1`, expected u32`); the `outside` family's refusals (`*`, `-`); no compiled-RX-only
class.

## Plan v2.1: async data (tracker-async)

Measured 2026-11-09 in `solid-model` (Node 24.11.1 and rustc 1.96.0 from nixpkgs, Solid 2105ffb8 rc.21, reactivescript
fdbcad92), uncommitted. Schema and semantics: `plan/docs/PLAN-V2.md`, "v2.1: async data"; scenario:
`docs/SCENARIO-FORMAT.md`, "Version 2.1".

| Check | Result |
| --- | --- |
| Kept tests | `npm run verify:subset`: PASS 115/115 (106 before, plus the 9 of `slices/tracker-async.test.ts`), 0 failed/skipped/todo/cancelled |
| Tracker-async slice | 18 frames recorded from native Solid; compiled TSX, compiled RX and the v2.1 plan on `solid-plan.ts` give them all (dev builds in the gate; production builds by hand, the same); TSX and RX have equal canonical facts and emit one plan byte for byte (`plan/tracker-async.plan.json`); the yield twin is refused at each async import and its async `$memo`, every diagnostic pinned |
| Additivity | `--schema 2.1` emits `tracker.plan.json` and `like.plan-v2.json` byte for byte from all three frontends; RX and TSX twins of plan-fuzz seeds 1–40 give the v2 builder's plan or refusal through the v2.1 builder and the TSX async tier |
| Fuzz seeds 0–199 | 179 agree, 21 listed interpreter-only differences (unchanged) |
| Plan, eval, SSR fuzz (gate, 1–100) | 85 agree, 15 refused each (unchanged) |
| Plan, eval, SSR fuzz 1–1000 | summaries byte-identical to rust-solid `docs/plan-fuzz/summary-1-1000.json`, `docs/eval/summary-1-1000.json`, `docs/ssr-fuzz/summary-1-1000.json` (`--dev`) |
| Strict types | 0 package diagnostics (`slices/tracker-async.test.ts` added to `tsconfig.json`); unchanged baseline of 12 upstream diagnostics |
| rust-solid (untouched) | `cargo test` 132; `--slice1/--slice2a/--slice2b/--slice2c/--render/--strings` seeds 1–1000 `--no-reduce` byte-identical to the recorded summaries (`--slice2c` run alone: with all six in parallel on 4 cores, seed 493, the known Solid store-hole seed, was classed `oracle-error` instead of `oracle-halted`); tracker 13/13 and like 5/5 frames, `plan-diff` 453/453; fmt, clippy `-D warnings`, `git diff --check` clean |

Not done here: a Rust consumer of v2.1 (rust-solid's `scenario` prints `unsupported plan version None`; `plan-trace`
stops at the plan's `version`), `latest` in a scenario, server rendering of async data. Done since (above): the host-log
comparison for the slice, the plan v2.1 fuzz, async data in evaluated code.

## Slices 3 and 5 integrated (frontend-tracker, rust-tracker)

Slice 3 (the live evaluator, `docs/EVAL.md`) and slice 5 (server rendering, below) were built in separate copies of
this tree and rust-tracker and then applied here together. The two sections below record what each slice measured in
its own copy; this table is the integrated tree. Node 24.11.1 and rustc 1.96.0 from nixpkgs, Solid 2105ffb8 (rc.21),
reactivescript fdbcad92.

| Check | Result |
| --- | --- |
| Kept tests | `RUST_SOLID=/workspace/rx-tsx-refresh/rust-tracker npm run verify:subset`: PASS 106/106 (90 before, plus 8 from slice 3 and 8 from slice 5), 0 failed/skipped/todo/cancelled |
| Fuzz seeds 0–199 | 179 agree, 21 listed interpreter-only differences; summary byte-identical to the pre-integration run |
| Plan fuzz | seeds 1–100 (gate): 85 agree, 15 refused, byte-identical; seeds 1–1000: summary byte-identical to rust-tracker `docs/plan-fuzz/summary-1-1000.json` (861 agree, 8 upstream, 131 refused) |
| Eval fuzz | seeds 1–100 (gate): 85 agree, 15 refused, byte-identical to slice 3's run; seeds 1–1000: byte-identical to `docs/eval/summary-1-1000.json` (869 agree, 131 refused, 0 divergent) |
| SSR fuzz (`--dev`) | seeds 1–100 (gate): 85 agree, 15 refused, byte-identical to slice 5's run; seeds 1–1000: byte-identical to `docs/ssr-fuzz/summary-1-1000.json` (869 agree, 0 HTML differs, 0 hydration fails, 0 Rust refused, 131 emitter refusals) |
| SSR in Chromium | `ssr/ssr.test.ts` 7/7: tracker and like hydrate from Rust's HTML (prod and dev) and replay; the fail-closed check fails as it should |
| Strict types | 0 package diagnostics (also none under `ssr/tsconfig.json`); unchanged baseline of 12 upstream diagnostics |
| rust-tracker | `cargo test` 132 passed (117 before, plus 5 `eval`, 5 `ssr`, 4 `ssr` unit, 1 integration test); `--slice1/--slice2a/--slice2b/--slice2c/--render/--strings` summaries on seeds 1–1000 byte-identical to the recorded ones; tracker and like scenarios pass, `plan-diff` 453/453 and 34/34; fmt, clippy `-D warnings` and `git diff --check` clean |

**The one real conflict.** Slice 3 added `Expr::Eval` and `View::Eval` to plan v2, and slice 5's server lowering
(`src/ssr/plan.rs`) matched every plan form exhaustively, so the merged crate did not compile. The server renderer now
refuses, before rendering, a plan with an eval site anywhere and an evaluated code's own plan, with an explicit
diagnostic (rust-tracker `docs/SSR.md`, "Refused"); a new test (`tests/ssr.rs`, `eval_sites_are_refused`) runs every
eval fixture through it. Eval on the server is not ported. Everything else merged as a union: the test globs, the
scripts, the gate steps (plan fuzz, then eval fuzz, then SSR fuzz), `report.ts`'s checks and `baselines/subset-tests.json`.

## Slice 3: the live evaluator

`eval(code, bindings)` in RX and `createEval(() => code, bindings)` in TSX (`docs/EVAL.md`): code strings compiled at run
time through the same frontend, the pinned checker and plan v2, typed against an interface the checker derives from the
enclosing component, and run as plans (`solid-plan.ts` in JS, the Rust consumer with the host's eval table). Upstream is
unchanged: the frontend records eval sites before checking (`eval/sites.ts`).

| Check | Result |
| --- | --- |
| Kept tests (slice 3 copy) | PASS 98/98 (90 before, plus 2 eval slice, 5 eval, 1 verifier), 0 failed/skipped/todo/cancelled |
| Eval slice | 23 steps, 7 code strings (3 RX programs, the empty string, 2 TSX-syntax programs at a second site with a renamed binding, a value eval's 2 formulas): the static twin's frames and its 363-entry host log on createEval, the plan (`.rx` and `.tsx` emit it byte for byte) and Rust |
| Eval fuzz seeds 1–100 (gate) | 85 agree, 15 refused (`baselines/eval-fuzz.json`) |
| Plan fuzz seeds 1–100 | unchanged, summary byte-identical: 85 agree, 15 refused |
| Fuzz seeds 0–199 | unchanged, summary byte-identical: 179 agree, 21 listed interpreter-only differences |
| Strict types | 0 package diagnostics; unchanged baseline of 12 upstream diagnostics |
| rust-eval | `cargo test` 122 passed (117 before, plus 5 `eval`); the six recorded fuzz summaries on seeds 1–1000 byte-identical; like and tracker scenarios pass, `plan-diff` 453/453 and 34/34; fmt, `clippy -D warnings` and `git diff --check` clean |

Eval fuzz (`scripts/eval-fuzz.ts`): each plan fuzz program split into an enclosing component and evaluated code, on the
static twin (native Solid), createEval (native Solid), the plan (`solid-plan.ts`) and Rust (`plan-trace` with the eval
table); every leg must equal the static twin's result and full host log.

| seeds | agree | refused | divergent | invalid | generator bug |
| --- | --- | --- | --- | --- | --- |
| 1..1000 | 869 | 131 (43 `*`, 49 `-`, 39 constant hole) | 0 | 0 | 0 |
| 1001..3000 (held out) | 1713 | 287 (89 `*`, 91 `-`, 107 constant hole) | 0 | 0 | 0 |
| 1..100 (gate) | 85 | 15 | 0 | 0 | 0 |

- The agreeing programs replay 9,621 scenario steps (574 of them change the code, disposing and recreating the
  evaluated subtree) and 313,420 host log entries per leg (1..1000); held out, 19,887 steps (1,198 code changes) and 639,808 entries.
- Shapes (1..1000): 661 split (the code is part of the markup plus the declarations nothing else uses, bound to the
  rest), 208 whole; 414 RX-syntax and 455 TSX-syntax code. Bindings: 1,954 read, 109 store, 371 action, 490 host.
- Every refused program is the plan fuzz's `outside` family, refused with the plan fuzz's own diagnostic, and every
  eval leg fails with it (the two JS legs identically, log included). The agreeing programs are exactly the programs
  the plan fuzz's emitter accepts (1..1000: its 861 agreeing and 8 upstream RX-only programs; held out: 1694 and 19):
  eval has no compiled RX leg.
- Fixed on the way: a structured read binding in TSX syntax was declared with `createSignal` (refused by the TSX
  frontend); it is now a memo. An eval site with no bindings derived the empty interface, which the injection took for
  a missing one. A write or guess to a read binding is reported as `READ_ONLY` before the checker's
  `OPTIMISTIC_NO_QUESTION`.
- Not verified: error boundaries in Rust (no `Errored` port), `preserve`, `place`, yield syntax, value evals and
  explicit interfaces in the fuzz (the slice and tests cover them). See `docs/EVAL.md`, "Deferred and not verified".

Measured with Node 24.11.1 and rustc 1.96.0 from nixpkgs, not the pinned 24.18.0 / 1.97.1.
`RUST_SOLID=/workspace/rx-tsx-refresh/rust-eval npm run verify:subset` was run, and the eval fuzz on seeds 1..3000.

## Slice 5: server rendering

A Rust server renders a plan v2 app to HTML, and Solid's client hydrates it (rust-ssr `docs/SSR.md`). The oracle is
here, in `ssr/`, and runs Solid 2105ffb8 (rc.21) only:

1. **Solid's HTML.** The TSX twin compiled with `{ generate: "ssr", hydratable: true }`, rendered by
   `renderToString(() => App())` on the production server builds, in a fresh worker with Node's default conditions
   (`ssr/server-leg.ts`; it fails if `@solidjs/web` resolves to its client build).
2. **Rust's HTML.** rust-ssr's `ssr PLAN` (`$RUST_SSR`): the port of the server builds plus the compiler's SSR lowering
   of the plan's canonical TSX twin. It must equal Solid's byte for byte.
3. **Hydration** (`ssr/browser.ts`). Chromium 143 (nixpkgs) driven by Playwright 1.59.1 loads each HTML in
   `<div id="app">` beside Solid's `generateHydrationScript()`, with an import map onto the solid-next dist files (no
   bundler) and the client module (the same TSX, `{ generate: "dom", hydratable: true }`, types stripped). Solid's
   `hydrate` runs; then the scenario: DOM clicks on the targets (elements handling click, by text and parent text),
   settlements of the named requests with exactly their arguments, three turns after each step. A run fails on any
   page error or console error/warning, an element hydration created or dropped, a key left in the client's registry
   or a keyed server element missing from `_$HY.completed`, any change to the container's HTML except the removal of
   the `<!--!$-->` separators (Solid's client strips them by design), a server text that is not the mount frame, or
   any frame that is not the scenario's. Solid's own HTML is the control; the Rust HTML is also hydrated on the dev
   builds, which warn on key misses, tag and structure mismatches.

The gate now builds rust's `ssr` beside `scenario` and `plan-trace` and needs a checkout with the slice-5 renderer. Since
slices 3 and 5 were integrated that was `RUST_SOLID=/workspace/rx-tsx-refresh/rust-tracker npm run verify:subset`; in the
solid-model repository the default `../rust-solid` is that tree, so plain `npm run verify:subset` runs it.

**The canonical twin.** A plan does not say whether a TSX hole was `{n()}` or `{"" + n()}`; on the server they differ
(the first is scoped and takes a hydration id, the second is provably a string and takes none). Rust renders the plan
fuzz generator's twin: integer and conditional holes coerced, others as written. The tracker's idiomatic
`<b>{unassigned()} open</b>` therefore renders its rows `_hk=8000…` where the canonical twin, and Rust, render
`_hk=7000…`; nothing else differs. Each HTML hydrates only under its own twin's client; the canonical HTML under the
idiomatic client is reported as a mismatch (`ssr/ssr.test.ts`).

| check | result |
| --- | --- |
| tracker, like | Rust HTML = Solid HTML of the canonical twin, byte for byte; like's twins render the same `<button _hk=1>0</button>` |
| hydration script | `ssr --hydration-script` = `generateHydrationScript()` |
| tracker, like in Chromium | tracker: Rust and Solid HTML, prod and dev builds; like: the Rust HTML (Solid's is the same bytes), prod and dev. No mismatch, all 13 tracker frames and like's `0 1 0 1 1` |
| fail-closed | canonical HTML under the idiomatic client fails: unclaimed server keys, and the dev build's "Hydration key miss" |

**SSR fuzz** (`npm run ssr-fuzz -- --dev`): each program of the plan fuzz's generator; its scenario is recorded on
native Solid as the plan fuzz records it; Chromium hydrates the Rust HTML (prod and dev) and the Solid HTML (prod).

| seeds | agree | HTML differs | hydration fails | Rust refused | refused (emitter) | invalid | generator bug |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1..1000 | 869 | 0 | 0 | 0 | 131 | 0 | 0 |
| 1001..3000 (held out) | 1713 | 0 | 0 | 0 | 287 | 0 | 0 |
| 1..100 (gate) | 85 | 0 | 0 | 0 | 15 | 0 | 0 |

- Every program the emitter accepts agrees, including those whose compiled RX differs in the plan fuzz (8 and 19).
  1..1000: 445,065 HTML bytes, 4,758 hydration keys, 2,607 hydrations, each replaying its whole scenario (9,766 steps
  over the 869 scenarios); held out: 876,977 bytes, 9,330 keys, 5,139 hydrations (20,189 steps over 1,713 scenarios).
  The refusals are the plan fuzz's (`*`, `-`, constant holes: 43/49/39 and 89/91/107); Solid's own server render of
  each refused program still succeeds.
- **Async server data** is not expressible in plan v2 (hosts are only awaited in actions; no async source or
  `Loading`), so it is not ported; it is the next step (rust-ssr `docs/SSR.md`, "Next").
- **Levels.** Syntax we recognize: every plan `validate` accepts reaches the renderer, which refuses what has no
  canonical twin with a diagnostic. Verified subset: the generated programs above, the tracker and like. Full readiness
  is not claimed: no Rust hydration, no async data, no document shell, no attributes.

| Check | Result |
| --- | --- |
| Kept tests (slice 5 copy) | `RUST_SOLID=…/rust-ssr npm run verify:subset`: PASS 98/98 (90 before, plus 7 `ssr/ssr.test.ts`, 1 verifier), 0 failed/skipped/todo/cancelled |
| SSR fuzz seeds 1–100 | 85 agree, 15 refused (`baselines/ssr-fuzz.json`) |
| Plan fuzz seeds 1–100 | unchanged: 85 agree, 15 refused |
| Fuzz seeds 0–199 | unchanged: 179 agree, 21 listed interpreter-only differences |
| Strict types | 0 package diagnostics (and none in `ssr/tsconfig.json`); unchanged baseline of 12 upstream diagnostics |
| rust-ssr | `cargo test` 126 passed (117 before, plus 5 `ssr`, 4 unit); the six recorded fuzz summaries on seeds 1–1000 byte-identical; tracker and like scenarios pass (host logs 453/453, 34/34); fmt, clippy `-D warnings` and `git diff --check` clean |

## Plan fuzz

Plan v2 is now a verified subset rather than two verified plans (`plan/docs/PLAN-V2.md`, "Plan fuzz"). A seeded
generator (`plan/fuzz/gen.ts`) writes each program as Solid TSX, RX and, where the dialect can say it, yield, with its
host declarations; native Solid records a scenario v2 with the generator's chooser; and four legs replay it on one
recording host: native Solid, compiled RX, the plan built by `solid-plan.ts` and rust-tracker's `plan-trace`. Results
and full host logs must be equal, entry for entry.

| seeds | agree | upstream (compiled RX only) | refused | divergent | invalid | generator bug |
| --- | --- | --- | --- | --- | --- | --- |
| 1..1000 | 861 | 8 (3 AC-3, 5 path write) | 131 (43 `*`, 49 `-`, 39 constant hole) | 0 | 0 | 0 |
| 1001..3000 (held out) | 1694 | 19 (9 AC-3, 10 path write) | 287 (89 `*`, 91 `-`, 107 constant hole) | 0 | 0 | 0 |
| 1..100 (gate) | 85 | 0 | 15 | 0 | 0 | 0 |

- The agreeing programs replay 9,651 + 19,959 scenario steps and 301,340 + 610,856 host log entries per leg. On every
  program the emitter accepted, `solid-plan.ts` and Rust equal native Solid.
- Every plan node kind occurs: all 21 expression ops, both writes, both guesses, await, try, call, element, static and
  dynamic text, Show, For, and the three source kinds. The scenarios overlap requests (500 of 861 programs), settle
  them out of order (396), reject (526), toggle the filter while a request is pending (304), claim one row twice (272)
  and write the store (285) or a guessed signal's base (34) while a guess is live.
- 469 programs have a yield twin; each emits the RX plan (or its refusal) byte for byte.
- `upstream`: only compiled RX differs, and a probe that changes one upstream RX lowering makes it native's exactly.
  AC-3: an optimistic source is a guess layer over a computed signal, one node deeper than `createOptimistic(fn)`, so
  effects apply in another order (host log only). Path write: `w.path(keys, v)` evaluates before the store setter, so
  under a pending transaction that holds the node RX writes another value (frames differ).
- Fixed on the way (root causes in PLAN-V2.md): the consumers' construction order (Solid's template order, static
  props, markers, no `fallback` prop when empty), `in` before a field read, path writes evaluated outside the setter,
  plain `when`/`each` where the compiler memoizes a condition, and refused adjacent dynamic children; the emitter's
  single coercion strip, skipped `else` regions, constant holes, text in component positions, and stores inferred
  from path writes.
- Not generated, documented: idiomatic TSX number holes (`{n()}` gives the host `2`, RX and the plan `"2"`; for the
  tracker that is the whole difference, `plan/plan-fuzz.test.ts`) and inline action handlers (like).

| Check | Result |
| --- | --- |
| Kept tests | PASS 90/90 (83 before, plus 5 plan fuzz, 1 emitter rules, 1 verifier), 0 failed/skipped/todo/cancelled |
| Plan fuzz seeds 1–100 | 85 agree, 15 refused (`baselines/plan-fuzz.json`) |
| Fuzz seeds 0–199 | unchanged: 179 agree, 21 listed interpreter-only differences |
| Strict types | 0 package diagnostics; unchanged baseline of 12 upstream diagnostics |
| rust-tracker | `cargo test` 117 passed (114 before, plus 2 `plan_fuzz`, 1 tracker); the six recorded fuzz summaries unchanged |

Measured with Node 24.11.1 and rustc 1.96.0 from nixpkgs, not the pinned 24.18.0 / 1.97.1. Only `npm run verify:subset`
was run.

## Slice 2: tracker

The tracker slice (`slices/tracker/`, scenario format version 2) and plan schema v2 (`plan/docs/PLAN-V2.md`) joined the
gate at the same pins. Its Rust leg runs rust-tracker's plan v2 consumer, so the gate needs a v2 `scenario` binary:
`RUST_SOLID=/workspace/rx-tsx-refresh/rust-tracker npm run verify:subset`. `verify-pinned.sh` exports `RUST_PLAN_V2=1`,
so the listed tracker Rust leg always runs; with the default `../rust-solid` of the time (a v1 consumer, which refused the v2
plan) it failed. The solid-model repository's `rust-solid/` is the v2 consumer.

| Check | Result |
| --- | --- |
| Kept tests | PASS 83/83 (66 slice 1, 9 tracker slice, 8 plan v2), 0 failed/skipped/todo/cancelled |
| Tracker frames | all 13 equal from native Solid, compiled TSX, compiled RX, compiled yield, and Rust on the plan freshly emitted from each of `.rx`, `.tsx` and `.yield.tsx` |
| Plan v2 | the three frontends emit byte-identical `tracker.plan.json` and `like.plan-v2.json`; `solid-plan.ts` renders each scenario's frames from the plan alone |
| Host log | Rust equals Solid's own recording host log, 453/453 entries (rust-tracker `fuzz/plan-diff.mjs`) |
| Fuzz seeds 0–199 | unchanged: 179 agree, 21 listed interpreter-only differences |
| Strict types | 0 package diagnostics; unchanged baseline of 12 upstream diagnostics |

Verified: the one tracker scenario and like in v2, frame for frame, on every frontend and on Rust, and the tracker's
full host log against Solid's. Not verified then: plans were not fuzzed, so only these two plan/scenario pairs were
checked (superseded by "Plan fuzz" above).
The scenario does not exercise a filter toggle while a claim is pending, two claims on one row, a store change under a
live guess, or non-overlapping transactions; these are unverified in Rust as in JS (rust-tracker
`docs/PLAN-V2-CONSUMER.md`, Gaps).

Measured with Node 24.11.1 and rustc 1.96.0 from nixpkgs, not the pinned 24.18.0 / 1.97.1. Only `npm run verify:subset`
was run.

## Slice 1 merged into main

`slice1-like` (158bea5) and `slice1-plan` (f315116) merged at the same pins. The plan now reads the slice fixtures in
`slices/like/` (its byte-identical copy was dropped), its yield override is gone, and `plan/*.test.ts` joined the gate.
The suite builds rust-solid's `scenario` binary from `../rust-solid`, or `RUST_SOLID`, and fails closed if the build is missing.

| Check | Result |
| --- | --- |
| Kept tests | 66 passed (53 earlier, 9 like slice, 4 plan), 0 failed/skipped/todo/cancelled |
| Plan | `.rx`, `.tsx` and yield emit identical plans; Rust frames equal native Solid's for each |
| Fuzz seeds 0–199 | unchanged: 179 agree, 21 listed interpreter-only differences |
| Strict types | 0 package diagnostics; unchanged baseline of 12 upstream diagnostics |

Measured with Node 24.11.1 and rustc 1.96.0 from nixpkgs, not the pinned 24.18.0 / 1.97.1. Only `npm run verify:subset` was run.

## Shrink and repin: fdbcad92 / Solid rc.21

Clean ReactiveScript fdbcad921c6bc1cae59cbebe9905eeabc480e88f; Solid
2105ffb8ca2fced55f5fac0763177fc93f97c2c2, exactly ref/SOLID_NEXT (2.0.0-rc.21).
Node 24.18.0, Rust 1.97.1. No upstream patches.

The gate is now the kept subset, not the old full-port failure catalog. It includes every yield test from frontend
main 6fb8ea8. No yield source or fixture was changed by the shrink. V8 coverage of the kept TSX tests and 200 seeds
was used to find unused branches; removed behavior is refused before lowering.

| Check | Result |
| --- | --- |
| Kept tests | 53 passed (33 TSX/verifier, 20 yield), 0 failed/skipped/todo/cancelled |
| Fuzz seeds 0–199 | 179 agree; 21 listed interpreter-only differences; no adapter/semantics differences or generator errors |
| Strict types | 0 package diagnostics; unchanged baseline of 12 upstream diagnostics |
| Upstream interpreter | 111 pass, 1 fail: S-store-8 |
| Upstream oracle | 112 pass, 0 fail, 0 skip |
| Upstream compiled | 112 pass, 0 fail, 0 skip |
| Upstream types | 152 pass, 0 fail |
| Upstream SSR / Chromium | 105 pass, 0 fail, 7 upstream skips |
| Rust AST/check/model parity | 317/317 |
| Rust lowering | 184/184; 232 modules across 3 targets, 696 source maps |
| Rust projection | 185/185; 283 files, 11672 mappings |
| Rust unit tests | 6 passed, 0 failed |

Commands: npm run verify:subset; OUT=.out/repin-fdbcad92 sh scripts/verify-pinned.sh --rust; git diff --check.
The frontend subset is green. The full pinned check is red because upstream's S-store-8 exits 1; its expected
Z-B- frame is Z+B- at instant 4. The runner and its exit are not hidden. Raw logs and the report are under
.out/repin-fdbcad92; the fixed fuzz traces are under .out/fuzz/run-0-200.

The 21 fuzz differences are explicitly listed in baselines/fuzz-upstream.json, not passed off as backend agreement.
Native Solid and compiled RX agree; TSX and handwritten RX agree within each backend. The interpreter still exposes
held writes early (docs/FUZZ.md U1/U2). New upstream differences fail the gate until reviewed.

## What was removed, not fixed

The old baseline was 573 tests with 96 failures. Legacy tests outside the kept set, browser fixtures, the failure
catalog, coverage rename/removal machinery, server/context/effect helpers and patch queue were deleted. Source
contexts were withdrawn upstream (O-4 / RG-7c); they now get the general outside-subset refusal. Async computations,
derived stores, previous/deferred values, general setup helpers/constants and cross-module components are also out.
Patch 0001 still applied at this pin; it was dropped because server functions are outside the subset, not because
upstream fixed the key defect. Old failing tests were not weakened or relabeled as successes.

DOM/hydration is no longer a frontend claim. Upstream's own SSR runner still runs unfiltered, with its own seven skips.
The retained frame/fact assertions are unchanged. The default-component entry and plain-value optimistic question
flag remain required by the paired and yield tests.
