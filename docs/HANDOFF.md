# Handoff: the Solid model (ReactiveScript frontends, rust-solid, Frames)

Updated 2026-11-11. Everything below is on branch `solid-model` of `devagrawal09/reactivescript`, including slice 6
(Frames), which was pushed with this file. A fresh session should read this file, then `dashboard/notes.json`, then
work through "Start here" at the bottom. The work runs in a Tembo sandbox. The working copy is
`/workspace/rx-tsx-refresh/solid-model`, not a checkout on the Mac.

## Goal and thesis
- **The thesis: "Solid" is a semantic model plus a conformance suite.** Syntaxes (Solid TSX, RX, solid-yield's
  generators), host languages, runtimes (Solid JS, the Rust port), renderers (universal, server, Frames) and
  client/server placement are plugins around that core. A plugin is accepted only where it is identical to native
  Solid 2.
- **In practice:** Solid-style code is written in another syntax and lowered onto ReactiveScript's (RX) AST and checker.
  A program is accepted only if it behaves exactly like native Solid 2 (rc.21); everything else is refused with a
  diagnostic. Plans (JSON IR, `frontend/plan/docs/PLAN-V2.md`) carry a program to any runtime. Differential fuzzers
  compare every leg with native Solid trace for trace, byte for byte.
- **Three levels, always kept apart:** *syntax we recognize* (what the frontends parse and lower), *the verified subset*
  (what a gate or fuzz compares with native Solid), and *full readiness*, which is never claimed.

## How the user works
- **You plan and design. ALL work goes to background subagents** (background Workflow): implementation, gate reruns,
  verification, pushes and retries. Never block on a foreground agent. Use several cheap agents in parallel with
  different but overlapping focuses. Use an **independent verifier** for every result. **Check agents' claims yourself
  before reporting them**: their output is sometimes truncated or wrong.
- Don't pass `model: 'sonnet'` (or any model) to workflow agents here. It resolves to an unavailable model and fails
  silently, returning null. Omit `model` and lower `effort` instead, and check that a phase's agents returned results
  before later phases use them.
- Answers are **concise and code-heavy**. Ask **two decisions at a time**. Work in **vertical slices** (tracer bullets),
  not horizontal layers.
- **Never publish without an explicit OK**: no push, PR, issue or comment. An OK covers the action it names, nothing
  later.
- **Solid 2 only.** No dom-expressions, solid-start, solid-meta, solid-refresh or Solid 1. Renderers are ports of Solid
  2's `@solidjs/universal` and `@solidjs/web`.
