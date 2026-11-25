# Handoff: ReactiveScript dev tooling (map, MCP, time travel, HMR, coverage) + language iteration
> A copy of these docs lives in this branch under `rx-vision/`; the live working copy is `~/work/solidjs/rx-vision/` on the original machine (screenshots, demos and repro apps are only there).

Written 2026-11-25 by the orchestrating agent, for the next agent taking over. Read this, then `ROADMAP.md`, then the
contracts. Everything below is local to this machine unless marked "pushed".

## 1. The goal (user's standing objective)

Iterate in vertical slices on ReactiveScript (RX, `.rx`, a language compiling to Solid 2.0) and its tooling:
build a slice → verify → have two tester agents each build a NEW, bigger RX app (one using the visual Map in the
Solid dev toolbar through a headless browser like a human, one using the RX MCP server) → both write usability reports
→ turn the findings into fixes/new slices → repeat until agents build bigger apps more easily thanks to RX + tooling.
Orchestrate subagents (Sol = `openai/gpt-6.2-sol`, Opus = `claude-agent/opus` or orchestrator agents on it; Grok
`xai/grok-4.7` is OUT OF CREDITS — probed twice, don't use until the user tops up). Claude Fable (`claude-agent/fable`)
or OpenAI Astra may be used for big reviews/planning ONLY with the user's approval each time (the `anthropic/` provider's
OAuth token was invalid; `claude-agent/fable` worked). Ask the user only for critical/design decisions, TWO questions at
a time with the question tool, recommendation first; decide low-level things yourself.

## 2. The user (Dev) and working rules

