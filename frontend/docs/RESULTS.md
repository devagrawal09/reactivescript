# Measured results

Layout note (2026-11-09): this tree is now `frontend/` of the solid-model repository, and rust-tracker, the Rust tree
these results were measured with, is its `rust-solid/`, the gate's default `RUST_SOLID`; plain `npm run verify:subset`
runs the integrated gate. The checkout names below (frontend-tracker, rust-tracker, rust-eval, rust-ssr and their
`/workspace/rx-tsx-refresh/...` paths) record where each measurement was taken; `docs/HISTORY.md` at the repository
root records the branches they came from.

## Slice 6: inferred server components over Solid 2's Frames

Measured 2026-11-10 in `solid-model` (Node 24.11.1 and rustc 1.96.0 from nixpkgs, Chromium 143, Solid 2105ffb8 rc.21,
reactivescript fdbcad92), uncommitted, on top of the sections below. Design: `docs/SLICE6-FRAMES.md` at the repository
root. Schema: `plan/docs/PLAN-V2.md`, "v2.2". Rust server: rust-solid `docs/FRAMES.md`. A program is written once, as
an all-client app (`slices/tracker-frames/tracker-frames.rx` and its TSX twin); the v2.2 builder infers which component
sites render on the server as Solid 2 server components (`"use server"` functions returning components, mounted with
`dynamicComponent`, client-required components inside them as islands, i.e. slot props) and writes the decision into
the plan; `plan/split.ts` prints the canonical split, and rust-solid's frames server answers it as Solid's own server
does.

