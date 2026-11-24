# Repin to Solid main: renderer, plan consumer, server renderer, Frames

The renderer (`slice1/universal.rs`, `slice1/events.rs`, `renderer.rs`), the plan v1/v2/v2.1 consumer (`plan_v2.rs`,
`scenario`, `plan-trace`), the server renderer (`src/ssr/`) and the frames server (`src/frames/`), moved from Solid
2.0.0-rc.21 (`2105ffb8`) to Solid `main` `30e7805e` (2.0.3+). The engine (scheduler, async memos, stores, lists,
boundaries: the rest of `slice1/`) was moved by the engine leg (`docs/PIN-MAIN-ENGINE.md`), merged here; where a gate
still differs because of it, the difference is listed under "Not ported", with its class, count and seeds.

Measured on branch `pin-main-rust-render`, with `solid-next` at `30e7805e`, the engine at `pin-main-rust-engine`
`048860f` and the frontend at `pin-main` `b047003` (both merged).

## Solid changes ported

| Solid change | What it changes | Ported in |
| --- | --- | --- |
| `96ffcf7b` (#4730), with `ea8e37c6` (#4945): the compiler lowers `<Show>` to the ternary it renders (production builds; `packages/compiler/src/shared/lower_show.rs`) | Native compiled TSX no longer calls `Show`: `{when ? <>children</> : fallback}`, compiled by `transformCondition` (`shared/condition.rs`). Host ops change order (an insert's sentinel now comes before the branch's nodes), `Show`'s three memos become two, and on the server `Show` no longer takes an owner id, so hydration keys after it shift (tracker rows `_hk=7000…` → `6000…`; the fuzz's `9000` → `8000`) | `plan_v2.rs` `lowered_show` (client), `ssr/plan.rs` `lowered_show` (server), `fuzz/plan-oracle.mjs` (plan-diff's JS oracle) |
| `b9475d74` (#5017): `attachDelegatedEvent` adds the capture listener `resetDelegatedEvent` before the bubble handler; `registerDelegatedRoot` drops the `roots` counter (`web/src/client.ts`) | Every delegated container logs one more `addEventListener` (the reset first, the handler second), and every later function id shifts by one: tracker 453 → 454 entries, like 34 → 35, tracker-async 399 → 400, eval slice 363 → 364 | `slice1/events.rs` (`Listener::Reset`, `reset_delegated_event`), `renderer.rs` dispatch |
| `842144cc` (#5112): numeric text reaches the renderer as a string (`universal.ts` `insertExpression` `value.toString()`, `normalize` `"" + item`) | `createTextNode`/`replaceText` log `"2"` where rc.21 logged `2` | `slice1/universal.rs` `as_text` |
| `f5252ddd` (#5152): `insert`'s outer effect reschedules its inner effect on a rerun (`ran`), not on a defined previous value | Only a first compute that returned `undefined` and then a function differs | `slice1/universal.rs` `insert` |
| `b884d6ea` (#5043): the hydration bootstrap records each event's original target (`events.push([s,o,n])`) | The t=0 document's inline script (frames) | `ssr/web.rs` `generate_hydration_script` |

Not ported because nothing here reaches it: `ref` through `runRefCallback` (#4761; the port has no `ref`), the client's
`template`/`importNode`, `insertExpression`'s `_$d` cache (web client, not universal), the server's head registry,
spreads, `ssrElement`, `markRaw`, `heldRead`, `strictHandler`.

## Gates, before and after

"Before" is the Rust tree at `eab38b2` (unchanged, rc.21 behaviour) against Solid main; "after" is this branch with the
engine leg merged (`pin-main-rust-engine` through `048860f`) and the frontend at `pin-main` (through `b047003`).

| Gate | Recorded (rc.21) | Before | After |
| --- | --- | --- | --- |
| `cargo test` | 175 | 175 (it replays the rc.21 fixtures and never calls Solid; against fixtures re-recorded at Solid main it fails eval, plan_fuzz, plan_v21, render, tracker, ssr and frames) | 175 |
| `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings` | clean | clean | clean |
| `scenario` tracker / like v1, v2 / tracker-async | 13 frames, `["0","1","0","1","1"]` ×2, 18 frames | same | same |
| `plan-diff` tracker / like / tracker-async | 453/453, 34/34, 399/399 | — | 454/454, 35/35, 400/400 (the reset listener, #5017) |
| render fuzz 1–1000 (`node fuzz/run.mjs --render`) | 993, 7 invalid | 420, 7 invalid | 993, 7 invalid; `summary.json` byte-identical to `render-fuzz/port/summary-1-1000.json` |
| plan fuzz 1–1000, Rust leg | 0 Rust classes | `rust: addEventListener-*` on every program | 0 Rust classes (306 agree, 563 upstream: RX only, 131 refused, 0 divergent) |
| plan fuzz v2.1 1–1000, Rust leg | 0 | every program | 1 Rust class: seed 19 (`rust: step-getFirstChild`, engine) |
| eval fuzz 1–1000 | 869 agree, 131 refused | — | 869 agree, 131 refused, 0 divergent |
| eval fuzz v2.1 1–1000 | 878, 122 refused | — | 877 agree, 122 refused, 1 divergent (seed 19, `rust: result`, engine) |
| SSR fuzz 1–1000 `--dev` | 869 agree, 0 HTML, 0 hydration, 131 refused | 1–20: 16 HTML failures (keys), 4 refused | 869 agree, 0 HTML, 0 hydration, 131 refused; `summary.json` byte-identical |
| SSR fuzz v2.1 1–1000 `--dev` | 878 agree, 0 stream/HTML/hydration, 122 refused | — | 878 agree, 0 stream/HTML/hydration, 122 refused |
| frontend tests on these legs (`plan/plan-fuzz`, `eval/eval`, `slices/{eval,eval-async,tracker,tracker-async,like}`; `ssr/ssr`, `ssr/ssr-async`, `slices/tracker-frames`, `plan/frames`) | pass | tracker-async 400 vs 399, SSR keys, frames R ≠ N | 47/47 and 31/31 |
| placement fuzz 1–100 | 50 / 42 client-only / 7 refused / 1 divergent (19), R = N 93/93 | R/N wire | 50 / 42 / 7 / 1 (19), R = N 93/93 |
| placement fuzz 1–1000 | 454 / 406 / 109 / 31, R = N 889/891 | — | 447 / 405 / 109 / 39, R = N 886 of 891; R ≠ N on 5, 48, 360, 675, 932 (below) |

The frames runs need a test-environment shim here (`NODE_OPTIONS=--import` a module that maps `realpathSync` back
under the worktree): in a worktree whose `solid-next` is a symlink, `frontend/frames/harness.ts` computes seroval's
URL as `relative(PNPM, realpathSync(…))` with an unresolved `PNPM`, and the browser asks for
`/rx-pin-main/solid-next/…` (404). Without the shim `slices/tracker-frames.test.ts` fails 5 of 10. Frontend fix:
`realpathSync` on both sides.

## Re-recorded fixtures

Each was re-recorded only after the Rust leg was checked against the new Solid output; the old and new files were
diffed and every difference is one of the Solid changes above.

| Fixture | Recorded by | What changed | Why |
| --- | --- | --- | --- |
| `tests/fixtures/render-units.json` | `docs/render-fuzz/tools/unit-expectations.mjs` | `text_types`, `for_keyed_modes`, `conditional_fragments`: numbers → strings; `delegated_events`, `stop_propagation`, `native_events`: the reset listener and fn-id shift | #5112, #5017 |
| `tests/render.rs` (`api_insert_text_and_frame`) | by hand | the tree holds `[5, "2"]` | #5112 |
| `tracker.oracle.json`, `like-v2.oracle.json`, `tracker-async.oracle.json` | `node --conditions=browser fuzz/plan-oracle.mjs PLAN SCENARIO` | +1 `addEventListener`, fn ids +1; results unchanged | #5017 (the oracle's Show lowering changes no entry on these three) |
| `tests/plan_v21.rs` | by hand | tracker-async log length 399 → 400 | #5017 |
| `plan-fuzz/*.json` (12) | the same seeds rerun through `plan/fuzz/run.ts` (`/tmp` script; `plan-fuzz-corpus.ts` needs every leg to agree, and the RX leg has the new listed class `UPSTREAM_RX_SHOW`) | `native` only (plan and scenario identical); Rust = native on all 12 | #4730, #5017, #5112 |
| `plan-fuzz-async/*.json` (12) | the same seeds, `runAsyncCase` | `native`, and on 5 seeds the scenario native recorded (requests no longer re-issued, #5094); recorded as Solid's truth while Rust still differed on 6 (the engine at rc.21); after the engine merge Rust = native on all 12 | #4730, #5017, #5094 |
| `eval/seed-*.json` (4 of 5; seed 4 is a refusal and keeps its trace) | the same seeds, `runEvalSeed` | `trace`; `status` kept (`agree`: only the frontend's JS eval legs differ); Rust = static twin on all 4 | #4730, #5017 |
| `eval/slice.json` | `scripts/eval-slice.ts`'s recording, Rust fixture only (`/tmp` script, no frontend files written) | plan and table: `optimistic shown :=` → `guess shown :=` and nothing else; trace: reset listener, Show order; Rust = static twin | reactivescript #47, #4730, #5017 |
| `eval-async/*.json` (2) | `runEvalSeed(…, { async: true })` | seed 198: nothing; seed 56: `static` and scenario (#5094; Rust = static after the engine merge) | #5094 |
| `ssr/*.json` (12 of 13 changed) | `npm run ssr-corpus -- --start 1 --seeds 300 --max 16` (same 13 programs) | the HTML's hydration keys after a `<Show>` | #4730 |
| `tests/ssr.rs` (`an_integer_hole_takes_no_id…`) | `solidServer` on the twin | `_hk=30` → `20`, `40` → `30` | #4730 |
| `ssr-async/*.json` (3 of 14 changed) | `npm run ssr-corpus -- --async --start 1 --seeds 3000 --max 16` (same 14) | stream chunks and HTML keys | #4730 |
| `frames/*.json` | `npm run frames-corpus -- --out … --max 12` | every document (bootstrap script, keys); the seed set is now 4, 5, 13, 17, 32, 47, 50, 70, 78, 134 (was 4, 5, 11, 13, 17, 32, 41, 78, 134) | #5043, #4730; `--max 12` because the default 10 now stops at 9 seeds with `record+reactive` uncovered and 47 exchanges, under the test's 50 |

## Not ported, by class

Measured after the engine merge. Each is reactive timing or Solid's own nondeterminism, not host-op order, keys or
HTML.

- **`isPending` over two rejected sources** (engine, `verdict.ts`): plan fuzz v2.1 seed 19 (`rust: step-getFirstChild`)
  and the same program in the eval fuzz v2.1 (`rust: result`). After `loadIssues` and `loadTotal` reject (steps 5 and
  6), native's `isPending(() => issues().length + total())` stays true ("busy"); Rust's turns false ("ready",
  `getFirstChild`/`replaceText` at step 6). It agreed at rc.21. The scenario: step 4 asks `loadIssues#2` and `loadTotal#3`;
  steps 5 and 6 reject `loadTotal#2` (superseded) and `loadTotal#3` while `loadIssues#2` is still out (it lands at
  step 10). Rust's `is_pending_window` is Solid's `isPending` line for line, so the difference is upstream of the probe:
  whether the `<b>` render effect, inside the issues `Loading` that is waiting, reruns at step 6, and what the
  `issues()` read reports there. Not fixed here; it needs the engine traced against Solid's.
- **Placement fuzz R ≠ N on 5, 48, 360** (1–1000 run, made while the eval fuzz ran beside it): each agrees, with
  R = N, when rerun alone (twice each). 675 and 932 are the documented unstable seeds (Solid's own client ends
  differently from run to run, docs/HANDOFF.md "Caveats"). The 1–1000 frames summary is not re-recorded: the run was
  under load and the summary is not byte-reproducible.

Not re-measured: the held-out ranges (1001–3000 for the plan, eval and SSR fuzz, 1001–3000 for the render fuzz and the
placement fuzz). Their recorded summaries are still rc.21's.

Before the engine merge (the engine still at rc.21), the classes left on these legs were all the engine's: `refresh()`
of a pending async memo re-asked at once where Solid main waits for the answer (#5094/#5101; plan fuzz v2.1
`rust: step-request`, 340 of 1000), effects reordered within a flush, a branch computed twice in a transition, and a
write reverted before the flush rerunning an effect (render fuzz 979/1000). None of them had a Rust difference at
mount. The merge removed all of them but seed 19.

## Recorded summaries

| Summary | Status |
| --- | --- |
| `render-fuzz/port/summary-1-1000.json` | unchanged: the rerun is byte-identical |
| `ssr-fuzz/summary-1-1000.json` | unchanged: the rerun is byte-identical |
| `ssr-fuzz/summary-async-1-1000.json` | re-recorded: Rust agrees on all 878; what moved is native's own (recorded scenario lengths, 16146 → 15773 continuation steps; notes on Solid's own dev stream console, 203 → 209, and fresh elements, 106 → 102) |
| `plan-fuzz/summary-1-1000.json` | re-recorded: Rust equals native on all 869 accepted programs; the RX leg's new upstream class (Solid #4730, `UPSTREAM_RX_SHOW`) moves 555 programs from agree to upstream |
| `eval/summary-1-1000.json` | re-recorded: same 869 agree, 131 refused; `logEntriesPerLeg` 313420 → 314295 (the reset listener, Show order) |
| `plan-fuzz/summary-async-1-1000.json`, `eval/summary-async-1-1000.json` | not re-recorded: seed 19 still differs in Rust |
| `frames-fuzz/*`, every `*-1001-3000.json` | not re-recorded (above) |
