# Handoff: ReactiveScript frontends and Solid-model work

Updated 2026-11-07. Read this first, then `dashboard/notes.json`. The live status page is at http://127.0.0.1:4173.

## Goal
Write Solid-style code in other syntaxes (Solid TSX, solid-yield's generator syntax), lower it onto ReactiveScript's (RX) existing AST, and accept a program only if it behaves exactly like native Solid; refuse everything else, with a diagnostic.
The broader direction: **"Solid" is a semantic model plus a conformance suite.** Syntaxes, host languages, runtimes (Solid JS, a Rust port), renderers and client/server placement are plugins around that core.

## How the user works
- **You plan and design; implementation goes to Codex subagents:** `driver: "codex"`, model `sol` for most work, `astra` for complex or semantic work, and `luna` for cheap parallel chores. Use **several luna agents at once, with different but overlapping focuses.**
- Ask decisions with `tools.question`, two at a time.
- Keep answers concise and code-heavy. Keep three things distinct: syntax we recognize, the verified subset, and full readiness.
- Prefer vertical slices (tracer bullets) to horizontal layers.
- Give every agent its own git worktree, directly under `rx-tsx-refresh/` so the relative `../reactivescript` and `../solid-next` paths resolve. Review, rerun the gate, then merge.
- **Never publish** (push, open PRs or issues, comment) without the user's explicit OK.
- **Never touch:** `/Users/devagr/reactivescript` (an intentional uncommitted experiment: HEAD `f3c6771`, 13 changes), `/Users/devagr/solid-next`, `/Users/devagr/solid-yield`. `/Users/devagr/solid` is the user's fork, on `next`, with untracked directories; don't pull it without asking.
- The shared checkouts `rx-tsx-refresh/{reactivescript,solid-next}` are read-only for agents.
- Verify agents' claims yourself before reporting them. Their results are sometimes truncated or incomplete.

## Where things live (`/Users/devagr/rx-tsx-refresh/`)
| Path | What |
|---|---|
| `frontend/` (`main` at `fe650c1`) | The TSX and yield frontends, the differential fuzzer, the gate. `npm run verify:subset` gives **PASS 53/53**. Backed up on GitHub as `devagrawal09/reactivescript`, branch `tsx-frontend-workspace` |
| `slice1-js/` (branch `slice1-like`) | Slice 1, JS side: fixtures, `slices/like/like.scenario.json`, `docs/SCENARIO-FORMAT.md`, runner. **62/62.** Not merged into `main`; backed up |
| `slice1-plan/` (branch `slice1-plan`) | Slice 1, plan: `plan/`, and `plan/docs/PLAN.md` with the list of CP-6 fallbacks. Not merged; backed up |
| `rust-solid/` (branch `slice1`) | The Rust Solid runtime. `docs/SLICE1.md`, `docs/STATUS.md`, `docs/slice1-fuzz/`. Backed up as `rust-solid-*` |
| `reactivescript-pr/` | The clone that PR #21 is pushed from (`tsx-frontend-demo-v3` at `cc1e6e9`, remote `fork`) |
| `reactivescript/`, `solid-next/` | Shared pinned checkouts: RX `fdbcad92`, Solid `2105ffb8` (rc.21) |
| `dashboard/` | The status dashboard. Restart it with `nohup node server.mjs > server.log 2>&1 &`. Edit `notes.json` by hand when the state changes |
| `scratch/` | Research notes and drafts: `slice1/*`, `compiler-architecture-review.md`, `interp-issue/` |

## Backups on GitHub (devagrawal09/reactivescript, one branch each)
| Branch | Contents |
|---|---|
| [`project-docs`](https://github.com/devagrawal09/reactivescript/tree/project-docs) | This handoff, plus `scratch/` notes (research, architecture review, slice 1 traces, issue and PR drafts) |
| [`tsx-frontend-workspace`](https://github.com/devagrawal09/reactivescript/tree/tsx-frontend-workspace) | frontend `main` (`fe650c1`) |
| [`tsx-frontend-slice1-like`](https://github.com/devagrawal09/reactivescript/tree/tsx-frontend-slice1-like) | Slice 1 JS side (`158bea5`) |
| [`tsx-frontend-slice1-plan`](https://github.com/devagrawal09/reactivescript/tree/tsx-frontend-slice1-plan) | Slice 1 plan (`f315116`) |
| [`rust-solid-main`](https://github.com/devagrawal09/reactivescript/tree/rust-solid-main), [`rust-solid-slice1`](https://github.com/devagrawal09/reactivescript/tree/rust-solid-slice1) | The Rust Solid runtime (`4a1090c`, `012b5de`) |
| [`project-dashboard`](https://github.com/devagrawal09/reactivescript/tree/project-dashboard) | The status dashboard |
| [`tsx-frontend-demo`](https://github.com/devagrawal09/reactivescript/tree/tsx-frontend-demo) | PR #21's current head (`cc1e6e9`) |
| [`pr21-v1-archive`](https://github.com/devagrawal09/reactivescript/tree/pr21-v1-archive), [`pr21-v2-archive`](https://github.com/devagrawal09/reactivescript/tree/pr21-v2-archive) | Earlier PR #21 versions (`2d74222`, `00f84fe`) |

These are unrelated histories living side by side in the fork; don't merge them into each other. When local work changes, push it to its branch again.
Not uploaded: `scratch/rune` (a clone of a third-party repo), `scratch/original-suite-run` and `scratch/pr-v2-ignored-leftovers` (old run output).

## Published (ryansolid/reactivescript): no replies from Ryan yet
- **#21:** draft demo PR. Two frontends, the same counter in three syntaxes, the tracker, stale-write, the fuzzer. 58 files, on clean `main`.
- **#20:** should ordinary async callbacks get an explicit form? The frontend refuses them meanwhile.
- **#33:** the interpreter and compiler disagree on writes around pending actions. Found by our fuzzer, 46 of 500 seeds.
- **#1:** Ryan's architecture issue: lowering should consume checker facts; no stable IR.

## Current state: slice 1 is done
- **Gate passed:** the plans from `.rx`, `.tsx` and yield are byte-identical. Rust frames `0 → 1 → 0 → 1 → 1` equal native Solid's.
- **But the subset fuzz of Rust vs. Solid JS agrees on only 7/1000 seeds (0.7%).** First differences: computation reads (105) and effect cleanup (888). The Rust port lacks Solid's speculative compute passes and held callback queues.
- **CP-6 gaps:** the plan needed 8 fallbacks to the AST (`PLAN.md`): expressions, control flow and await points, locals, the optimistic-source kind, action linkage, markup, entry selection, and text coercion.

## Pending decision (ask the user first)
Before slice 2 (the tracker: lists, stores, per-row optimistic writes): should astra raise Rust parity on slice 1's feature set, through a full structural port of Solid's scheduler, toward ~100% fuzz agreement? The recommendation is yes.
Also open: whether to merge `slice1-like` and `slice1-plan` into `frontend` `main`.

Planned slices after that: 3, a JS live evaluator; 4, a native window (Blitz or Masonry); 5, Rust SSR hydrated by Solid JS; 6, inferred server components over Solid's Frames.

## Parked (don't start without the user)
- Generative UI and the live evaluator.
- Placement inference.
- solid-yield's type cross-check.
- Triage of the 15 Solid JS hangs.
- The architecture issue (hold it until slice 1 or 2 shows two runtimes).
- Research into the server wire format and hydration.

## Housekeeping
- **Security:** an earlier config read printed the `password` from `~/.config/ocpp/service-local.json`. The user should rotate it. Mask **all** values when reading config files.
- **OC++:** the MCP servers (tembo, linear, codemod, workspace) connect after a service restart, but a *resumed* session doesn't get their tools back; that's why this handoff exists. `executor` needs authentication, and `aws-mcp` fails with `-32602`.
- **Earlier subagent sessions, for reference only:** a new session probably can't continue or read them, because only a session's own children can be continued. Start fresh agents and point them at the docs listed above. astra slice 1 `ses_e4baa49f3ffePwEsafY7JAIBO0`, sol slice 1 `ses_e4baa892cffeZF5gwjFQiD0XI8`, sol dashboard `ses_e4b978801ffe5K1yVNghsHBljl`, astra architecture review `ses_e4c0f3c37ffe5kmUOzS2hEVWg3`.
