# Repin to Solid main: renderer, plan consumer, server renderer, Frames

The renderer (`slice1/universal.rs`, `slice1/events.rs`, `renderer.rs`), the plan v1/v2/v2.1 consumer (`plan_v2.rs`,
`scenario`, `plan-trace`), the server renderer (`src/ssr/`) and the frames server (`src/frames/`), moved from Solid
2.0.0-rc.21 (`2105ffb8`) to Solid `main` `30e7805e` (2.0.3+). The engine (scheduler, async memos, stores, lists,
boundaries: the rest of `slice1/`) is moved separately; where a gate here still differs because of it, the difference
is listed under "Not ported", with its class, count and seeds.

Measured on branch `pin-main-rust-render`, with `solid-next` at `30e7805e` and the frontend at `pin-main` (merged).

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

"Before" is the Rust tree at `eab38b2` (unchanged, rc.21 behaviour) against Solid main; "after" is this branch.

| Gate | Recorded (rc.21) | Before | After |
| --- | --- | --- | --- |
| `cargo test` | 175 | 175 (it replays the rc.21 fixtures and never calls Solid; with only the fixtures re-recorded to Solid main it fails eval, plan_fuzz, plan_v21, render, tracker, ssr and frames) | 173 pass, 2 fail (plan_v21: the async corpora, engine) |
| `plan-diff` tracker / like / tracker-async | 453/453, 34/34, 399/399 | — | 454/454, 35/35, 400/400 |
| render fuzz 1–1000 (`node fuzz/run.mjs --render`) | 993, 7 invalid | 420, 7 invalid | 979, 8 invalid (7 Solid throws, 1 oracle timeout) |
| plan fuzz 1–100, Rust leg | 0 rust classes | `rust: addEventListener-*` on every seed | 2 rust classes (seeds 27, 93: engine) |
| plan fuzz v2.1 1–100, Rust leg | 0 | every seed | engine classes only (below) |
| SSR fuzz 1–40 / v2.1 1–40 | all agree | 16 HTML failures / — | 36 agree, 4 refused / 35 agree, 5 refused, 0 stream, HTML or hydration differences |
| tracker-frames (frontend, R leg) | 10/10 | R ≠ N (t=0 document) | 10/10 |
| placement fuzz 1–100 | 50 / 42 / 7 / 1 (seed 19), R = N 93 | — | 50 / 42 / 7 / 1 (seed 19), R = N 93/93 |

Long runs (1–1000): see "Long runs" below.

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
| `plan-fuzz-async/*.json` (12) | the same seeds, `runAsyncCase` | `native`, and on 5 seeds the scenario native recorded (requests no longer re-issued); Rust = native on 6, differs on 6 (engine, below) | #4730, #5017, #5094 |
| `eval/seed-*.json` (4 of 5; seed 4 is a refusal and keeps its trace) | the same seeds, `runEvalSeed` | `trace`; `status` kept (`agree`: only the frontend's JS eval legs differ); Rust = static twin on all 4 | #4730, #5017 |
| `eval/slice.json` | `scripts/eval-slice.ts`'s recording, Rust fixture only (`/tmp` script, no frontend files written) | plan and table: `optimistic shown :=` → `guess shown :=` and nothing else; trace: reset listener, Show order; Rust = static twin | reactivescript #47, #4730, #5017 |
| `eval-async/*.json` (2) | `runEvalSeed(…, { async: true })` | seed 198: nothing; seed 56: `static` and scenario (Rust differs, engine) | #5094 |
| `ssr/*.json` (12 of 13 changed) | `npm run ssr-corpus -- --start 1 --seeds 300 --max 16` (same 13 programs) | the HTML's hydration keys after a `<Show>` | #4730 |
| `tests/ssr.rs` (`an_integer_hole_takes_no_id…`) | `solidServer` on the twin | `_hk=30` → `20`, `40` → `30` | #4730 |
| `ssr-async/*.json` (3 of 14 changed) | `npm run ssr-corpus -- --async --start 1 --seeds 3000 --max 16` (same 14) | stream chunks and HTML keys | #4730 |
| `frames/*.json` | `npm run frames-corpus -- --out … --max 12` | every document (bootstrap script, keys); the seed set is now 4, 5, 13, 17, 32, 47, 50, 70, 78, 134 (was 4, 5, 11, 13, 17, 32, 41, 78, 134) | #5043, #4730; `--max 12` because the default 10 now stops at 9 seeds with `record+reactive` uncovered and 47 exchanges, under the test's 50 |

## Not ported (engine), by class

All of these are reactive timing, not host-op order, keys or HTML: the Rust renderer emits the same operations, at a
different time or a different number of times, because the engine still schedules as rc.21 did.

- **`refresh()` of a pending async memo** (Solid `99db9bce`, #5094/#5101): native waits for the answer that is out and
  re-asks once; Rust re-asks at once. Plan fuzz v2.1 class `rust: step-request` (37 of 100 seeds on 1–100, e.g. 1, 2,
  3, 4, 10, 101); also `rust: request-request` (97), `rust: createTextNode-request` (13), eval-async seed 56. Failing
  tests: `plan_v21::generated_async_programs_give_native_solids_host_log` (seeds 1, 2, 3, 4, 28, 101),
  `plan_v21::async_eval_programs_give_the_static_twins_host_log` (seed 56).
- **A write reverted before the flush** (render fuzz `*-tree-*`, e.g. seeds 216, 309, 439, 452, 567, 588; the reduced
  programs write a signal and write it back, then flush): native reruns nothing; Rust reruns the effect and the host
  sees an equal `setProperty` or a recreated text node.
- **Render-effect order within one flush across regions** (plan fuzz seed 93; v2.1 seeds 25, 38, 64): the same
  updates, in another order.
- **A branch computed twice in a transition** (plan fuzz seed 27; v2.1 seeds 19, 28, 52): native creates a Show's
  fallback twice (compute in the transition's lane, then at its commit) or defers a text update by a step.
- **Render fuzz seed 741** (`text-createTextNode-insertNode`): a `cmemo` hole whose first value owns an inner effect
  does not update on the second write in Rust; it fails the same way with the rc.21 `insert`, so it is not the
  `ran` port.

## Long runs

(filled in below from the 1–1000 runs)