- **Never pull, modify, force-push or reset the user's repos or forks**: `/workspace/reactivescript` (the main clone;
  every `rx-tsx-refresh/` worktree hangs off it), `/workspace/solid` (the user's fork, on `main`), and on the Mac
  `~/reactivescript` (an intentional uncommitted experiment), `~/solid-next`, `~/solid-yield`, `~/solid`. Never delete
  remote branches; the user deletes branches on GitHub. Never touch `main`, `tsx-frontend-demo`, `pr21-*` or
  `claude/project-thread-*`.
- The pinned checkouts (`rx-tsx-refresh/{reactivescript,solid-next}`) are **read-only**. Give each agent its own git
  worktree of `solid-model` under `rx-tsx-refresh/`, with `reactivescript` and `solid-next` symlinked at its root and
  `frontend/upstream` created by setup's link step. Review the result, rerun the gates (through a background verifier),
  then merge.
- Mask **all** values when reading config files. A Mac-era read printed a password from
  `~/.config/ocpp/service-local.json`, and the user should rotate it.

## Environment (Tembo sandbox)
```sh
cd /workspace/rx-tsx-refresh/solid-model           # branch solid-model; the only working copy
nix shell nixpkgs#nodejs_24 -c sh scripts/setup.sh # idempotent; --check changes nothing
nix shell nixpkgs#nodejs_24 -c <node/npm cmd>      # Node 24.11.1 (pin 24.18.0); rustc 1.96.0 (pin 1.97.1)
```
- `reactivescript -> /workspace/rx-tsx-refresh/reactivescript` (RX `fdbcad92`), `solid-next ->
  /workspace/rx-tsx-refresh/solid-next` (Solid `2105ffb8`, 2.0.0-rc.21, built with pnpm 11.1.1), and `frontend/upstream
  -> ../reactivescript` are gitignored symlinks. setup.sh creates the last one. Without it the frontend gate fails,
  because it carries the `#rx/*` imports, the upstream type check, `verify-pinned.sh` and `tsx/boundary.test.ts`.
- **Plain `git push` is broken**: the credential refresh returns HTTP 500. **Use `tembo commit` only.** It runs `git
  commit -m` of the **index**, POSTs the tree to `internal.tembo.io/sandbox/commit` (which makes a verified commit), and
  then runs `git fetch` and **`git reset --hard origin/<branch>`**. That reset discards every uncommitted change to
  tracked files, so always stage from a saved `git write-tree`. Its limits:
  - it only works on branches that already exist on GitHub, so the user creates any new branch first;
  - it rejects any file with mode **100755** or **120000** (scripts are committed as 100644 and run with `sh`, and
    symlinks come from setup.sh);
  - keep each commit to **about 1 MB of blobs or less**;
  - on an API error it falls back to `git push`, which then also fails.
  `tembo merge` needs git credentials and doesn't work.
  ```sh
  git add -A && git diff --cached --summary | grep -E '100755|120000' && exit 1
  T=$(git write-tree); B=$(git commit-tree $T -p HEAD -m backup)   # keep $T and $B
  # per chunk: index = HEAD + this area's paths from $T, then commit
  git checkout $T -- . && git read-tree HEAD
  git ls-tree -r $T -- frontend | git update-index --index-info
  # also stage this area's deletions: ls-tree only adds and updates, and the index still holds HEAD's removed files
  git diff -z --name-only --diff-filter=D HEAD $T -- frontend | xargs -0 -r git rm --cached -q --
  tembo commit -m "feat(solid-model): <tier> — frontend (1/N)"
  git ls-remote origin solid-model; git fetch origin; git diff --stat HEAD $T -- frontend   # must be empty
  # ...repeat for each area; at the end:
  test "$(git rev-parse origin/solid-model^{tree})" = "$T"
  ```
- **Disk:** the disk filled up once, and a fuzz run hit `ENOSPC` and had to be rerun. The root filesystem (49 GB) runs
  88-91% full: 4-5.5 GB free (5.4 GB on 2026-11-11 after clearing `/tmp/sm*`). `rust-solid/target` is about 2.6 GB.
  **When less than 5 GB is free**, clean `target/` dirs in old worktrees and stale `/tmp` run directories, but leave
  `/tmp/async-tier-backup.tar`, `/tmp/sm-slice6-backup.tar` and other sessions' files alone unless you know what they
  are.
- Dashboard: `cd dashboard && nohup node server.mjs > server.log 2>&1 &` (port 4173). `collect.mjs` reads paths relative
  to the repository (set `DASHBOARD_GATE_BRANCH` to override the gate branch). Edit `notes.json` by hand.

## Layout
| Path | What |
|---|---|
| `frontend/` | TSX and yield frontends onto RX; plan v1/v2/v2.1/v2.2 emitter (`plan/`); TSX fuzz; plan fuzz (`plan/fuzz/`); slice 3 evaluator (`eval/`, `docs/EVAL.md`); slice 5 SSR and streamed-hydration oracle (`ssr/`); slice 6 Frames harness and placement fuzz (`frames/`, `plan/placement.ts`, `plan/split.ts`); slices (`slices/{like,tracker,tracker-async,eval,eval-async,tracker-frames}/`); gate `scripts/verify-pinned.sh`; results `docs/RESULTS.md` |
| `rust-solid/` | Rust port of Solid 2: scheduler (`slice1/`), tiers 2a–2c, boundaries/`affects` (tier D), universal renderer, plan v1/v2/v2.1 consumer (`scenario`, `plan-trace`), server renderer (`src/ssr/`, `ssr` bin), frames server (`src/frames/`, `frames-server` bin); differential fuzz `fuzz/run.mjs`; docs and recorded summaries `docs/` |
| `docs/` | this file; `HISTORY.md` (the 7 consolidated branches' SHAs, logs and ancestry); `SLICE6-FRAMES.md` (slice 6 design); `scratch/solid-rc21-issues.md` + `scratch/solid-rc21-repros/` (the Solid issue draft) |
| `dashboard/` | local status dashboard; `notes.json` is the narrative state; `node --test test.mjs` |
| `scripts/setup.sh` | clones and builds the pins, links `frontend/upstream`, `npm ci`, `cargo build` |

## Gates (exact numbers; anything different is a failure, not a tolerance)
```sh
# frontend/  (about 10 min; Chromium from Playwright)
nix shell nixpkgs#nodejs_24 -c npm run verify:subset
#   Result: PASS, Tests 149, pass 149. Steps: pins; builds scenario/plan-trace/ssr/frames-server in RUST_SOLID
#   (default ../rust-solid); strict types 0 package + 12 baseline upstream diagnostics; TSX fuzz 0-199: 179 + 21 listed;
#   plan/eval/SSR fuzz 1-100: 85 agree + 15 refused each; plan/eval/SSR fuzz v2.1 1-100: 84 + 16 each;
#   placement fuzz 1-100: 50 agree, 42 client-only, 7 refused, 1 listed divergent (seed 19, issue 8), R = N 93/93.
#   report.ts checks each against baselines/.

# rust-solid/
cargo test                                   # 175 passed
cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && git diff --check
F=crates/runtime/tests/fixtures
cargo run -q --bin scenario -- $F/tracker.plan.json $F/tracker.scenario.json             # 13 tracker frames
cargo run -q --bin scenario -- $F/like.plan.json $F/like.scenario.json                   # ["0","1","0","1","1"]
cargo run -q --bin scenario -- $F/like.plan-v2.json $F/like.scenario.json                # ["0","1","0","1","1"]
cargo run -q --bin scenario -- $F/tracker-async.plan.json $F/tracker-async.scenario.json # 18 frames
node --conditions=browser fuzz/plan-diff.mjs $F/tracker.plan.json $F/tracker.scenario.json             # 453/453
node --conditions=browser fuzz/plan-diff.mjs $F/like.plan-v2.json $F/like.scenario.json                # 34/34
node --conditions=browser fuzz/plan-diff.mjs $F/tracker-async.plan.json $F/tracker-async.scenario.json # 399/399
# tracker-frames (16-step scenario, legs T/N/J/R): inside both gates
cargo test --test frames                                                       # 6 (10 fixtures, 59 exchanges)
(cd ../frontend && RUST_FRAMES=$PWD/../rust-solid/target/debug/frames-server \
  node --experimental-strip-types --conditions=browser --test slices/tracker-frames.test.ts)  # 10/10 (without RUST_FRAMES the R test skips)

node --test dashboard/test.mjs               # 3/3 (from the root)
```
Long fuzz runs: summaries in `rust-solid/docs/`. Each `summary.json` must be byte-identical, except the placement fuzz
(see "Caveats"). Run them through a background verifier.
```sh
# rust-solid/: node fuzz/run.mjs MODE --seeds 1000 --start 1 --out out/MODE
--slice1                 1000/1000          docs/slice1-fuzz/parity/      (1001-3000: 2000/2000)
--slice2a --no-reduce     991/1000 (8 inv)  docs/slice2a-fuzz/port/       (1984/2000)
--slice2b                1000/1000          docs/slice2b-fuzz/port/       (1999/2000; 3001-8000 4997/5000)
--slice2c --no-reduce     999/1000 (493)    docs/slice2c-fuzz/port/       (1998/2000; 3001-8000 4988/5000)
--render                  993/1000 (7 inv)  docs/render-fuzz/port/        (1979/2000)
--strings                1000/1000          docs/strings-fuzz/port/       (2000/2000)
--boundaries --no-reduce  985/1000 (15 hang, issue 5) docs/boundaries-fuzz/ (1979/2000)
# frontend/: RUST_SOLID=$PWD/../rust-solid npm run <x> -- --seeds 1000 --start 1   (summaries in rust-solid/docs/)
plan-fuzz                861 agree, 8 upstream (RX only), 131 refused, 0 divergent   (1001-3000: 1694/19/287)
eval-fuzz                869 agree, 131 refused, 0 divergent                         (1713/287)
ssr-fuzz --dev           869 agree, 0 HTML / 0 hydration failures, 131 refused       (1713/287)
plan-fuzz --async        878 agree (Rust incl.), 0 rust-unsupported, 122 refused     (1748/252)
eval-fuzz --async        878 agree, 122 refused                                      (1748/252)
ssr-fuzz --async --dev   878 agree, 0 stream/HTML/hydration diffs, 122 refused       (1747/252, seed 1916 invalid: issue 7)
frames-fuzz --rust ../rust-solid/target/debug/frames-server
                         454 agree, 406 client-only, 109 refused, 31 divergent, 0 invalid, R = N 889/891
                         (1001-3000: 913, 825, 210, 52, R = N 1788/1790)
```

## Status per slice (all of it is a verified subset; none of it is full readiness)
**Slice 1, like** (`frontend/slices/like/`, `rust-solid/docs/SLICE1.md`). A like button in TSX, RX and yield gives
identical plans and frames `0→1→0→1→1` on native Solid, compiled RX and Rust. The Rust scheduler is a structural port
of Solid's transition paths (`slice1/`, call map `SLICE1-PARITY.md`); exact-trace fuzz went from 7/1000 to 1000/1000.
*Not verified:* the like host log against native Solid (see "Caveats").

**Tiers 2a/2b/2c and the universal renderer** (`SLICE1.md`, `SLICE2*-COVERAGE.md`, `RENDERER.md`). 2a covers async
memos, pending and error status, `refresh`, `latest`/`isPending`. 2b covers stores, reconcile, optimistic and derived
stores. 2c covers `mapArray`/`For`, `Show`, owners and parked frames. Coverage-first: every Solid function the valid
programs reach has a cited Rust counterpart (`// Solid: file.ts:lines`). The renderer is a line-for-line port of
`@solidjs/universal`; every valid program agrees. *Invalid seeds are Solid's own bugs (issues 1–4).*

**Slice 2, tracker** (`frontend/slices/tracker/`, `plan/docs/PLAN-V2.md`, `rust-solid/docs/PLAN-V2-CONSUMER.md`). The
13-frame tracker (an optimistic claim with a server call, a filter, rows) gives identical frames on native Solid, on
compiled TSX/RX/yield, and on Rust running the plan from each syntax. The three plans are byte-identical, and the host
log is 453/453. *The scenario skips* a filter toggle during a pending claim, two claims on one row, a store change
under a live guess, and non-overlapping transactions. The plan fuzz covers those.

**Plan fuzz** (`frontend/plan/fuzz/`, `PLAN-V2.md` "Plan fuzz"). Generated plans run on native Solid (TSX twin),
compiled RX, `solid-plan.ts` and Rust `plan-trace`, comparing results and full host logs. 0 divergent on 1–3000. The 8
(19 held-out) `upstream` seeds differ only on compiled RX (#33-type, upstream's). Refusals are the `outside` family
(`*`, `-`, constant holes). The plan still has 8 AST fallbacks where CP-6 lacks facts (`PLAN-V2.md` "How the builder
uses CP-6").

**Slice 3, live evaluator** (`frontend/docs/EVAL.md`, `rust-solid/docs/EVAL-CONSUMER.md`). Built and verified.
```rx
{eval(code, { issues, claim, loadIssue })}              // RX: a language feature
```
```tsx
{createEval(() => code(), { issues, claim, loadIssue })} // TSX
```
Its design decisions:
1. The code string is one more reactive source. Checking it is async, and a refusal is a typed `EvalRefused` error for
   `Errored`.
2. Changing the string rebuilds the subtree, like a keyed `Show`.
3. Bindings are explicit only, like indirect eval: no ambient scope; read-only unless writes or actions are passed;
   hosts are passed explicitly. Binding types come from the checked enclosing component (`plan/types.ts`), not from TS
   types.
4. The plan is the evaluation IR, run on `solid-plan.ts` or Rust (the host's table of compiled plans). It never uses
   the interpreter (#33).
5. RX is the default syntax; TSX code works too.
6. One primitive with options serves AI-generated UI, a playground/REPL, and plugins.
7. Upstream is untouched.
The eval slice, the eval fuzz and the async eval fuzz agree on every leg. *Deferred:* `preserve`, `place`,
`syntax: "yield"` (yield has no action parameter types); eval refusals under `Errored` in Rust; component-position
sites; nested eval (recognized, not exercised); value evals and explicit interfaces in the fuzz; eval on the server
(Rust `ssr` refuses eval sites).

**Slice 5, SSR** (`rust-solid/docs/SSR.md`, `frontend/docs/RESULTS.md`). Rust renders a v2 plan to HTML byte-identical
to Solid's `renderToString` of the plan's *canonical TSX twin*. Solid's client hydrates it in Chromium (prod and dev)
and replays the scenario. **Async (v2.1):** Rust's `renderToString` and **`renderToStream`** equal Solid's chunk for
chunk and byte for byte (shell, `Loading` fallback, failure fragments, serialized data), with a port of **seroval
1.7.0** and a model of the JS microtask/immediate order (`ssr/{boundary,stream,seroval,js}.rs`). Each stream, fed chunk
by chunk, hydrates with Solid's client after the shell and after the last chunk. *Canonical-twin caveat:* a plan can't
tell `{n()}` from `{"" + n()}`, so idiomatic `tracker.tsx` gets `_hk=8000…` where Rust renders `_hk=7000…`. *Not
ported:* Rust hydration (the client is Solid's), root holes, `deferStream`, `<Reveal>`, `<Loading on>`, the document
`</head>` splices, attributes/spreads/refs, the server error hook, eval sites.

**v2.1 async tier** (`PLAN-V2.md` "v2.1", `rust-solid/docs/BOUNDARIES-COVERAGE.md`). It adds async sources, `Loading`,
`Errored` (retry by `refresh`; RX has no `reset`), `isPending`, `latest`, `refresh`, `affects`. The 18-frame
tracker-async (a failed load with retry, racing claims, a rejected claim, a "saving…" indicator that needs
`affects(issues)`, because a bare `refresh` doesn't make `isPending` true) is identical on native Solid, compiled
TSX/RX, `solid-plan.ts` and Rust; host log 399/399. Rust ports `Loading`/`Errored`, tracked verdicts and `affects`.
*TSX async is opt-in* (`async: true` or scenario 2.1). *The yield twin is refused*, each site pinned.

**Slice 6, Frames: inferred server components** (`docs/SLICE6-FRAMES.md`, `RESULTS.md` "Slice 6", `PLAN-V2.md`
"v2.2", `rust-solid/docs/FRAMES.md`). A program is written once, as an all-client app
(`slices/tracker-frames/tracker-frames.{rx,tsx}`). The v2.2 builder infers which component sites become Solid 2 server
components (`"use server"` functions returning components, mounted with `dynamicComponent`; client-required children
become islands, i.e. slot props) using rules PL-1..PL-9 and marks M1..M9 over RX checker facts (`plan/placement.ts`),
and records the result as plan annotations. `plan/split.ts` prints the canonical split. Rust's `frames-server` serves
it byte for byte as Solid's own server serves the hand-written split, and Solid's client hydrates and runs it.
- The legs: **T** is the all-client twin (it records the scenario); **N** is the hand or generator split on Solid's
  server; **J** is the plan's split on Solid's server; **R** is rust-solid plus J's client.
- **G1** placement: RX = TSX = the saved table = the extract of N.
- **G2** bytes: J = R = N on the t=0 document, frame streams, data, the sanitized 500, and the CSRF 403.
- **G3** client behaviour: frames, host log and DOM per step.
- **G4** zero client JS for server-only components.
- Plan v2/v2.1 emission is unchanged byte for byte.
*Not verified or not built:* the U legs (v2.2 with placement ignored, on `solid-plan.ts`/`plan-trace`); structured slot
arguments; `props.children`/JSX props (refused, `FRAMES_CHILDREN`); server roots under a client `For`; owned questions
in inline components; server `Loading` inside a frame (M8); `FRAMES_EVAL_PLACE`; single-flight mutations, `live()`,
GET server fns, no-JS forms. Owned roots are client stubs `<C>$frame`. The answer script is recorded at run time from
N's host log. Only three PL pins exist (PL-3c, PL-3d, PL-5). The design's open choices (the minimal-request rule and
request parity) were built as proposed but never put to the user.

## Suspected Solid rc.21 bugs (none filed; draft `docs/scratch/solid-rc21-issues.md`, repros `docs/scratch/solid-rc21-repros/`)
Run them all with `nix shell nixpkgs#nodejs_24 -c sh docs/scratch/solid-rc21-repros/run-all.sh`. Outputs go to `out/*.{prod,dev}.txt`, which are tracked. A rerun rewrites 6 of them with absolute
stack-trace paths (`1-take-held`, `3-universal-shared-node` and `3b-bulk-removal-arm`, prod and dev; the recorded ones
read `file:///workspace/rx-tsx-refresh/docs/scratch/…`), so unless the rerun is meant to be committed, restore them
with `git checkout -- docs/scratch/solid-rc21-repros/out`. None of the repros has been rerun on current `next` (`a01fd92`).
| # | Bug | Repro | Confidence |
|---|---|---|---|
| 1 | `take(n,l,true)` (lanes.ts:174-181) keeps CONFIG_HELD with a null tx, so the next `txOf` throws | `1-take-held.mjs` | high |
| 2 | Store array `has`/`get` disagree, so `mapArray` gets an `undefined` row (plain and optimistic) | `2a-plain-store-hole.mjs`, `2b-optimistic-has-get.mjs`, `2c-optimistic-lasting-hole.mjs` | high (2c may be separate) |
| 3 | universal `reconcileArrays` removes a node another region took, with no `isLive` check (universal.ts:313) | `3-universal-shared-node.mjs`, `3b-bulk-removal-arm.mjs`, `3-dom-comparison.mjs` | likely, low severity |
| 4a | A user effect runs with `undefined` after an error | `4a-effect-undefined.mjs` | high |
| 4b | A staged error is served as a value or as `prev` (seed 629) | `4b-error-object-as-value.mjs`, `4b-seed629.mjs`, `4d-error-object-as-prev.mjs` | high |
| 4c | `latest(memo)` is `undefined` for a held memo whose first answer was an error | `4c-latest-undefined.mjs` | medium-high |
| 5 | Endless flush: `Errored` content calling `isPending` + an `affects` action (scheduler.ts:1220). Prod hangs; dev throws "Potential Infinite Loop Detected" | `5-errored-pending-hang.mjs` | high |
| 6 | Streamed hydration of `Errored` over two `Loading`s ends differently depending on hydration time | none: `ssr-fuzz --async --seeds 1 --start 28 --dev` | suspected, untriaged |
| 7 | renderToString page hydrated ≠ client mount (`Show` around `Errored`>`Loading`>`Loading` after a reject) | none: same command, `--start 1916` | suspected, untriaged |
| 8 | Frames: a server component's arg switch waits for an action's refresh of another server component | `frontend/frames/repros/switch-held.ts` (fuzz seed 19) | medium |
| 9 | Frames: an island handler throws `NotReadyError` while its frame's refetch is staged | `frontend/frames/repros/island-not-ready.ts` (seed 204) | medium |
| 10 | Frames: a server component shown again by `Show` renders its old answer | `frontend/frames/repros/reshow-stale.ts` | medium |
| 11 | Frames: a refetched frame lands one frame after its transaction (C15) | none: `frames-fuzz -- --seeds 1 --start 367` | suspected |

Issues 8–11 are placement-observable: N and J diverge from T alike, R equals N, and nothing of ours is involved. Before
filing, rerun every repro on current `next`. Frames there has moved (`8138dabe` changes `frame-sink.ts`).

## Caveats
- **Placement-fuzz summaries are not byte-reproducible.** On some seeds Solid's own client is timing-dependent: the
  twin itself doesn't always replay (`unstable`: 932; held-out 1595, 1632, 2540), and R ≠ N on 675, 932, 1595 and 2077
  because N ends differently from run to run. A rerun can move a seed between `divergent`/`agree` or flip an R = N
  count. The gate's 1–100 is stable (3 runs alike). **Proposed fix:** replay each seed k times on T and N, classify the
  unstable ones as `unstable` in the runner (not only in `scripts/frames-classify.ts`), and leave them out of the
  byte-compared summary.
- **Like host log:** like's full log is not compared with native Solid. Its TSX handler is an inline
  `action(function* …)`, which the compiler sets with `setProp` in a render effect, while the plan has a static prop.
  Only its frames and the Rust-vs-oracle log (34/34) are checked. The tracker's log equals native once its integer hole
  is coerced to a string.
- **TSX async is opt-in** (`async: true` / scenario 2.1). The default subset still refuses `Loading`, `Errored`,
  `isPending`, `refresh` and `affects`.
- **Yield refusals:** no async tier (each async import and async `$memo` of `tracker-async.yield.tsx` is pinned as
  refused); also `$effect`, contexts, `Switch`, typed failures, `try`/`catch`, and the forms whose yield meaning differs
  from RX (bare setter, setup reads, reads after `attempt`). See `frontend/docs/YIELD.md`. `attempt`'s translation
  assumes the call never succeeds with `undefined`.
- `--slice2c` with reduction crashes on seed 493 (issue 2 throws uncaught), so its summaries use `--no-reduce`.
- The SSR canonical twin (slice 5, above).

## Deferred, per slice
- **1/2:** Rust components (child components, context, Switch, Portal, Dynamic), `spread`/`mergeProps`/`ref`; the 8
  plan AST fallbacks (they need CP-6 facts; #1 says to open narrow issues); performance (the plan is interpreted and
  nothing is measured).
- **2a–2c, D:** Solid's halt path (recorded as errors); `<Reveal>`, `Loading on`; the seed-980 `removalStagedBy` unit
  test.
- **3:** `preserve`, `place`, yield syntax, `Errored` for eval refusals in Rust, eval on the server.
- **5:** Rust hydration, document shell, root holes, `deferStream`, reveal groups, attributes, the server error hook.
- **v2.1:** yield async; TSX async by default.
- **6:** U legs, structured slot args, `props.children`, server roots under client `For`, server `Loading` in frames,
  single-flight/`live()`, `FRAMES_EVAL_PLACE`, the C15 pin, and repinning when Frames moves.
- **4 (native window, Blitz or Masonry):** not started.

## Open decisions (ask two at a time)
1. **Delete the 7 consolidated branches?** The user approved deleting them on 2026-11-09 and deletes them on GitHub
   himself. `git ls-remote origin` on 2026-11-11 shows **all 7 still exist**: `tsx-frontend-workspace` `7791984`,
   `tsx-frontend-slice1-like` `158bea5`, `tsx-frontend-slice1-plan` `f315116`, `rust-solid-main` `4a1090c`,
   `rust-solid-slice1` `4276aba`, `project-docs` `f920b7b`, `project-dashboard` `41639f9`. `docs/HISTORY.md` records
   them. Remind the user; never delete them yourself.
2. **Triage and file the Solid issues** (1–11). First rerun the repros on current `next`, then file per issue with the
   user's OK.
3. **Next slice:**
   - (a) slice 4, the native window;
   - (b) close the slice-6 gaps (U legs, structured slots, children, the placement-fuzz reproducibility fix);
   - (c) repin Solid to `next` HEAD. Frames is experimental and its wire format may change, so a repin regenerates
     every recorded byte. RX `main` has also moved: `08255de` (#49, 2026-11-10) vs the pin `fdbcad92`.
4. **Eval polish:** `preserve` (REPL state) and `place` (server placement; slice 6 now gives it a target), plus eval on
   the server.
5. Smaller choices:
   - accept the SSR canonical twin, or record a hole's spelling in the plan;
   - slice 6's minimal-request rule and request parity;
   - whether to keep the superseded checkouts under `rx-tsx-refresh/` (`frontend-tracker`, `rust-tracker`,
     `frontend-eval`, `rust-eval`, `frontend-ssr`, `rust-ssr`, `rust-parity`, `rust-tierb`, `rust-tierc`, …).

## Published state (2026-11-11)
**devagrawal09/reactivescript** (`git ls-remote origin`):
| Branch | SHA | What |
|---|---|---|
| `solid-model` | `18e7d6a` before this push; slice 6 + this handoff on top (`git log origin/solid-model`, subjects `feat(solid-model): slice 6 frames — … (i/N)`, `docs(solid-model): handoff`) | everything |
| `tsx-frontend-demo` | `cc1e6e9` | PR #21's head |
| `pr21-v1-archive`, `pr21-v2-archive` | `2d74222`, `00f84fe` | earlier PR #21 versions |
| `main` | `b787012` | untouched |
| the 7 consolidated branches | see Open decision 1 | to be deleted by the user |
| `claude/project-thread-*` (13) | — | not ours to touch |

**solidjs/reactivescript** (formerly ryansolid/reactivescript; the old name redirects). Pins: RX `fdbcad92`; upstream
`main` is now `08255de` (#49, 2026-11-10; `git ls-remote https://github.com/solidjs/reactivescript main` on
2026-11-11).
- **PR #21**: draft, open, head `devagrawal09:tsx-frontend-demo` `cc1e6e9`. Two frontends, the counter in three
  syntaxes, the tracker, stale-write, the fuzzer. Our last status comment is from 2026-11-06; no review yet.
- **#20** (explicit ordinary async callbacks?): **closed, not planned** by Ryan on 2026-11-09. A held write is Solid's
  own hold semantics (H-2), not something action inference adds. The frontend's refusal of async callbacks stands.
- **#33** (interpreter vs compiler on writes around pending actions): **closed, completed**, 2026-11-09.
- **#1** (semantic core): **closed, completed**, 2026-11-09. CP-6 is the resolved model (`ref/src/model.ts`,
  `compiler/src/model.rs`, `rxc model`). It is not a stable IR (CP-6e). Open narrow issues for missing facts.

## History (short)
- 2026-11-07: rebuilt in the sandbox from the GitHub backups; slice-1 Rust parity at 1000/1000.
- 2026-11-08: tiers 2a/2b/2c, the renderer and the slice-2 tracker gate; pushed; plan fuzz, slices 3 and 5.
- 2026-11-09: consolidated into `solid-model` (`docs/HISTORY.md`); async tier started.
- 2026-11-10: async tier pushed (`00f89bf..18e7d6a`).
- 2026-11-11: slice 6 built and verified, pushed with this handoff.
- Workflows: `wf_f9e75beb-08c` (slice 2), `wf_68d50fef-8ea` (slices 3 and 5), `wf_4c456a64-a8e` (consolidation),
  `wf_c16204d4-993` (async), `wf_49b2d52e-cbe` (slice 6), `wf_80a7a484-19d` (this push). A new session can't resume
  them; start fresh agents and point them at the docs.

## Start here
1. `cd /workspace/rx-tsx-refresh/solid-model && git fetch origin && git status`. The tree must be clean and
   `HEAD == origin/solid-model`. Read this file, then `dashboard/notes.json`.
2. `nix shell nixpkgs#nodejs_24 -c sh scripts/setup.sh --check` (run it without `--check` if anything is missing).
3. `df -h /`. If less than 5 GB is free, clean old `target/` dirs and stale `/tmp` runs (Environment, "Disk").
4. Start a **background** verifier for the gates above (frontend 149/149, cargo 175, fmt, clippy, scenarios,
   plan-diff 453/34/399). Read its report critically.
5. Ask the user the first two open decisions: deleting the 7 branches, and filing the Solid issues. Then the next
   slice.
6. Do new work in a fresh worktree of `solid-model` through background workflows. Publish nothing without an explicit
   OK.
