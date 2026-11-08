# Handoff: ReactiveScript frontends and Solid-model work

Updated 2026-11-08. Read this first, then `dashboard/notes.json`. The work now runs in a Tembo sandbox at `/workspace/rx-tsx-refresh`, not on the Mac (see "Environment").

## Goal
Write Solid-style code in other syntaxes (Solid TSX, solid-yield's generator syntax), lower it onto ReactiveScript's (RX) existing AST, and accept a program only if it behaves exactly like native Solid; refuse everything else, with a diagnostic.
The broader direction: **"Solid" is a semantic model plus a conformance suite.** Syntaxes, host languages, runtimes (Solid JS, a Rust port), renderers and client/server placement are plugins around that core.

## How the user works
- **You plan and design; implementation goes to background subagents** (background workflows in the sandbox; on the Mac it was Codex: `sol`, `astra`, `luna`). Delegate everything, including verification reruns and push retries; never block on a foreground agent. Use **several cheap agents at once, with different but overlapping focuses.** Don't pass `model: 'sonnet'` to workflow agents here: it resolves to an unavailable model and fails silently. Omit the model and lower the effort instead.
- Ask decisions two at a time.
- Keep answers concise and code-heavy. Keep three things distinct: syntax we recognize, the verified subset, and full readiness.
- Prefer vertical slices (tracer bullets) to horizontal layers.
- Give every agent its own git worktree, directly under `rx-tsx-refresh/` so the relative `../reactivescript` and `../solid-next` paths resolve. Review, rerun the gate, then merge.
- **Never publish** (push, open PRs or issues, comment) without the user's explicit OK.
- **Never touch:** `/workspace/reactivescript` (the main clone; every `rx-tsx-refresh/` worktree hangs off it) and `/workspace/solid` (the user's fork, on `main`; don't pull it without asking). On the Mac the equivalents were `/Users/devagr/reactivescript` (an intentional uncommitted experiment: HEAD `f3c6771`, 13 changes), `/Users/devagr/solid-next`, `/Users/devagr/solid-yield` and `/Users/devagr/solid`.
- The shared checkouts `rx-tsx-refresh/{reactivescript,solid-next}` are read-only for agents.
- Verify agents' claims yourself before reporting them. Their results are sometimes truncated or incomplete.

## Environment (Tembo sandbox)
- Node 24 comes from nix: prefix node commands with `nix shell nixpkgs#nodejs_24 -c` (that gives 24.11.1, not the pinned 24.18.0). rustc is 1.96.0, not the pinned 1.97.1. solid-next is built with pnpm 11.1.1.
- **`git push` fails**: the sandbox's git credentials return HTTP 500. `tembo commit` pushes through the API and works; it pushed `147d971` to `rust-solid-slice1`. `tembo merge` still needs git credentials. Hourly push retries of the frontend merge all failed.
- The layout was rebuilt on 2026-11-07 as worktrees of the GitHub backup branches.
- `dashboard/collect.mjs` still reads the `/Users/devagr/...` paths, so in the sandbox only `notes.json` is current. Start it with `nohup node server.mjs > server.log 2>&1 &` (port 4173).

## Where things live (`/workspace/rx-tsx-refresh/`)
| Path | What |
|---|---|
| `frontend/` (`frontend-main` at `56feaff`) | The TSX and yield frontends, the differential fuzzer, the gate, with slice 1 merged (`slice1-like` + `slice1-plan`). `npm run verify:subset` gives **PASS 66/66**. **The merge is local and unpushed**: GitHub `tsx-frontend-workspace` is still `fe650c1` |
| `frontend-tracker/` (branch `tembo/slice2-tracker`, on `56feaff`, uncommitted) | Slice 2: the tracker in `.rx`/`.tsx`/yield, scenario format v2, plan schema v2 (`plan/docs/PLAN-V2.md`), the JS reference plan consumer. `RUST_SOLID=/workspace/rx-tsx-refresh/rust-tracker npm run verify:subset` gives **PASS 83/83** |
| `rust-tracker/` (branch `tembo/rust-tracker`, on `147d971`, uncommitted) | **The latest Rust runtime: tiers 2a, 2b, 2c, strings, the universal renderer, and the plan v2 consumer.** `cargo test`: 114 pass. `docs/SLICE1.md`, `docs/RENDERER.md`, `docs/PLAN-V2-CONSUMER.md` |
| `rust-parity/` (branch `rust-solid-slice1`, `147d971`) | Slice-1 scheduler port, plus tier 2a uncommitted. Superseded by `rust-tracker` |
| `rust-tierb/`, `rust-tierc/` | Tiers 2b and 2c as they were built, uncommitted. Superseded by `rust-tracker` |
| `rust-solid/` (branch `rust-slice1`, `012b5de`) | The pre-port slice-1 runtime, one commit behind GitHub. It is the default `RUST_SOLID` of the frontend gate, and its `scenario` binary is a v1 consumer only |
| `rust-solid-main/` (`4a1090c`) | M1 |
| `slice1-js/`, `slice1-plan/` | Slice 1's two branches, now merged into `frontend` |
| `reactivescript/`, `solid-next/` | Shared pinned checkouts: RX `fdbcad92`, Solid `2105ffb8` (rc.21) |
| `dashboard/` (branch `project-dashboard`) | The status dashboard. Edit `notes.json` by hand when the state changes; `node --test test.mjs` checks it |
| `docs/` (branch `project-docs`) | This handoff, and `scratch/` research notes and drafts: `slice1/*`, `compiler-architecture-review.md`, `interp-issue/` |

## Backups on GitHub (devagrawal09/reactivescript, one branch each)
| Branch | Contents |
|---|---|
| [`project-docs`](https://github.com/devagrawal09/reactivescript/tree/project-docs) | This handoff, plus `scratch/` notes (research, architecture review, slice 1 traces, issue and PR drafts). This update is local, not pushed |
| [`tsx-frontend-workspace`](https://github.com/devagrawal09/reactivescript/tree/tsx-frontend-workspace) | frontend `main` (`fe650c1`). The merge `56feaff` is not pushed |
| [`tsx-frontend-slice1-like`](https://github.com/devagrawal09/reactivescript/tree/tsx-frontend-slice1-like) | Slice 1 JS side (`158bea5`) |
| [`tsx-frontend-slice1-plan`](https://github.com/devagrawal09/reactivescript/tree/tsx-frontend-slice1-plan) | Slice 1 plan (`f315116`) |
| [`rust-solid-main`](https://github.com/devagrawal09/reactivescript/tree/rust-solid-main), [`rust-solid-slice1`](https://github.com/devagrawal09/reactivescript/tree/rust-solid-slice1) | The Rust Solid runtime (`4a1090c`; `147d971`, the slice-1 scheduler port). Tiers 2a–2c, the renderer and plan v2 are not pushed |
| [`project-dashboard`](https://github.com/devagrawal09/reactivescript/tree/project-dashboard) | The status dashboard. This `notes.json` update is local, not pushed |
| [`tsx-frontend-demo`](https://github.com/devagrawal09/reactivescript/tree/tsx-frontend-demo) | PR #21's current head (`cc1e6e9`) |
| [`pr21-v1-archive`](https://github.com/devagrawal09/reactivescript/tree/pr21-v1-archive), [`pr21-v2-archive`](https://github.com/devagrawal09/reactivescript/tree/pr21-v2-archive) | Earlier PR #21 versions (`2d74222`, `00f84fe`) |

These are unrelated histories living side by side in the fork; don't merge them into each other. When local work changes, push it to its branch again (once the user says so).
Not uploaded: `scratch/rune` (a clone of a third-party repo), `scratch/original-suite-run` and `scratch/pr-v2-ignored-leftovers` (old run output).

## Published (ryansolid/reactivescript): no replies from Ryan yet
- **#21:** draft demo PR. Two frontends, the same counter in three syntaxes, the tracker, stale-write, the fuzzer. 58 files, on clean `main`.
- **#20:** should ordinary async callbacks get an explicit form? The frontend refuses them meanwhile.
- **#33:** the interpreter and compiler disagree on writes around pending actions. Found by our fuzzer, 46 of 500 seeds.
- **#1:** Ryan's architecture issue: lowering should consume checker facts; no stable IR.

## Current state: slice 2's tracker gate passes
- **Pushed 2026-11-08 with `tembo commit`, one ordinary commit each:** `rust-tracker` as `4276aba` on `rust-solid-slice1` (on top of `147d971`), and the frontend (slice-1 merge `56feaff` plus the tracker work) as `7791984` on `tsx-frontend-workspace` (on top of `fe650c1`). This handoff and the dashboard `notes.json` were pushed to `project-docs` and `project-dashboard` right after.
- **Slice 1, Rust parity done:** `147d971` is a structural port of Solid's scheduler for slice 1. Exact-trace fuzz against Solid JS: **1000/1000** (it was 7/1000). Pushed to `rust-solid-slice1` with `tembo commit`.
- **Rust tiers, uncommitted, all in `rust-tracker`:**
  - 2a, async memos (`--slice2a`): **991/1000**: 8 invalid, plus seed 629 failing closed.
  - 2b, stores and per-row optimistic writes (`--slice2b`): **1000/1000**.
  - 2c, lists (mapArray/For), Show and parked frames (`--slice2c`): **999/1000**: seed 493 invalid. Every valid program agrees.
  - Strings (`--strings`): 1000/1000.
  - The universal renderer, a line-for-line port of Solid 2's `@solidjs/universal` (never dom-expressions): render fuzz **993/1000**, and every valid program agrees (the 7 invalid ones throw in Solid itself).
  - Plan v2 consumer and scenario v2 runner.
- **Slice 2 gate passes:** the 13-frame tracker scenario gives identical frames on native Solid, on compiled TSX, RX and yield, and on Rust running the plan emitted from each of the three syntaxes. The three plans are byte-identical. Rust's full host log equals Solid's, 453/453 entries. Frontend gate **PASS 83/83**.
- **Not verified:** plans aren't fuzzed, so only the tracker and like plans are checked. The scenario doesn't cover a filter toggle while a claim is pending, two claims on one row, a store change under a live guess, or non-overlapping transactions.
- **Suspected Solid rc.21 bugs, none filed** (each has a standalone repro in `rust-tracker/docs/`):
  - `take(n, l, true)` (lanes.ts:174-181) clears a slot's transaction but leaves CONFIG_HELD set, so the next `txOf` throws (`slice2b-fuzz/port/solid-bug-take-held.mjs`).
  - A store array's `has` and `get` disagree, so `mapArray` gets a hole (an `undefined` row); on optimistic and plain stores (`slice2c-fuzz/solid-bug-optimistic-hole*.mjs`, `slice2c-fuzz/port/solid-bug-plain-store-hole.mjs`).
  - Universal's `reconcileArrays` removes a node without an `isLive` check: the map-fallback removal at universal.ts:313, when one node is shared by two regions (`render-fuzz/port/solid-bug-shared-node.mjs`).
  - Slice 2a: Solid emits non-scalar values (`undefined` or an error object) in 8 async programs of 1–1000; and seed 629, a held error read back as a plain value.

## Design discussion: eval
The user proposed `createEval(() => "...rx code...", { ...bindings })`, or `eval` as an `.rx` language feature. Where it landed:
- **One more reactive source**, not running a string: the code string is a source, checking it is async (Loading/pending), and a checker rejection is an ordinary typed error for an error boundary. Changing the string rebuilds the subtree, like a keyed boundary.
- **Explicit bindings only**, like indirect eval: the code never sees the surrounding scope, it is read-only unless writes or actions are passed in, and host functions are passed explicitly. The bindings' types are the checker's whole environment.
- **The plan is the evaluation IR**: parse → check → plan → run on whichever runtime hosts it (Solid JS or Rust). Not the interpreter (#33). Eval is a strong reason to close the plan's AST fallbacks.
- **RX is the default syntax**, `eval` a language feature there. TSX is optional, through `createEval`. Yield later, if anyone needs it.
- **All three use cases, one primitive with options:** AI-generated UI (strict checking, capability-only bindings, may run on the server), a live playground or REPL (`preserve` state across edits), and plugins (a versioned, typed bindings interface).
- Nothing is built. This is the parked "live evaluator" (slice 3).

## Open decisions (ask the user first)
- **Push the tiers?** `rust-tracker` as one commit on top of `147d971` to `rust-solid-slice1`, through `tembo commit`.
- **The frontend merge:** push `56feaff` plus the tracker work as one ordinary commit through `tembo commit`, or the user pushes it.
- **Draft the Solid issue** for the four suspected bugs, locally first.
- **Next slice:** native window (slice 4, Blitz or Masonry), Rust SSR hydrated by Solid JS (slice 5), or fuzz plans first to harden slice 2.

Planned slices after that: 3, a JS live evaluator (see eval above); 4, a native window; 5, Rust SSR hydrated by Solid JS; 6, inferred server components over Solid's Frames.

## Parked (don't start without the user)
- Generative UI and the live evaluator (the eval design above is discussion only).
- Placement inference.
- solid-yield's type cross-check.
- Triage of the 15 Solid JS hangs.
- The architecture issue (slice 2 now shows two runtimes on one plan).
- Research into the server wire format and hydration.

## Housekeeping
- **Security:** an earlier config read on the Mac printed the `password` from `~/.config/ocpp/service-local.json`. The user should rotate it. Mask **all** values when reading config files.
- **OC++ (the Mac):** the MCP servers (tembo, linear, codemod, workspace) connect after a service restart, but a *resumed* session doesn't get their tools back; that's why this handoff exists. `executor` needs authentication, and `aws-mcp` fails with `-32602`.
- **Earlier subagent sessions, for reference only:** a new session can't continue them. Start fresh agents and point them at the docs listed above. Mac (OC++): astra slice 1 `ses_e4baa49f3ffePwEsafY7JAIBO0`, sol slice 1 `ses_e4baa892cffeZF5gwjFQiD0XI8`, sol dashboard `ses_e4b978801ffe5K1yVNghsHBljl`, astra architecture review `ses_e4c0f3c37ffe5kmUOzS2hEVWg3`. Sandbox: the slice-2 tracker workflow `wf_f9e75beb-08c`.
