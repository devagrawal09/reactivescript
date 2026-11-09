# Handoff: ReactiveScript frontends and Solid-model work

Updated 2026-11-09 (all project work consolidated into one branch, `solid-model`). Read this first, then `dashboard/notes.json`. The work runs in a Tembo sandbox; the working copy is `/workspace/rx-tsx-refresh/solid-model`, on branch `solid-model`, not on the Mac (see "Environment").

## Goal
Write Solid-style code in other syntaxes (Solid TSX, solid-yield's generator syntax), lower it onto ReactiveScript's (RX) existing AST, and accept a program only if it behaves exactly like native Solid; refuse everything else, with a diagnostic.
The broader direction: **"Solid" is a semantic model plus a conformance suite.** Syntaxes, host languages, runtimes (Solid JS, a Rust port), renderers and client/server placement are plugins around that core.

## How the user works
- **You plan and design; implementation goes to background subagents** (background workflows in the sandbox; on the Mac it was Codex: `sol`, `astra`, `luna`). Delegate everything, including verification reruns and push retries; never block on a foreground agent. Use **several cheap agents at once, with different but overlapping focuses.** Don't pass `model: 'sonnet'` to workflow agents here: it resolves to an unavailable model and fails silently. Omit the model and lower the effort instead.
- Ask decisions two at a time.
- Keep answers concise and code-heavy. Keep three things distinct: syntax we recognize, the verified subset, and full readiness.
- Prefer vertical slices (tracer bullets) to horizontal layers.
- Give every agent its own git worktree of `solid-model` (`git -C /workspace/reactivescript worktree add`, directly under `rx-tsx-refresh/`), with `reactivescript` and `solid-next` symlinked at its root to the shared checkouts (gitignored) and `frontend/upstream` created by setup's symlink step (`[ -L frontend/upstream ] || ln -s ../reactivescript frontend/upstream`, from the root; also gitignored), so `frontend/upstream` and the `../solid-next` paths resolve without rebuilding Solid. Review, rerun the gates, then merge.
- **Never publish** (push, open PRs or issues, comment) without the user's explicit OK.
- **Never touch:** `/workspace/reactivescript` (the main clone; every `rx-tsx-refresh/` worktree hangs off it) and `/workspace/solid` (the user's fork, on `main`; don't pull it without asking). On the Mac the equivalents were `/Users/devagr/reactivescript` (an intentional uncommitted experiment: HEAD `f3c6771`, 13 changes), `/Users/devagr/solid-next`, `/Users/devagr/solid-yield` and `/Users/devagr/solid`.
- The shared checkouts `rx-tsx-refresh/{reactivescript,solid-next}` are read-only for agents. A fresh clone gets its own with `sh scripts/setup.sh`.
- Verify agents' claims yourself before reporting them. Their results are sometimes truncated or incomplete.

## Environment (Tembo sandbox)
- Node 24 comes from nix: prefix node commands with `nix shell nixpkgs#nodejs_24 -c` (that gives 24.11.1, not the pinned 24.18.0). rustc is 1.96.0, not the pinned 1.97.1. solid-next is built with pnpm 11.1.1.
- **`git push` fails**: the sandbox's git credentials return HTTP 500. `tembo commit` pushes through the API and works: it creates a verified commit on `origin/<current local branch>`, which must already exist: `tembo commit` can't create a branch, so the user creates each new branch on GitHub and it is then filled with `tembo commit`. `tembo merge` still needs git credentials.
- **The `tembo commit` API rejects any file with mode 100755 (executable) or 120000 (symlink).** So `scripts/setup.sh` and `docs/scratch/solid-rc21-repros/run-all.sh` are committed as 100644 and always run as `sh scripts/setup.sh` and `sh docs/scratch/solid-rc21-repros/run-all.sh`, and `frontend/upstream -> ../reactivescript` is not committed: it is gitignored and `scripts/setup.sh` creates it before `npm ci` and the gates. The frontend's `"#rx/*"` imports (`./upstream/ref/*`), its type check, `verify-pinned.sh` and `tsx/boundary.test.ts` all go through it, so the frontend gate fails without it.
- The layout was rebuilt on 2026-11-07 as worktrees of the GitHub backup branches, and consolidated on 2026-11-09 into one repository layout on the `solid-model` branch (below).
- `dashboard/collect.mjs` reads paths relative to the repository (its frontend gate checks the `solid-model` branch; `DASHBOARD_GATE_BRANCH` overrides it). Start it with `cd dashboard && nohup node server.mjs > server.log 2>&1 &` (port 4173).

## Where things live: the `solid-model` branch (`/workspace/rx-tsx-refresh/solid-model`)
One repository layout, on one branch of `devagrawal09/reactivescript`. The root `README.md` has the setup and every gate.
| Path | What |
|---|---|
| `frontend/` (was `frontend-tracker/`) | The TSX and yield frontends, the differential fuzzer, the gate. Slice 1 (like), slice 2 (the tracker, scenario v2, plan v2, `plan/docs/PLAN-V2.md`), the plan fuzz (`plan/fuzz/`), slice 3's live evaluator (`docs/EVAL.md`, `eval/`, `slices/eval/`) and slice 5's SSR oracle (`ssr/`, Chromium hydration). `npm run verify:subset` gives **PASS 106/106** with the default `RUST_SOLID=../rust-solid`; results in `docs/RESULTS.md` |
| `rust-solid/` (was `rust-tracker/`) | The Rust runtime: the slice-1 scheduler port, tiers 2a, 2b, 2c, strings, the universal renderer, the plan v2 consumer, the eval table (`plan-trace PLAN SCENARIO EVALS`, `docs/EVAL-CONSUMER.md`) and the server renderer (`src/ssr/`, `ssr` binary, `docs/SSR.md`). `cargo test`: 132 pass |
| `docs/` (was `docs/`, branch `project-docs`) | This handoff, `HISTORY.md` (the consolidated branches' SHAs, logs and ancestry), and `scratch/` research notes and drafts: `slice1/*`, `compiler-architecture-review.md`, `interp-issue/`, `solid-rc21-issues.md` and `solid-rc21-repros/` |
| `dashboard/` (was `dashboard/`, branch `project-dashboard`) | The status dashboard. Edit `notes.json` by hand when the state changes; `node --test test.mjs` checks it |
| `scripts/setup.sh` (run with `sh`) | Creates `frontend/upstream -> ../reactivescript` if missing, clones `reactivescript/` and `solid-next/` at the pins, builds Solid as reactivescript's `ref/scripts/solid-next.sh` does, `npm ci` in `reactivescript/ref` and `frontend/`, `cargo build` in `rust-solid/`. Idempotent; `--check` changes nothing |
| `reactivescript/`, `solid-next/` (gitignored) | The pinned checkouts: RX `fdbcad92`, Solid `2105ffb8` (rc.21). In the sandbox they are symlinks to the shared `rx-tsx-refresh/{reactivescript,solid-next}` |

The folder names are the old sibling directories' names, so the relative paths (`../reactivescript`, `../solid-next`, `../rust-solid`, `frontend/upstream -> ../reactivescript`, which `scripts/setup.sh` creates because it is not committed) keep working.

**The old checkouts under `/workspace/rx-tsx-refresh/` are superseded** and kept only until the user says otherwise: `frontend-tracker/` and `rust-tracker/` (copied into `solid-model` as `frontend/` and `rust-solid/`), `docs/` and `dashboard/` (copied likewise), `frontend/` (`frontend-main`, the local slice-1 merge `56feaff`), `frontend-eval/`, `rust-eval/`, `frontend-ssr/`, `rust-ssr/` (slices 3 and 5 as they were built), `frontend-publish/`, `rust-parity/`, `rust-tierb/`, `rust-tierc/`, `rust-solid/` (`rust-slice1`, `012b5de`, the pre-port v1 consumer), `rust-solid-main/` (`4a1090c`, M1), `slice1-js/` and `slice1-plan/`.

## Branches on GitHub (devagrawal09/reactivescript)
| Branch | Contents |
|---|---|
| [`solid-model`](https://github.com/devagrawal09/reactivescript/tree/solid-model) | **Everything**: the layout above. It starts at `tsx-frontend-workspace`'s `7791984`, so the frontend keeps its history |
| `tsx-frontend-workspace` (`7791984`), `tsx-frontend-slice1-like` (`158bea5`), `tsx-frontend-slice1-plan` (`f315116`), `rust-solid-main` (`4a1090c`), `rust-solid-slice1` (`4276aba`), `project-docs` (`f920b7b`), `project-dashboard` (`41639f9`) | **Consolidated** into `solid-model`, **not deleted yet**: the user will delete them on GitHub after verifying `solid-model`. `docs/HISTORY.md` records each one's final SHA, full log and ancestry; only `tsx-frontend-workspace`'s history is an ancestor of `solid-model`, so the others' commits exist only as that record once they are deleted |
| [`tsx-frontend-demo`](https://github.com/devagrawal09/reactivescript/tree/tsx-frontend-demo) | PR #21's current head (`cc1e6e9`). Not part of the consolidation |
| [`pr21-v1-archive`](https://github.com/devagrawal09/reactivescript/tree/pr21-v1-archive), [`pr21-v2-archive`](https://github.com/devagrawal09/reactivescript/tree/pr21-v2-archive) | Earlier PR #21 versions (`2d74222`, `00f84fe`). Not part of the consolidation |

Not uploaded: `scratch/rune` (a clone of a third-party repo), `scratch/original-suite-run` and `scratch/pr-v2-ignored-leftovers` (old run output).

## Published (ryansolid/reactivescript): no replies from Ryan yet
- **#21:** draft demo PR. Two frontends, the same counter in three syntaxes, the tracker, stale-write, the fuzzer. 58 files, on clean `main`.
- **#20:** should ordinary async callbacks get an explicit form? The frontend refuses them meanwhile.
- **#33:** the interpreter and compiler disagree on writes around pending actions. Found by our fuzzer, 46 of 500 seeds.
- **#1:** Ryan's architecture issue: lowering should consume checker facts; no stable IR.

## Current state: everything consolidated into `solid-model`, every gate passes
- **Consolidated 2026-11-09** into one branch, `solid-model` (the layout above), at the user's request; `docs/HISTORY.md` records the old branches, which are not deleted yet (the user will delete them on GitHub after verification). The gates were rerun in place in `solid-model` before the commit: frontend `npm run verify:subset` **PASS 106/106** with the default `RUST_SOLID`, `cargo test` 132, the like and tracker scenarios, fmt, clippy and `--slice1` seeds 1–200 (200/200).
- **Integrated 2026-11-08** (workflow `wf_68d50fef-8ea`): slice 3 (the live evaluator) and slice 5 (Rust SSR hydrated by Solid) were built in copies of the tracker trees and applied to `frontend-tracker` and `rust-tracker` (now `frontend/` and `rust-solid/`) together.
- **Gates on the integrated trees (2026-11-08):**
  - Frontend `RUST_SOLID=…/rust-tracker npm run verify:subset`: **PASS 106/106** (90 + 8 eval + 8 SSR); fuzz 0–199 unchanged (179 ok, 21 listed); plan, eval and SSR fuzz seeds 1–100 each 85 agree / 15 refused; strict types 0 package diagnostics, 12 upstream.
  - Seeds 1–1000, byte-identical to the recorded summaries: plan fuzz (861 agree, 8 upstream RX-only, 131 refused), eval fuzz (869 agree, 131 refused, 0 divergent), SSR fuzz with dev hydration (869 agree, 0 HTML differs, 0 hydration fails, 131 emitter refusals); `--slice1` 1000/1000, `--slice2a` 991, `--slice2b` 1000, `--slice2c` 999, `--render` 993, `--strings` 1000.
  - Rust: `cargo test` 132 (117 + 5 eval + 9 SSR + 1 integration); tracker and like scenarios pass, `plan-diff` 453/453 and 34/34; fmt, clippy `-D warnings`, `git diff --check` clean. SSR Chromium tests 7/7.
  - `--slice2c` with reduction on crashes the runner while reducing seed 493 (the known store-hole Solid bug throws uncaught); the summary is from `--no-reduce`, as the held-out runs are. Pre-existing, not caused by the integration.
- **The one conflict:** slice 3 added `eval` forms to plan v2 and slice 5's server lowering matched plans exhaustively, so the merged crate did not compile. The server renderer now refuses any plan with an eval site, and an evaluated code's plan, with a diagnostic (`docs/SSR.md`, "Refused"; test `eval_sites_are_refused`). Everything else was a union (test globs, scripts, gate steps, `report.ts`, `baselines/subset-tests.json`, READMEs, RESULTS.md).
- **Slice 3, live evaluator** (`frontend/docs/EVAL.md`): `{eval(code, {…})}` in RX and `createEval(() => code, {…})` in TSX, markup and value sites. Binding types are derived from the checked enclosing component (`plan/types.ts`), not TS types. A markup eval is a keyed `Show` over the compiled code; refusals are typed `EvalRefused` errors for `Errored`. JS runs the plan on `solid-plan.ts`; Rust gets the host's table of compiled plans. Upstream is untouched. Deferred: `preserve`, `place`, `syntax: "yield"`, `Errored` in Rust, component-position eval sites, nested eval (recognized, not exercised), value evals/explicit interfaces in the fuzz.
- **Slice 5, SSR** (`rust-solid/docs/SSR.md`, `frontend/docs/RESULTS.md`): Rust renders a v2 plan to HTML byte-identical to Solid 2's `renderToString` of the plan's *canonical* TSX twin, and Solid's client hydrates it in Chromium and replays the scenario. Deviation: a plan can't tell `{n()}` from `{"" + n()}`, so the idiomatic `tracker.tsx` renders `_hk=8000…` where Rust renders `_hk=7000…`. Not ported: async server data (not expressible in plan v2), Rust hydration, `renderToStream`/document shell, attributes, eval sites.

## Earlier state: slice 2's tracker gate passes
- **Pushed 2026-11-08 with `tembo commit`, one ordinary commit each:** `rust-tracker` as `4276aba` on `rust-solid-slice1` (on top of `147d971`), and the frontend (slice-1 merge `56feaff` plus the tracker work) as `7791984` on `tsx-frontend-workspace` (on top of `fe650c1`). This handoff and the dashboard `notes.json` were pushed to `project-docs` and `project-dashboard` right after.
- **Slice 1, Rust parity done:** `147d971` is a structural port of Solid's scheduler for slice 1. Exact-trace fuzz against Solid JS: **1000/1000** (it was 7/1000). Pushed to `rust-solid-slice1` with `tembo commit`.
- **Rust tiers, all in `rust-tracker` (now `rust-solid/`):**
  - 2a, async memos (`--slice2a`): **991/1000**: 8 invalid, plus seed 629 failing closed.
  - 2b, stores and per-row optimistic writes (`--slice2b`): **1000/1000**.
  - 2c, lists (mapArray/For), Show and parked frames (`--slice2c`): **999/1000**: seed 493 invalid. Every valid program agrees.
  - Strings (`--strings`): 1000/1000.
  - The universal renderer, a line-for-line port of Solid 2's `@solidjs/universal` (never dom-expressions): render fuzz **993/1000**, and every valid program agrees (the 7 invalid ones throw in Solid itself).
  - Plan v2 consumer and scenario v2 runner.
- **Slice 2 gate passes:** the 13-frame tracker scenario gives identical frames on native Solid, on compiled TSX, RX and yield, and on Rust running the plan emitted from each of the three syntaxes. The three plans are byte-identical. Rust's full host log equals Solid's, 453/453 entries. Frontend gate **PASS 83/83**.
- **Plans are now fuzzed** (plan fuzz, see above). Earlier: only the tracker and like plans were checked. The scenario doesn't cover a filter toggle while a claim is pending, two claims on one row, a store change under a live guess, or non-overlapping transactions.
- **Suspected Solid rc.21 bugs, none filed** (each has a standalone repro in `rust-solid/docs/`):
  - `take(n, l, true)` (lanes.ts:174-181) clears a slot's transaction but leaves CONFIG_HELD set, so the next `txOf` throws (`slice2b-fuzz/port/solid-bug-take-held.mjs`).
  - A store array's `has` and `get` disagree, so `mapArray` gets a hole (an `undefined` row); on optimistic and plain stores (`slice2c-fuzz/solid-bug-optimistic-hole*.mjs`, `slice2c-fuzz/port/solid-bug-plain-store-hole.mjs`).
  - Universal's `reconcileArrays` removes a node without an `isLive` check: the map-fallback removal at universal.ts:313, when one node is shared by two regions (`render-fuzz/port/solid-bug-shared-node.mjs`).
  - Slice 2a: Solid emits non-scalar values (`undefined` or an error object) in 8 async programs of 1–1000; and seed 629, a held error read back as a plain value.

## Design discussion: eval (built as slice 3, see above)
The user proposed `createEval(() => "...rx code...", { ...bindings })`, or `eval` as an `.rx` language feature. Where it landed:
- **One more reactive source**, not running a string: the code string is a source, checking it is async (Loading/pending), and a checker rejection is an ordinary typed error for an error boundary. Changing the string rebuilds the subtree, like a keyed boundary.
- **Explicit bindings only**, like indirect eval: the code never sees the surrounding scope, it is read-only unless writes or actions are passed in, and host functions are passed explicitly. The bindings' types are the checker's whole environment.
- **The plan is the evaluation IR**: parse → check → plan → run on whichever runtime hosts it (Solid JS or Rust). Not the interpreter (#33). Eval is a strong reason to close the plan's AST fallbacks.
- **RX is the default syntax**, `eval` a language feature there. TSX is optional, through `createEval`. Yield later, if anyone needs it.
- **All three use cases, one primitive with options:** AI-generated UI (strict checking, capability-only bindings, may run on the server), a live playground or REPL (`preserve` state across edits), and plugins (a versioned, typed bindings interface).
- Built as slice 3 (above), except `preserve` (REPL) and `place` (server placement), which are refused with a diagnostic and designed in `docs/EVAL.md`.

## Open decisions (ask the user first)
- **Deleting the consolidated branches:** the user will delete them on GitHub after verifying `solid-model`; don't delete them from the sandbox. `solid-model` holds their trees and `docs/HISTORY.md` their histories; only `tsx-frontend-workspace`'s commits are ancestors of `solid-model`. Never touch `main`, `tsx-frontend-demo`, `pr21-v1-archive`, `pr21-v2-archive` or `claude/project-thread-*`.
- **File the Solid issue?** The draft is local: `docs/scratch/solid-rc21-issues.md` with repros in `scratch/solid-rc21-repros/`. Nothing is filed.
- **The SSR canonical twin:** accept that Rust renders the generator's canonical twin (integer holes coerced), so idiomatic TSX like `tracker.tsx` gets different hydration keys; or record the hole's spelling in the plan (a plan v2 change).
- **Eval follow-ups, which first:** `preserve` (REPL state), `place` (server placement), yield syntax (needs action parameter types), an `Errored` port in Rust, eval on the server.
- **Next slice:** native window (slice 4, Blitz or Masonry), async server data (needs a plan form for an async source first; `docs/SSR.md`, "Next"), Rust hydration, or inferred server components (slice 6).

Planned slices: 4, a native window; 6, inferred server components over Solid's Frames. Slices 1, 2, 3 and 5 are done (verified subsets, not full readiness).

## Parked (don't start without the user)
- Generative UI on top of the live evaluator (slice 3 built the primitive; strict checking and capability bindings are there, `place` is not).
- Placement inference.
- solid-yield's type cross-check.
- Triage of the 15 Solid JS hangs.
- The architecture issue (slice 2 now shows two runtimes on one plan).
- Research into the server wire format and hydration.

## Housekeeping
- **Security:** an earlier config read on the Mac printed the `password` from `~/.config/ocpp/service-local.json`. The user should rotate it. Mask **all** values when reading config files.
- **OC++ (the Mac):** the MCP servers (tembo, linear, codemod, workspace) connect after a service restart, but a *resumed* session doesn't get their tools back; that's why this handoff exists. `executor` needs authentication, and `aws-mcp` fails with `-32602`.
- **Earlier subagent sessions, for reference only:** a new session can't continue them. Start fresh agents and point them at the docs listed above. Mac (OC++): astra slice 1 `ses_e4baa49f3ffePwEsafY7JAIBO0`, sol slice 1 `ses_e4baa892cffeZF5gwjFQiD0XI8`, sol dashboard `ses_e4b978801ffe5K1yVNghsHBljl`, astra architecture review `ses_e4c0f3c37ffe5kmUOzS2hEVWg3`. Sandbox: the slice-2 tracker workflow `wf_f9e75beb-08c`; push, plan fuzz, slices 3 and 5 and their integration `wf_68d50fef-8ea`.
