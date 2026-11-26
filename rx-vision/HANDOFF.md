# Handoff: ReactiveScript dev tooling (map, MCP, time travel, HMR, coverage) + language iteration
> Status notes for the `rx/integ` branch, written 2026-11-25. Screenshots, demos and tester apps were kept outside the repo and are not published.

Read this, then `ROADMAP.md`, then the contracts.

## 1. The goal

Iterate in vertical slices on ReactiveScript (RX, `.rx`, a language compiling to Solid 2.0) and its tooling:
build a slice → verify → have two tester agents each build a NEW, bigger RX app (one using the visual Map in the
Solid dev toolbar through a headless browser, one using the RX MCP server) → both write usability reports
→ turn the findings into fixes/new slices → repeat until agents build bigger apps more easily thanks to RX + tooling.

## 2. Design principles and process lessons

- **Agents write, humans review**: explicit code, checker-heavy, errors that say exactly what to rewrite.
- **One way to do a thing.**
- **No warning tier**: every diagnostic is an error; if something isn't severe enough to be an error, redesign so it
  can't happen (see decisions/no-warnings.md).
- Minimal Solid core changes; Solid-side needs go to Solid PRs/asks (solid-asks.md).
- UI work is done only when the repo's checks pass and a real browser pass agrees.
- Lessons:
  - Merging into and verifying in the same checkout concurrently made full runs flaky (Vite pushed files mid-test,
    page.mjs replaced mid-run). Verify in a separate checkout, one merge at a time.
  - Freeze builds for testers: in round 5 the compiler changed under a tester mid-round (8c merged). Link tester apps
    to a snapshot of the builds, not the live integration checkout.
  - Keep evidence and repros out of `/tmp`; a reboot wipes it.
  - Rust `compiler/target` dirs in old merged worktrees fill disks; delete only those, never source.

## 3. Repos and branches

- **reactivescript**: fork devagrawal09/reactivescript, upstream solidjs/reactivescript (upstream main was `e650b85`).
  Integration branch **`rx/integ`**: every feature branch merges here with `git merge --no-ff`. Head at handoff:
  `2dbcc44` (Merge branch 'fix/error-arms').
- Branches at handoff (most are merged into `rx/integ`):

| branch | commit |
| --- | --- |
| `fix/error-arms` | `4affbfa` |
| `eval-todo` | `70edf62` |
| `fix/js-imports` | `c926b96` |
| `rx/integ` | `2dbcc44` |
| `fix/lang-parse` | `2c54415` |
| `fix/lang-r2` | `55ce252` |
| `fix/lang-r4` | `c2dbfb3` |
| `fix/lang-r5` | `0d50bb5` |
| `fix/lang-r6` | `ec5bc80` |
| `fix/lang-r7` | `2702c11` |
| `fix/lang-r8` | `6c10fc2` |
| `fix/lang-r9` | `87b1a9f` |
| `lsp-eval-snippets` | `31443c8` |
| `rx-map` | `a08dbaa` |
| `map/calls` | `0b55975` |
| `map/cutover` | `958ddfe` |
| `map/layout` | `ebfb7ec` |
| `map/levels` | `cc2f074` |
| `map/nav` | `2d8a781` |
| `map/r5` | `2ba2727` |
| `map/rx` | `1648d0b` |
| `map/two-levels` | `23266d9` |
| `map/visual` | `c549f02` |
| `slice5b/mcp` | `1d75654` |
| `slice6/outline` | `e6fe578` |
| `pin-main` | `e093d61` |
| `pin-main-rust-engine` | `9311cde` |
| `pin-main-rust-render` | `9a7533e` |
| `guide/progress` | `6e34935` |
| `proto/rt-lite` | `a6a6af9` |
| `proto/rt-ownerfree` | `a6a6af9` |
| `proto/rt-switches` | `a6a6af9` |
| `proto/rt-sync` | `a6a6af9` |
| `proto/rt-tiers` | `0107f2d` |
| `slice1/identity` | `f9d5316` |
| `slice1/map` | `fe89dbd` |
| `slice10/reask` | `2a34be2` |
| `slice2/mcp` | `b3a430c` |
| `slice3/state` | `4e06443` |
| `slice3b/state` | `3c2a43c` |
| `slice4/travel` | `10552ef` |
| `slice4b/travel` | `bbbca75` |
| `slice4c/travel` | `9e308ff` |
| `slice4d/travel` | `2320098` |
| `slice4e/travel` | `8265b28` |
| `slice4f/travel` | `9203ae7` |
| `slice4g/travel` | `cfb9b38` |
| `slice4h/travel` | `1b07425` |
| `slice5/mcp` | `2a97c52` |
| `slice5c/mcp` | `2d4a624` |
| `slice5d/mcp` | `2753fea` |
| `slice5e/mcp` | `64fdd9b` |
| `slice7/hmr` | `f097881` |
| `slice7b/hmr` | `bb94891` |
| `slice7c/hmr` | `b057b68` |
| `slice7d/hmr` | `99ac2db` |
| `slice7e/hmr` | `c039156` |
| `slice8/dts` | `cbb4821` |
| `slice8b/helpers` | `effe27b` |
| `slice8c/helpers` | `cde7f65` |
| `slice8d/dev-decls` | `08bf4e5` |
| `slice9/coverage` | `5c847c6` |
| `slice9b/coverage` | `18d7a1c` |
| `fix/ssr-integ` | `7109386` |
| `proto/store-base` | `e650b85` |
| `proto/store-both` | `c5f23f4` |
| `proto/store-combined` | `1170004` |
| `proto/store-core` | `da44749` |
| `proto/store-features` | `a6a6af9` |
| `proto/store-plain` | `93e2dc8` |
| `proto/store-sitecache` | `1cc56ec` |
| `proto/store-slots` | `2303364` |
| `proto/store-writes` | `1b58fc0` |
| `trace/fake` | `aafedcc` |
| `upstream/lang-fixes` | `a2d1777` |
| `upstream/dev-keys` | `c700955` |
| `upstream/tooling` | `ddc27bd` |