- Short, casual answers; no recaps. Multi-part work fans out to subagents with complete context; one line per worker
  result. Commit locally; NEVER push or open PRs/comments without an explicit OK (this handoff's push was approved).
- UI work is done only when the repo's checks pass AND a browser pass on the machine the user sits at agrees. The user
  is on a **Mac**; this box is WSL2 Linux (Tailscale IP 100.104.104.7). Use the OpenCode in-app browser
  (`tools.browser.*`) for the Mac; the `browse` extension is paired to a Windows box — don't use it.
- Big-picture/design questions: the user wants to be asked (two at a time). Low-hanging decisions: just decide.
- RX design principles (user + Ryan Carniato, RX's author, repo solidjs/reactivescript):
  - **Agents write, humans review**: explicit code, checker-heavy, errors that say exactly what to rewrite.
  - **One way to do a thing.**
  - **No warning tier** (Ryan doesn't like warnings): every diagnostic is an error; if something isn't severe enough to
    be an error, redesign so it can't happen (see decisions/no-warnings.md).
  - Minimal Solid core changes; Solid-side needs go to Solid PRs/asks.
- Process lessons from this session:
  - Agents merging into and verifying in the SAME `rx-integ` checkout concurrently made full runs flaky (Vite pushed
    files mid-test, page.mjs replaced mid-run). Prefer verifying in a separate checkout / one merge at a time.
  - FREEZE builds for testers: in round 5 the compiler changed under a tester mid-round (8c merged). For round 6, link
    tester apps to a SNAPSHOT copy of the builds, not live `rx-integ`.
  - A reboot wipes `/tmp` (happened once): keep evidence/repros/shots under `rx-vision/` (repro/, shots/, demos/).
  - Disk is tight (/dev/sdd        251G  231G  7.4G  97% /); Rust `compiler/target` dirs in old merged worktrees are the usual culprit — delete only
    those (clean + merged into rx/integ), never source.

## 3. Repos, branches, paths

- **reactivescript** (main checkout `~/work/solidjs/reactivescript`; remote `origin` = fork devagrawal09/reactivescript,
  upstream = solidjs/reactivescript, upstream main was `e650b85`). Integration branch **`rx/integ`** in worktree
  `~/work/solidjs/rx-integ` — everything merges here (`git merge --no-ff --no-edit <branch>` as "Dev Agrawal").
  Head at handoff: 2dbcc44 Merge branch 'fix/error-arms' into rx/integ — **pushed to the fork as `rx/integ`** (backup; not a PR).
- Worktrees (/home/lucifer/work/solidjs/reactivescript            e650b85 [main]
/home/lucifer/work/solidjs/rx-error-arms             4affbfa [fix/error-arms]
/home/lucifer/work/solidjs/rx-eval-todo              70edf62 [eval-todo]
/home/lucifer/work/solidjs/rx-fix-imports            c926b96 [fix/js-imports]
/home/lucifer/work/solidjs/rx-integ                  2dbcc44 [rx/integ]
/home/lucifer/work/solidjs/rx-lang-parse             2c54415 [fix/lang-parse]
/home/lucifer/work/solidjs/rx-lang-r2                55ce252 [fix/lang-r2]
/home/lucifer/work/solidjs/rx-lang-r4                c2dbfb3 [fix/lang-r4]
/home/lucifer/work/solidjs/rx-lang-r5                0d50bb5 [fix/lang-r5]
/home/lucifer/work/solidjs/rx-lang-r6                ec5bc80 [fix/lang-r6]
/home/lucifer/work/solidjs/rx-lang-r7                2702c11 [fix/lang-r7]
/home/lucifer/work/solidjs/rx-lang-r8                6c10fc2 [fix/lang-r8]
/home/lucifer/work/solidjs/rx-lang-r9                87b1a9f [fix/lang-r9]
/home/lucifer/work/solidjs/rx-lsp-eval               31443c8 [lsp-eval-snippets]
/home/lucifer/work/solidjs/rx-map                    a08dbaa [rx-map]
/home/lucifer/work/solidjs/rx-map-calls              0b55975 [map/calls]
/home/lucifer/work/solidjs/rx-map-cutover            958ddfe [map/cutover]
/home/lucifer/work/solidjs/rx-map-layout             ebfb7ec [map/layout]
/home/lucifer/work/solidjs/rx-map-levels             cc2f074 [map/levels]
/home/lucifer/work/solidjs/rx-map-nav                2d8a781 [map/nav]
/home/lucifer/work/solidjs/rx-map-r5                 2ba2727 [map/r5]
/home/lucifer/work/solidjs/rx-map-rx                 1648d0b [map/rx]
/home/lucifer/work/solidjs/rx-map-two                23266d9 [map/two-levels]
/home/lucifer/work/solidjs/rx-map-visual             c549f02 [map/visual]
/home/lucifer/work/solidjs/rx-mcp-r4                 1d75654 [slice5b/mcp]
/home/lucifer/work/solidjs/rx-outline                e6fe578 [slice6/outline]
/home/lucifer/work/solidjs/rx-pin-main               e093d61 [pin-main]
/home/lucifer/work/solidjs/rx-pin-rust-engine        9311cde [pin-main-rust-engine]
/home/lucifer/work/solidjs/rx-pin-rust-render        9a7533e [pin-main-rust-render]
/home/lucifer/work/solidjs/rx-progress               6e34935 [guide/progress]
/home/lucifer/work/solidjs/rx-rt-proto-lite          a6a6af9 [proto/rt-lite]
/home/lucifer/work/solidjs/rx-rt-proto-ownerfree     a6a6af9 [proto/rt-ownerfree]
/home/lucifer/work/solidjs/rx-rt-proto-switches      a6a6af9 [proto/rt-switches]
/home/lucifer/work/solidjs/rx-rt-proto-sync          a6a6af9 [proto/rt-sync]
/home/lucifer/work/solidjs/rx-rt-proto-tiers         0107f2d [proto/rt-tiers]
/home/lucifer/work/solidjs/rx-slice1-identity        f9d5316 [slice1/identity]
/home/lucifer/work/solidjs/rx-slice1-map             fe89dbd [slice1/map]
/home/lucifer/work/solidjs/rx-slice10                2a34be2 [slice10/reask]
/home/lucifer/work/solidjs/rx-slice2-mcp             b3a430c [slice2/mcp]
/home/lucifer/work/solidjs/rx-slice3-state           4e06443 [slice3/state]
/home/lucifer/work/solidjs/rx-slice3b                3c2a43c [slice3b/state]
/home/lucifer/work/solidjs/rx-slice4-travel          10552ef [slice4/travel]
/home/lucifer/work/solidjs/rx-slice4b                bbbca75 [slice4b/travel]
/home/lucifer/work/solidjs/rx-slice4c                9e308ff [slice4c/travel]
/home/lucifer/work/solidjs/rx-slice4d                2320098 [slice4d/travel]
/home/lucifer/work/solidjs/rx-slice4e                8265b28 [slice4e/travel]
/home/lucifer/work/solidjs/rx-slice4f                9203ae7 [slice4f/travel]
/home/lucifer/work/solidjs/rx-slice4g                cfb9b38 [slice4g/travel]
/home/lucifer/work/solidjs/rx-slice4h                1b07425 [slice4h/travel]
/home/lucifer/work/solidjs/rx-slice5-mcp             2a97c52 [slice5/mcp]
/home/lucifer/work/solidjs/rx-slice5c                2d4a624 [slice5c/mcp]
/home/lucifer/work/solidjs/rx-slice5d                2753fea [slice5d/mcp]
/home/lucifer/work/solidjs/rx-slice5e                64fdd9b [slice5e/mcp]
/home/lucifer/work/solidjs/rx-slice7-hmr             f097881 [slice7/hmr]
/home/lucifer/work/solidjs/rx-slice7b                bb94891 [slice7b/hmr]
/home/lucifer/work/solidjs/rx-slice7c                b057b68 [slice7c/hmr]
/home/lucifer/work/solidjs/rx-slice7d                99ac2db [slice7d/hmr]
/home/lucifer/work/solidjs/rx-slice7e                c039156 [slice7e/hmr]
/home/lucifer/work/solidjs/rx-slice8-dts             cbb4821 [slice8/dts]
/home/lucifer/work/solidjs/rx-slice8b                effe27b [slice8b/helpers]
/home/lucifer/work/solidjs/rx-slice8c                cde7f65 [slice8c/helpers]
/home/lucifer/work/solidjs/rx-slice8d                08bf4e5 [slice8d/dev-decls]
/home/lucifer/work/solidjs/rx-slice9-cov             5c847c6 [slice9/coverage]
/home/lucifer/work/solidjs/rx-slice9b                18d7a1c [slice9b/coverage]
/home/lucifer/work/solidjs/rx-ssr-fix                7109386 [fix/ssr-integ]
/home/lucifer/work/solidjs/rx-store-proto-base       e650b85 [proto/store-base]
/home/lucifer/work/solidjs/rx-store-proto-both       c5f23f4 [proto/store-both]
/home/lucifer/work/solidjs/rx-store-proto-combined   1170004 [proto/store-combined]
/home/lucifer/work/solidjs/rx-store-proto-core       da44749 [proto/store-core]
/home/lucifer/work/solidjs/rx-store-proto-features   a6a6af9 [proto/store-features]
/home/lucifer/work/solidjs/rx-store-proto-plain      93e2dc8 [proto/store-plain]
/home/lucifer/work/solidjs/rx-store-proto-sitecache  1cc56ec [proto/store-sitecache]
/home/lucifer/work/solidjs/rx-store-proto-slots      2303364 [proto/store-slots]
/home/lucifer/work/solidjs/rx-store-proto-writes     1b58fc0 [proto/store-writes]
/home/lucifer/work/solidjs/rx-trace-fake             aafedcc [trace/fake]
/home/lucifer/work/solidjs/rx-up-a                   a2d1777 [upstream/lang-fixes]
/home/lucifer/work/solidjs/rx-up-b                   c700955 [upstream/dev-keys]
/home/lucifer/work/solidjs/rx-up-c                   ddc27bd [upstream/tooling] — most are merged feature branches; safe to remove once merged + clean).
- **Solid** (`~/work/solidjs/store-proto-base` = solid checkout at the RX pin `30e7805eb`; `~/work/solidjs/solid-next`
  is a symlink to it). `~/work/solidjs/solid-view`, branch `rx/view-on-30e7805` = pin + #5089 openView + our three
  fixes (store-guess record, list reads through pin, guess over list across await) — **pushed to the fork**; built
  (signals/solid/web with types). Tests needing time travel use `SOLID_VIEW=/home/lucifer/work/solidjs/solid-view`.
- **solid-start-devtools**: fork worktree `~/work/solidjs/ssd-rx-map` (branch feat/rx-map).
- **rx-vision** (`~/work/solidjs/rx-vision`, NOT a git repo): VISION.md + notes/, contracts, ROADMAP.md (all user
  decisions), decisions/*.md (language memos), reviews/fable-review-1.md, usability/ (ROUND1–5 briefs, round*-*.md
  reports, bin/rxmcp wrapper), repro/, shots/, demos/ (served on :4180), solid-asks.md, solid-pr-*.md, upstream/PR-a/b/c.md.
- Test/tester apps: `~/work/solidjs/rx-slice1-app` (the with-reactivescript template, linked to rx-integ builds),
  `rx-r1…r5-{browser,mcp}` (one per round per tester; local git repos; link `link:` deps to rx-integ compiler/runtime/
  tooling/rx-map/tooling/rx-language-server/js and solid-view).
- Tools: rxc `~/work/solidjs/rx-integ/compiler/target/release/rxc` (set `RXC=` absolute); Playwright via
  `NODE_PATH=/home/lucifer/.npm/_npx/e41f203b7505f1fb/node_modules`; headless shell
  `/home/lucifer/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`.
- Preview server: `cd ~/work/solidjs/rx-vision/demos && setsid nohup python3 -m http.server 4180 --bind 0.0.0.0 …`
  → http://100.104.104.7:4180/issues-fake.html etc. (dies on reboot; demos regenerate from rx/integ page.mjs).

## 4. Verification (what "green" means)

In a reactivescript checkout (rebuild first if Rust/runtime changed: `cargo build --release` + `npm run build` in
compiler/ then `git checkout -- compiler/index.js` (napi rewrites version stamps); runtime `node build.mjs`; LSP WASM
`cargo build --lib --release --target wasm32-unknown-unknown --manifest-path compiler/Cargo.toml && node
tooling/rx-language-server/scripts/wasm.js` — the WASM is gitignored and goes stale silently):
- ref/: `npm test`, `npm run oracle`, `npm run compiled`, `npm run types`, `npm run ssr` and `RX_DEV=1 npm run ssr`
  (NODE_PATH as above).
- crate parity: `npm --prefix ref run crate`, `-- --project`, `-- --lower`, `-- --lower --dev` (30 known lowering
  mismatches = baseline; CI allows exactly those). OPEN: 3 extra S-progress-1/2 mismatches arrived with `6cc4b33`
  without a baseline update — fix or add 3 lines to `ref/lowering-baseline.txt`.
- `cargo test --release` (compiler/), compiler `npm test`, Vite e2e (compiler/test/vite.mjs), language server
  `npm test` (+ rx-tsc), tree-sitter corpus.
- tooling/rx-map: `SOLID_VIEW=… NODE_PATH=… RXC=… npm test` (≈1300 ok + ~68 node tests; includes real-host time
  travel/HMR against a real app in a per-run temp dir). Production: compiled output of examples byte-identical for
  non-dev; Vite + esbuild prod bundles contain no `__RX_` dev globals / `rx:` names.

## 5. What exists now (slices, newest first; see `git log` 2dbcc44 Merge branch 'fix/error-arms' into rx/integ
7387944 Merge branch 'guide/progress' into rx/integ
27f0a8a Merge branch 'map/r5' into rx/integ
1b07425 Merge branch 'slice4h/travel' into rx/integ
f7b0e3a Merge branch 'slice8d/dev-decls' into rx/integ
a4d351c Merge branch 'slice4h/travel' into rx/integ
8970bc3 Mock the Vite watcher in the map MCP fixture
af8b9f3 Match dev effect carry keys in the reference emitter
5d6d993 Merge branch 'fix/lang-r9' into rx/integ
5f505c9 Merge branch 'slice10/reask' into rx/integ
229ce03 Merge branch 'slice7e/hmr' into rx/integ
990d3f8 Merge branch 'slice8d/dev-decls' into rx/integ
ecd87a7 Merge branch 'fix/lang-r9' into rx/integ
73f2268 Refresh the generated RX map bundle
873b098 Merge branch 'slice5e/mcp' into rx/integ
7e55763 Use plain imports in the shelf TypeScript fixtures
bd01296 Update remaining tooling fixtures for TypeScript import errors
3e3b871 Merge branch 'slice8c/helpers' into rx/integ
8ea1b5c Merge branch 'slice8b/helpers' into rx/integ
31a631e Merge branch 'fix/ssr-integ' into rx/integ
ba17f77 Merge branch 'slice9b/coverage' into rx/integ
4c1097e Merge branch 'slice9/coverage' into rx/integ
217ef74 Merge branch 'slice9/coverage' into rx/integ
cdb64a9 Merge branch 'slice9/coverage' into rx/integ
5cb8778 Merge branch 'slice8/dts' into rx/integ
0981693 Merge branch 'slice8/dts' into rx/integ
cfb9b38 Merge branch 'slice4g/travel' into rx/integ
5e0aa67 Merge branch 'map/calls' into rx/integ
50a0893 Merge branch 'fix/lang-r8' into rx/integ
c2ec3b4 Merge branch 'slice7d/hmr' into rx/integ
9b763cf Rebuild the map page with captured action inputs
a858f7c Merge branch 'fix/lang-r8' into rx/integ
9335eeb Merge branch 'slice7d/hmr' into rx/integ
b354424 Merge branch 'slice7c/hmr' into rx/integ
e29d9c3 Merge branch 'slice5d/mcp' into rx/integ
d164e98 Merge branch 'map/readable-cards' into rx/integ
3f31320 Merge branch 'map/flyto-now' into rx/integ
543325b Merge branch 'map/outline-wait' into rx/integ
a863e5c Merge branch 'map/cutover' into rx/integ
9a181ea Merge branch 'slice4f/travel' into rx/integ)

- **Ordered error arms** (`2dbcc44`): `catch (e) { Conflict => {…} _ => {…} }`, same arms in `errored fallback(e)`;
  exhaustiveness vs declared rejections; `LEGACY_TYPED_HANDLER` (nested typed handlers → error with rewrite),
  `ERROR_ARM_ORDER`, `UNREACHABLE_ERROR_ARM`, `MISSING_ERROR_ARMS`; DEAD_TYPED_BOUNDARY retired; no `instanceof`.
  Leftover: dead emit code for old typed handlers; uncovered class errors twice (MISSING_ERROR_ARMS + UNHANDLED…).
- **Progress guide** (`7387944`): status during an action = `guess` (auto-lifts) + `latest` + `pending?`; scenarios
  S-progress-1..4; replaced onFlush progress recipes; MCP `why`/map hint at it. Gaps: two uploads writing one list
  commit together; `for` over a guessed record's keys broken; `for f in latest files` rebuilds rows (perf); a
  write+refresh hold differs between oracle and interpreter/compiled runners.
- **Slice 9/9b coverage** (contract v0.5): behaviour paths (node, edge, loading, errored per class/arm, guess
  confirmed/reverted/superseded, action ok/caught per class); vitest collector, `rx-map coverage report|merge`,
  MCP `coverage`/`uncovered`, map overlay + HUD Coverage button (`/__rx/coverage`), failing test → trace page, scenario
  runner coverage (examples/: ~80%, error paths weakest); untyped failures listed separately (not %);
  `// rx-coverage-ignore: reason`. Open: view sites uncounted; edge credit and "settled equal" are inferred (Solid asks).
- **Slice 8/8b/8c/8d generated declarations** (contract v3): `.d.rx` generated from sibling `.ts`; RX facts via
  zero-cost helpers from `@reactivescript/js` (`pure`, `rejects([E…], fn)`, `rejects([], fn)` = never rejects,
  `ref`, `instantiates`, `server`, `client`; nested one way; ref/instantiates imply pure; `pure(ref())` is a TS
  error); unwrapped export = io, may reject any Error; hand `.d.rx` overrides per export; `import pure` on a local
  `.ts` = error IMPORT_ROW_ON_TS. `check` runs dev+prod compiles, flags stale builds.
- **Pure prelude**: spec/pure-globals.json (Math minus random, Number, String, pure Object statics, Array.isArray,
  Array.from, JSON). Action args snapshot at call time. Call spread supported; `throw Missing(id)` (no `new`).
- **Slice 7/7b–7e real keyed HMR**: Vite plans with `planHmr` (in the compiler package), carries sources by key,
  per-app carry state, reports uncarried with reasons, text-only/comment edits keep state, common structural edits
  carry; full reload only for runtime rebuild/config/HTML/real cycles/apply errors.
- **Slice 4 travel (4–4h)**: real time travel via Solid openView; read-only app while viewing; exact DOM incl. store
  guesses and wholesale list rewrites (needs solid-view's fixes); travel-pending bounded 3 s; per-instance values;
  errors as states. Gap: a view can't pin ERROR status (boundary doesn't re-trip) → step marked inexact (Solid ask #10).
- **Slice 5 MCP (5–5e)**: served warm by the dev server at `/__rx/mcp` (`rxMap()` Vite plugin), stdio `rx-map mcp`
  too; tools check/overview/find/node/reach/boundary/diff/live_status/state/tail/value/why/pending/record/trace/
  timeline/hmr/coverage/uncovered; opt-in acting `travel`/`resume` (RX_MCP_ACT=1); field paths; per-instance; last
  good build while broken. Wrapper: rx-vision/usability/bin/rxmcp (curl to /__rx/mcp when RX_DEV_URL set).
- **Slices 1–3**: dev keys `<module>|<scope>|<name>[#n]` as Solid names `rx:<key>` (dev only), live bridge
  (tooling/rx-map/live.mjs), current state on open (values/errors/held/boundaries/runs/reverts), trace contract
  (v0.10), fake host + `planHmr` + conformance suite (checks what the app SHOWS; broken hosts must fail).
- **The map** is now an RX program (tooling/rx-map/app/, built into page.mjs; vanilla map.html deleted): 2.5D world,
  glass HUD, two zero-shift detail levels (overview cards / detail, switch at 50%/45%; shared pure layout.mjs),
  view-text strips, Calls tab, coverage, travel timeline, reload plan, pop-out, sound off by default. Findings from
  writing it in RX: rx-vision/usability/map-in-rx.md.
- **Devtools**: Structure → Map mode; devtools' own reads kept out of Health.

## 6. Usability rounds (reports in rx-vision/usability/)

R1 Shelf (2–3 modules), R2 Tracker (8), R3 Crew (14), R4 Ledger (16/19), R5 Dispatch (24/25, no .d.rx). Build time
stayed ~20–45 min while apps grew ~8×; full spec completion since R3. Each round's findings drove the next fixes
(failures/held visible, warm MCP + record/why, exact travel, real HMR, Calls view, prelude, generated declarations,
ordered arms, progress guide). How rounds evolve next is "up to Ryan" per the user.

## 7. Upstream status (pushed, with user approval)

- solidjs/solid #5198 — store-guess flush record (open).
- Comment on solidjs/solid #5089 — list gaps under a view, with a working patch branch (fork:
  fix/view-list-reads-through-pin).
- solidjs/solid-start-devtools #57 (quiet devtools reads) and #58 (Structure Map mode).
- solidjs/reactivescript #98 (language fixes, ready), #99 (dev keys, draft), #100 (tooling, draft) — split from
  rx/integ BEFORE slices 8/9, arms, prelude-later work: they are STALE vs rx/integ. Refreshing them is a decision for
  the user (fresh split, or new PRs for the new work).
- solid-asks.md lists the Solid internals the bridge reads + asks (#10: views can't pin error/pending status;
  per-node recompute causes; "settled equal" for guesses).

## 8. Open questions waiting for the user

1. Revisit `!= null`: RX `==`/`!=` are strict, so `x.field != null` is true for missing fields; the RX map's own
   code had 7 latent bugs from it and a tester hit it. Options offered: one "absent" value (recommended), ban
   `== null` + `present(x)`, loose `== null` only, keep strict.
2. Round 6 shape: maintenance round (inherit round-5 apps, make changes, fix planted bugs; recommended), bigger
   greenfield, head-to-head vs plain TS + Solid 2, or agent's choice.
3. Whether/how to refresh RX PRs #98–#100 from current rx/integ.

## 9. Suggested next steps

- Get answers to §8; then round 6 with frozen tester builds.
- Fix/baseline the 3 S-progress lowering mismatches; delete dead legacy typed-handler emit code; dedupe the
  MISSING_ERROR_ARMS + UNHANDLED double error.
- Roadmap (ROADMAP.md): observed Calls view at the helper + dev claim verification (undeclared rejections, impurity,
  untracked ref) → record/replay at the boundary + test doubles/chaos → shape checks in dev + sensitivity
  declarations (required before any production recording) → production record/replay → Solid-wide map later.
- Keep solid-asks.md current; post asks on #5089 when the user agrees.