| Check | Result |
| --- | --- |
| Kept tests | `npm run verify:subset`: PASS 149/149 (131 before, plus `slices/tracker-frames.test.ts` 10, `plan/frames.test.ts` 7 and one verifier test for the new summary check), 0 failed/skipped/todo/cancelled; the new gate step, the placement fuzz on seeds 1–100 with the Rust leg, matches `baselines/frames-fuzz.json`; every other summary unchanged (fuzz 179 + 21 listed; plan, eval, SSR fuzz 85 + 15; plan, eval and SSR fuzz v2.1 84 + 16); strict types 0 package diagnostics, 12 upstream (baseline) |
| rust-solid | `cargo test` 175 (166 before, none deleted: + 6 in `tests/frames.rs`, 3 unit tests in `src/frames/shared.rs`); fmt, clippy `-D warnings`, `git diff --check` clean |
| Tracker-frames, G1 | placement(RX) = placement(TSX) = the saved table = extract(N) (the oracle's explicit split, read from its TSX alone); the plan's `placement` block equals its own recomputation. Detail and Summary are server roots (sunk questions `issue`, `open`), ClaimButton an island (M2) with two server arguments and the through `take` |
| Tracker-frames, G3 | the 16-step scenario recorded on T (the authored all-client TSX): N's frames and server host log equal T's at every step, requests equal apart from the wire id (`issue` is `Detail$server` on N, `loadIssue` on T); J (the plan's split) and R (rust-solid, J's client) equal N on frames, frames seen within steps, requests, host log and DOM after every step |
| Tracker-frames, G2 | J and R equal N byte for byte on every wire record: the t=0 document (inline `<solid-frame>`s, `sc-` keys, `_$SC`, `sc:live`, `sc:slot:*`, `sc:deps:*`), every frame stream (`start`, `slot:*`, `""` with digest, `:complete`), data responses, the sanitized 500 of a rejected claim, and a request without fetch metadata refused 403 by both servers |
| Tracker-frames, dev builds | T, N, J and R hydrate on Solid's dev client builds and replay the scenario with no warning, no element created fresh, no key left unclaimed |
| Tracker-frames, G4 | zero client JS for the server-only Detail and Summary: no module N, J or R fetches contains their compiled client templates, nor the server-only `./db`, and the client compile of the server module is exactly one `createServerReference` per server fn and server component; the twin's graph does contain the templates (the control) |
| Placement fuzz, seeds 1–1000 | 454 agree, 406 client-only (the legs still run and agree), 109 refused by code from RX and TSX alike (FRAMES_CHILDREN 22, FRAMES_SERVER_FN_BODY 24, FRAMES_SITE_AMBIGUOUS 29, FRAMES_WIRE_TYPE 34), 31 divergent, 0 invalid, 0 generator bugs; G1 holds on every placed program; R equals N on 889 of the 891 programs the legs ran (the other 2 are timing-dependent in Solid's client, below); 10,490 scenario steps, 3,037 requests, 578 server roots in the agreeing programs |
| Placement fuzz, seeds 1001–3000 (held out) | 913 agree, 825 client-only, 210 refused (FRAMES_CHILDREN 62, FRAMES_SERVER_FN_BODY 44, FRAMES_SITE_AMBIGUOUS 61, FRAMES_WIRE_TYPE 43), 52 divergent, 0 invalid, 0 generator bugs; R equals N on 1788 of 1790; 20,951 steps, 5,939 requests, 1140 server roots |
| Placement fuzz, gate (1–100) | 50 agree, 42 client-only, 7 refused, 1 divergent (seed 19, issue 8, listed in `baselines/frames-fuzz.json`); R equals N on all 93 programs the legs ran; the same result on three runs |
| Existing fuzz | seeds 1–1000 of the v2 plan, eval and SSR (`--dev`) fuzz and of the plan, eval and SSR fuzz v2.1 rerun on the final code: all six summaries byte-identical to rust-solid `docs/plan-fuzz/summary-1-1000.json`, `docs/eval/summary-1-1000.json`, `docs/ssr-fuzz/summary-1-1000.json` and their `summary-async-1-1000.json` (the SSR port's additions for frames change no slice 5 output) |

### Legs

- **T**, the twin: the authored TSX on Solid (every component a client component, server fns as `"use server"` data
  functions). The scenario is recorded on it.
- **N**, the oracle: an explicit split written by hand (the slice) or by the fuzz generator from its own placement model,
  on Solid's frames server wiring (`frames/leg-server.ts`: `handleServerFunctionRequest`, `frameTransformResult`,
  `frameTransformDirectResult`, `ServerComponentPlugin`, `renderToStream`).
- **J**, the plan's canonical split (`plan/split.ts`) on the same wiring.
- **R**, rust-solid's `frames-server` for the plan, with Solid's build of J's client, its server hosts answered by the
  script recorded from N's host log.

Each leg runs in Chromium on Solid's production client builds (the slice also on the dev builds) behind a holding
proxy: every server-function request is held until the scenario delivers it (`deliver` steps addressed by site and
call, `frames/sites.ts`), and requests are forwarded to the leg server one at a time in issue order. The harness starts
the scenario only after `onHydrationEnd` (an adopted server component's slot occurrences mount in idle slices after
first paint), and every console error or warning, page error, unclaimed or fresh element, network error not accounted
for by a released 4xx/5xx response, and request left held fails a run. Nothing is filtered or normalized.

### Placement fuzz

`frames/fuzz/gen.ts` generates frames programs (a client root with a row list, a filter and a mode toggle, a claim
action that refreshes the questions, sometimes with `affects`, and 1–4 component sites in a `loading` inside an
`errored`, some under a `Show`), each printed four ways: the placement-free RX, its TSX twin, the `db.d.rx`, and N, the
explicit split from the generator's own placement model (written from the PL rules, never calling `plan/placement.ts`).
Its site recipes exercise every rule: a sunk record with a stateless island (variants: the question read elsewhere,
PL-3c; a prop the markup reads from client state, PL-3d; a structured island argument, PL-5; an inline component,
PL-6), a sunk count, two questions in one component (PL-3c), an owned question, an owned question whose prop the markup
reads too (PL-3d), static components (the minimal-request rule), a stateful component (M1), a component with its own
boundary (M8), a component in a client row (PL-3b), top lists of stateless (placed) and stateful (PL-5) islands under a
server `For`. A tenth of the programs carry one refused form (the refusal family: an ambiguous site, a server fn body,
`props.children`, a non-scalar server fn parameter), which RX and TSX must refuse with its code.

Per seed (`frames/fuzz/run.ts`): emit v2.2 from RX and from TSX (one plan or one refusal code); G1 (the placement
equals the generator's model and the extract of N); record the scenario on T with the generator's chooser (clicks on
live targets and deliveries of held requests in any order, then everything left delivered); replay it on N, J and R;
compare N against T (frames, frames seen, server host log, requests apart from the wire id) and J and R against N (all
of that, the DOM, every wire record byte for byte, and each leg's problems); G4 on every server-only component.
Outcomes: `agree`; `refused` (by code); `client-only` (nothing placed on the server, counted by PL reason; the legs
still run); `invalid` (T failed); `generator-bug`; `divergent`. When N or J diverges from T, N and J are replayed again
without the frame check and J and R are compared with that run of N, so R is checked against Solid's own server on
every program, the divergent ones included.

| seeds | agree | client-only | refused | divergent | invalid | generator bug | R = N |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1..1000 | 454 | 406 | 109 | 31 | 0 | 0 | 889 / 891 |
| 1001..3000 (held out) | 913 | 825 | 210 | 52 | 0 | 0 | 1788 / 1790 |
| 1..100 (gate) | 50 | 42 | 7 | 1 | 0 | 0 | 93 / 93 |

Client-only programs by the PL reason that kept their sites client (a program counts once per reason; 1..1000):
M1 113, M8 119, PL-1 137, PL-3b 92, PL-3c 298, PL-3d 109, PL-5 113. Site recipes covered by agreeing and client-only programs
(1..1000, programs): boundary+show 52, boundary 158, count+elsewhere 33, count+show+elsewhere 18, count+show 29, count 104, owned+show 52, owned 144, owned-reactive+show 41, owned-reactive 124, pair+show 45, pair 123, record+elsewhere 24, record+inline 22, record+reactive 17, record+show+elsewhere 5, record+show+inline 4, record+show+reactive 7, record+show+structured 13, record+show 10, record+structured 30, record 50, stateful+show 51, stateful 170, static+show 60, static 188, static-literal+show 51, static-literal 170, top+show 38, top 125, top-stateful+show 49, top-stateful 136. The summaries are copied to rust-solid
`docs/frames-fuzz/` (`summary-1-1000.json`, `summary-1001-3000.json`, and the classifier's `families-*.json`).

**R against N.** rust-solid's server equals Solid's on every program the legs ran except four, the divergent ones
included (R is compared with N's own run there): 889 + 1788 programs, every document, frame stream, data and error
response byte for byte, with the same frames, frames seen, requests, host log and DOM. The four (675, 932, 1595, 2077)
are timing-dependent in Solid's client, not in the server: replayed on the same steps, the oracle split N itself ends
differently from run to run (seed 675: after issue 9's `NotReadyError` the action's refreshes are issued in one replay
of three, on N and on J alike; seed 1595: N diverges from the twin in two of four replays, J in three of four; seed 932's twin
flips one replay in five), and R's run simply took the other branch.

**Divergences, by suspected Solid issue** (`scripts/frames-classify.ts`; issues in
`docs/scratch/solid-rc21-issues.md` at the repository root). In every one, the oracle split N and the plan's split J
diverge from the twin T alike, at the same step, and rust-solid's server equals N; nothing of ours is in it, and none is
worked around. The classifier sorts by symptom (it does not root-cause each seed) and first replays each divergent seed
three times on T and on N against T's recording: a seed whose own twin does not replay would be `unstable`.

| family | 1..1000 | 1001..3000 |
| --- | --- | --- |
| Issue 8: a server component's switch and an action's refresh hold each other (N keeps showing a change T has shown, until the other lands) | 11: 19, 283, 332, 397, 411, 578, 656, 796, 862, 881, 907 | 12: 1121, 1168, 1293, 1299, 1390, 1441, 1560, 1644, 1855, 2002, 2097, 2924 |
| Issue 9: an island's handler throws `NotReadyError` (the click does nothing, so the next delivery has no request to deliver) | 9: 204, 230, 339, 459, 471, 593, 675, 723, 813 | 26: 1086, 1124, 1167, 1198, 1216, 1381, 1472, 1520, 1548, 1608, 1963, 1989, 2077, 2123, 2165, 2203, 2229, 2282, 2299, 2314, 2499, 2518, 2716, 2778, 2888, 2942 |
| Issue 10: a server root shown again by a `Show` renders its old answer (or holds the toggle) | 8: 246, 261, 282, 774, 901, 931, 982, 985 | 10: 1032, 1509, 1516, 1591, 1822, 1897, 2101, 2417, 2498, 2568 |
| Issue 11: an intermediate frame within one step (a refetched frame lands one frame after its transaction) | 2: 367, 934 | 1: 2267 |
| `unstable`: the twin itself does not replay its recording every time (Solid's outcome depends on timing there, on the all-client app too) | 1: 932 | 3: 1595, 1632, 2540 |

Every classified seed (all but the `unstable` ones) diverged on all three replays of N and replayed clean on all three
of T (issue 11's are about the frames seen within a step, which a replay's frame check does not see; their N frames
match). The gate's one divergent seed, 19, is issue 8; the minimal repros of issues 8, 9 and 10 are
`frames/repros/{switch-held,island-not-ready,reshow-stale}.ts`.

**Found and fixed on our side during the runs** (not divergences any more): owned-question roots made extra requests
when their site was under a `Show` (seeds 47, 70, 151), first with the call memo hoisted into the entry and then with a
`lazy` memo (a lazy async memo is not released while pending); owned roots are now applied as a client stub that owns
the call (`plan/split.ts`, PLAN-V2.md "The canonical split"). The harness checked the adoption of server-rendered keyed
elements before the deferred slot occurrences had mounted (seeds 589, 805 under load); it now waits for
`onHydrationEnd`. A run during which the disk filled up (`ENOSPC`) was discarded and rerun.

**Reproduce.**

```sh
nix shell nixpkgs#nodejs_24 -c sh -c '
  (cd ../rust-solid && cargo build --bin frames-server)
  npm run frames-fuzz -- --seeds 1000 --start 1 --rust $PWD/../rust-solid/target/debug/frames-server
  npm run frames-fuzz -- --seeds 2000 --start 1001 --rust $PWD/../rust-solid/target/debug/frames-server
  node --experimental-strip-types --no-warnings scripts/frames-classify.ts .out/frames-fuzz/run-1-1000
  npm run frames-corpus -- --out $PWD/../rust-solid/crates/runtime/tests/fixtures/frames'
```

### Deviations from the design (`docs/SLICE6-FRAMES.md`)

- **Owned roots** are applied as a client stub `<C>$frame` with the twin's props, not as a call memo in the entry (the
  design's spelling made extra requests under a `Show`; above).
- **The answer script** R replays is recorded from N's server host log at run time (`frames/slice.ts` `answerScript`),
  not stored in the scenario file; a call the script does not answer fails the Rust server.
- **The TSX refusals**: the frames tier refuses the forms plan v2.2 cannot represent at the TSX boundary
  (`TsxError.code`) where the RX builder refuses them in the plan (`FramesRefusal`); RX and TSX are compared by code.
  `FRAMES_EVAL_PLACE` is not implemented (no eval site reaches the frames builder in any test).
- **The PL pins** are three (PL-3c, PL-3d, PL-5, `plan/frames.test.ts`); the C15 pin (a staged refetch inside an action)
  was not built: the fuzz found the C15 class of difference in Solid instead (issue 11).
- **Not built:** the U legs (plan v2.2 with its placement ignored on `solid-plan.ts` and `plan-trace`).
- **The Rust server** is a std `TcpListener` server answering one request at a time (the harness forwards one at a
  time); its live-hole engine is the part the subset reaches (holes stay settled; every `sc:deps:` batch is `{}` or `!`);
  structured slot arguments, regions and parked fills are refused (v1).
- **The fuzz's divergent seeds** are listed in `baselines/frames-fuzz.json` with their classes; a new divergence, or a
  listed one that stops reproducing, fails the gate.

### Deferred

U legs; structured slot arguments and `props.children` (v1 refusals); server roots under a client `For`; eval sites
with `place`; filing issues 8–11 (drafts only); repinning when Solid's frames move.

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