- **Solid**: the RX pin is Solid `30e7805eb`. Fork branch `rx/view-on-30e7805` = pin + #5089 openView + three fixes
  (store-guess record, list reads through pin, guess over list across await). Tests that need time travel set
  `SOLID_VIEW` to a built checkout of it; `tooling/rx-map/solid-view.json` names the commit.
- **solid-start-devtools**: fork branch `feat/rx-map`.
- **rx-vision** (this folder): VISION.md + notes/, contracts, ROADMAP.md, decisions/*.md (language memos), reviews/,
  usability/ (ROUND1–5 briefs, round*-*.md reports, bin/rxmcp wrapper), solid-asks.md, solid-pr-*.md,
  upstream/PR-a/b/c.md.
- Tester apps: one per round per tester (`rx-r1…r5-{browser,mcp}`), kept locally, linked to the `rx/integ` builds
  of compiler, runtime, tooling/rx-map, tooling/rx-language-server/js and to solid-view.
- Tools: `RXC` = absolute path to `compiler/target/release/rxc`; Playwright and its Chromium from
  `npx playwright install chromium` (`PLAYWRIGHT_DIR` and `CHROME` override them in tooling/rx-map tests).

## 4. Verification (what "green" means)

In a reactivescript checkout (rebuild first if Rust/runtime changed: `cargo build --release` + `npm run build` in
compiler/ then `git checkout -- compiler/index.js` (napi rewrites version stamps); runtime `node build.mjs`; LSP WASM
`cargo build --lib --release --target wasm32-unknown-unknown --manifest-path compiler/Cargo.toml && node
tooling/rx-language-server/scripts/wasm.js` — the WASM is gitignored and goes stale silently):
- ref/: `npm test`, `npm run oracle`, `npm run compiled`, `npm run types`, `npm run ssr` and `RX_DEV=1 npm run ssr`
  (with Playwright installed).
- crate parity: `npm --prefix ref run crate`, `-- --project`, `-- --lower`, `-- --lower --dev` (30 known lowering
  mismatches = baseline; CI allows exactly those). OPEN: 3 extra S-progress-1/2 mismatches arrived with `6cc4b33`
  without a baseline update — fix or add 3 lines to `ref/lowering-baseline.txt`.
- `cargo test --release` (compiler/), compiler `npm test`, Vite e2e (compiler/test/vite.mjs), language server
  `npm test` (+ rx-tsc), tree-sitter corpus.
- tooling/rx-map: `SOLID_VIEW=… RXC=… npm test` (≈1300 ok + ~68 node tests; includes real-host time
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
ordered arms, progress guide). How rounds evolve next is still open.

## 7. Upstream status (pushed)

- solidjs/solid #5198 — store-guess flush record (open).
- Comment on solidjs/solid #5089 — list gaps under a view, with a working patch branch (fork:
  fix/view-list-reads-through-pin).
- solidjs/solid-start-devtools #57 (quiet devtools reads) and #58 (Structure Map mode).
- solidjs/reactivescript #98 (language fixes, ready), #99 (dev keys, draft), #100 (tooling, draft) — split from
  rx/integ BEFORE slices 8/9, arms, prelude-later work: they are STALE vs rx/integ. Refreshing them is an open decision
  (fresh split, or new PRs for the new work).
- solid-asks.md lists the Solid internals the bridge reads + asks (#10: views can't pin error/pending status;
  per-node recompute causes; "settled equal" for guesses).

## 8. Open questions

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
- Keep solid-asks.md current; post asks on #5089 once agreed.
