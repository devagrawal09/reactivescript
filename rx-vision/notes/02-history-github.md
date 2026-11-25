# 02 — History and GitHub: how ReactiveScript got here

Sources: `git log` on `main` (408 commits, 2026-10-21 → 2026-11-23), all PRs and issues on solidjs/reactivescript, and solidjs/solid issues that mention "reactivescript" (95 hits). Repo state: HEAD `e650b85`, Solid pinned to main `30e7805eb` (`ref/SOLID_NEXT`). Commit authors: Claude 293, Ryan Carniato 110, plus single commits from Brenley Dueck, Stefan Kopco and Chris Gaafary. Nearly all of the work came out of Claude Code "project threads" that Ryan requested, and PRs carry the attribution line.

The project is **five weeks old**, and a lot of ground was covered fast. There's a burst on 10-27 (68 commits: Rust port, editor, runtime, first eval) and another on 11-13 (38 commits: 0.3.0/0.3.1, MO-10, the Exact arm).

---

## 1. Timeline of eras

### Era 0: spec-first semantics and the oracle (10-21 → 10-25)
- **10-21, day one (`215cbf6` … `1d4442a`).** The spec is scaffolded chapter by chapter: core (E-*, C-*, P-*), 03 regions/ownership (O-1..5, RG-*), 04 rows (io/pending/lane, R-1..12), 05 holds (two-version store, H-1..12, "restating Solid F-1..F-12"), 06 stores/actions (ST-*, AC-1..6). Alongside it, `ref/` grows a TS **reference interpreter**, and Solid's own SCENARIOS.md cases (S-1..S-43) get ported. At the end of the day the **oracle** runs every scenario through `solid-js 2.0.0-rc.16`: 53 pass, 23 recorded divergences (DV-*). That's the founding move. The language is defined as Solid 2.0's semantics, with an executable spec checked frame by frame against real Solid.
- **10-22/23.** Surface syntax lands (07; `.rx`, `:=` vs `=`, `?:` as the only conditional), then 08 constraints (sound over-approximate static graph, `pure` as the only escape hatch), the checker (`ref/src/check.ts`), the first compiler (`ref/compile`, `.rx` → JS over solid-js 2.0), typed failures (`fails` row, "checked like Rust's Result"), modules (09), and declared contexts. The first **AI tests** follow: fresh agents write apps cold from the spec (cart.rx 11/11 frames, then feed/wizard, then three multi-module apps at 36/36).
- **10-24/25.** Scope jumps. SSR and full hydration go in (spec/10, streaming to Chromium), plus server functions (spec/12), scoped styles (TSRX's engine), 13 Types (projection to TSX checked by TypeScript, a fifth runner), portals, `until`, path-targeted optimistic writes, and a TextMate grammar. The README marks "Revisiting ReactiveScript" as pre-TSRX thinking. Every scenario in Solid's SCENARIOS.md is now ported (`6a9179e`).

### Era 1: rulings, upstream filing, Rust port, tooling (10-26 → 10-27)
- **10-26.** The first batch of DVs is filed against Solid (#4268–#4275, then #4283–#4287, #4305), and Ryan rules on every vetoable default (PR #2). Solid answers within the day: PRs #4 and #5 adopt Solid's answers. Some DVs get reversed toward Solid (DV-10 via #4284, DV-11 via #4272 "closed by design"), others are fixed upstream. PR #3 clears the Rust-port blockers: the `__rt` runtime API gets pinned (CP-4), every `await` is lowered, and `.d.rx` is read in place (MO-9).
- **10-25 issue #1 (devagrawal09): "Explore a semantic core".** It proposed a resolved semantic representation between syntax and analysis so other frontends (Solid TSX, solid-yield) could share the checker. PR #6 says it's "the Rust port as agreed in #1". The **resolved model (CP-6)** became the compile-time core between check and lower. PR #21 (open, "Demo, not for merge") shows Solid TSX and solid-yield frontends lowering onto the RX AST with identical checker facts.
- **10-27, the big day.** These all land:
  - PR #6, the **Rust crate** (`compiler/`, `rxc`): parse/check/model, lowering through Solid's `compile_program`/`compile_style` seams (solidjs/solid#4290, #4289, merged upstream for this), `@reactivescript/compiler` as a Node-API package loaded by `@solidjs/vite-plugin` (#471). It had 280/280 parity with ref.
  - PR #7, **editor support**: spans, the TSX projection with mappings (CP-8), `rxc serve`, a Volar-based language server running the crate as WASM (~1 ms per analysis), the VS Code extension, and release CI.
  - PR #8, going public (MIT, CONTRIBUTING).
  - PR #9, the repin to **rc.19 with zero recorded divergences** (`85c02c6`: "every recorded divergence is gone").
  - PR #10 `onSettled`/`onFlush`, and PR #11 `@reactivescript/runtime`.
  - PR #13, the first **.rx vs React eval** pilot (0/9 defects in each arm; ".rx shorter, costlier to learn") and `guide/async.md`.

### Era 2: AI eval rounds drive the language (10-27 → 11-08)
- Rounds 2–8 (PRs #14, #18) and the eval pushed new checks into the language: inferred actions with `HELD_WRITE`/`STALE_OWN_READ` (#17, AC-1b..d), `STALE_WRITE_BACK` (AC-1e, which hit 3/76 apps, all real bugs), `MISSING_AWAIT` (#19), and `UNGUARDED_SNAPSHOT` (R-8, which fired on exactly the 36 apps where the round-8 timing fuzzer found page errors).
- **Round 8 (async timing fuzzer) went against the prereg.** Holes showed up in 60/60 .rx apps against 18/42 React. They were traced to handler reads (fixed by R-8) and to Solid optimistic-store bugs (#4437, #4440, #4441). From this round on, the eval doubles as a **Solid bug finder**.
- New checks and arms: CN-3d/3e loading checks (#22), store-effect semantics (#23), O-4 "writes only through the owner's name" with source contexts withdrawn (#26), round 10 by model tier (#27), FOREIGN_FAILURE added and withdrawn the next day (#27/#28), and Foldkit plus vanilla arms.
- Repin to **rc.21** (#30). PR #31/#32 aligned the spec with **solidjs/solid#4695** (Ryan's "executable rulings, derived rules collapsed" docs PR on Solid). Rule IDs were folded, posture became per-read (R-11 rewritten), and DV-21..23 were recorded as "Solid has ruled, not built".

### Era 3: move to solidjs org and public releases (11-09 → 11-13)
- **11-09 PR #36:** repointed to **solidjs/reactivescript**. PR #38 fixed issue #33 (devagrawal09 found interpreter/compiler disagreements; the interpreter was wrong).
- **0.1.0 (11-09, PR #39).** Compiler, runtime, language server and extension (`solidjs.reactivescript`) went to npm, the VS Marketplace and Open VSX by trusted publishing, plus a WASM compiler build. The 11-10 follow-ups: `rx-tsc` (#41), diagnostics pages per code (#42), ```` ```rx```` Markdown highlighting (#45), the reactivescript.dev site (#46), `optimistic` → **`guess`** (#47), guesses over equations (#48), destructuring (#49), and round 11 (#35: small models .rx 3.8 defects/app vs React 9.7, p=.047).
- **0.2.0 (11-12, PR #55):** relative JS imports, markup `else if`, rx-tsc on npm. Also `GUESS_WHILE_LOADING` (#53, the compile-time version of Solid's `OPTIMISTIC_WRITE_WHILE_LOADING` from solidjs/solid#4795) and an XState arm.
- **0.3.0 (11-13, PR #57/#60):** **MO-10, use any Solid library through a `.d.rx`**, with `ref` params/results as accessors. R-8 got stricter. **0.3.1 (PR #62):** spread attributes. The first external bug reports were #50–#52 (revosw), fixed in #63.
- Rounds 13/14 added an **Exact (contract) arm** ported from expo/exact's bench (#59, #61), and #4840/#4841 were found and fixed upstream within a day (#67).

### Era 4: round 15, the board task, and Solid 2.0 stabilizes (11-14 → 11-23)
- **Round 15 (PR #71, +186k lines, merged 11-20).** Preregistered, with 144 apps = 6 arms × 2 tiers × 2 tasks (desk9 plus a held-out **board** task). Result: .rx wins desk9 (Opus 0.00, Haiku 1.50 defects/app, best of all arms) but **loses badly on board** (Opus 6.33 vs React 0.67; Haiku 25.17 vs ~3). Both preregistered hypotheses were *not supported*. Writing the board references and probes surfaced a flood of Solid optimistic/projection bugs (#4861–#4864, #4874, #4888/#4889, #4897, #4902, #4904, #4907, #4918, #4926, #4928, #4929, #4931/#4932, #4969–#4972, #4987/#4988, #4990, #4998/#4999, #5002/#5003, #5077, #5090, #5095, #5104).
- The language changes that came out of it: `CATCH_NOT_ON_AWAIT` (catch only after an await, R-f-4), EF-2a (effects skip a failed input), AC-1g `STALE_CAPTURE`, `ARGUMENT_COUNT`, **guesses over writables** (07 decision 21, `GUESS_NO_QUESTION` retired), and ST-4a (keys at any depth). The guide converged on "one shape for server data, guesses on the answer" and "a page's data lives in the page".
- **Solid release track:** rc.22 (#64, keyed answers handed to Solid's reconcile) → rc.23 (PREREG-15 frozen) → **2.0.0/2.0.3 on main**. When Solid's `next` branch was deleted, ref switched to building from main (`f2dbd8b`, #87). The pins after that: main `99db9bc` (#71) → `c467fcd7f` with the optimistic-engine refactor #5137 (#90) → **`30e7805eb`**, which fixes #5095, #5104 and #5146 (PR #93). At that pin the board probe grades 0,0,0 and the board reference fuzzes 0/20.
- **Community tooling arrives (11-18 →):** the TextMate fix for markup in exported components (#86, cgaaf), a **tree-sitter grammar** (#88, oddcelot), a Zed extension (#92 open), a playground (#70 open), router support (#69 open), HMR (#68 open), and a batch of issues from people building real component libraries (#73–#84, #89).

---

## 2. Open PRs, by theme

**Adoption / ecosystem integration**
- **#69** (brenelz) **MO-11**: Solid components and router factories from `.rx` (declared components in `.d.rx`, `Component`-returning factories, components as values only in checked positions, DV-24). It unblocks a routed `solid-v2/with-reactivescript` template (solidjs/templates#347). Open questions are listed as spec/09 decision 8.
- **#68** (brenelz) HMR: hot-swaps a dependency's components under `vite dev`. Needs solidjs/solid-vite-plugin#539 and a new `@reactivescript/runtime/hot`. It raises spec questions: CP-4b surface, the module-instance rule, SSR+HMR. Ryan approved it pending a rebase.
- **#95** (cgaaf) fixes #84: the Vite front end no longer reuses a failed build.

**Editor / learning tooling**
- **#92** (oddcelot) Zed extension on top of the tree-sitter grammar (#88), running the same LSP.
- **#70** (brenelz) **Playground**: `.rx` ↔ Solid 2.0 primitives side by side, compiled in-browser via WASM (`app_with` reader, `jsx: true`). It also includes a prototype **Solid → .rx** converter and TS hover/completion in a worker. It found three compiler bugs (path functional write in `rt-web.ts`, `store.push` silently ignored, a structured equation lowered to `createMemo` instead of `createProjection`). Not deployed yet.
- **#91** (brenelz) fixes a recovering-parse hang on an unclosed block (8–27 s per keystroke). It's split out of #70.
- **#72** (simonzeiger) colours the diagnostic cards on the site. Ryan asked for the real one-line format; the rebase is done, and a richer compiler diagnostic format is offered as a separate PR.

**Eval**
- **#94** (ryansolid) reruns the .rx arm on Solid main `30e7805eb`. Board Opus goes 6.33→3.67 and Haiku 24.67→19.00, but desk9 Haiku *rises* 1.50→3.50. It files **solidjs/solid#5174** (NotReadyError in a click handler reading a ternary prop during a re-ask). The Cloudflare preview build is failing.

**Multi-frontend research**
- **#21** (devagrawal09) Demo, not for merge: Solid TSX and solid-yield frontends lowered onto the RX AST and checked by RX ("accepted code must behave like native Solid; otherwise refused"). It's context for #1.

## 3. Open issues, by theme

**Semantics questions about holds and coupling (cgaaf, all from a component library)**
- **#75** Does an object `provide` couple its fields? A part's write to its own state waits for the app's action because the provision also reads a held prop. It explicitly answers #20's "show me a case" challenge.
- **#76** An *unread* equation over two sources makes a write to one wait for an action holding the other. E-3 (undemanded equations retain nothing) conflicts with CP-4b lowering to an eager `createMemo`.
- **#77** Guide gap: a write waits for an action when a displayed equation reads its source alongside a held source, even from `onFlush`.

**Ownership soundness**
- **#37** O-4a: O-3 doesn't follow a closure stored through an action argument. Close the gap (MO-3 `retains(...)` across modules) and price it by porting a headless registration widget (Kobalte listbox / TanStack Form field). Successor to #15.

**Compiler correctness bugs**
- **#73** `"\n"` silently becomes `"n"` in string literals (0.3.1).
- **#74** A JS import named like a prelude function (`fetch`, `map`, `filter`, `len`…) binds to the conformance prelude `__B.<name>`.
- **#78** A type-only import from a JS module compiles to a value import (bundle `MISSING_EXPORT`).
- **#79** `ref={…}` reading an equation → untracked memo read → `STRICT_READ_UNTRACKED` dev warning.
- **#80** Product builds call the harness's `__rt.reg` for every binding, and the registry grows without bound (CP-4c harness leaking into the product build).
- **#84** Vite keeps serving a failed build (PR #95).

**Ecosystem / distribution**
- **#81** Compile-time styling (StyleX, vanilla-extract, Panda) can't see `.rx`. Imports are aliased and top-level bindings sit inside the module factory, and the plugin ordering is wrong. Asks whether compile-time CSS-in-JS is a goal or whether scoped `<style>` is the answer.
- **#82** Ship a **TypeScript 7.1 content mapper** so tsgo/tsrs check `.rx` in one pass (the crate already has the projection plus mappings).
- **#83** Resolve bare `.rx` specifiers through `node_modules`, so libraries can ship `.rx` source.

**Recently closed, worth knowing**
- **#1** semantic core → realized as CP-6, the resolved model in the crate.
- **#15** O-3 escape analysis → holes fixed in #16, the registration over-rejection removed with the RG-7c withdrawal, carried on in #37.
- **#20** "explicit ordinary async alongside inferred actions" → rejected. Holding is Solid's H-2 semantics, not something inference adds, and `onFlush` is the escape. #75 is the first serious counter-case.
- **#33** interpreter vs compiler around pending actions → interpreter fixed (#38).
- **#50–52** keyed `affects`, keyed answers merging, guide early-error → fixed (#63). **#64** → rc.22 reconcile. **#85** → #86. **#89** → upstream solidjs/solid#5123/#5124 (dev-only `ACTION_CALLED_IN_OWNED_SCOPE` on row teardown).

---

## 4. The Solid-upstream feedback loop

ReactiveScript works as a **conformance oracle and fuzzer for Solid 2.0's async/optimistic engine**. It runs in three layers:

1. **Spec ↔ Solid scenarios (the oracle).** The spec restates Solid's own rules (F-1..12, D-*, SCENARIOS.md S-1..S-50). Every scenario runs through five runners: the interpreter, the **oracle** (same program on real Solid), compiled `.rx`, SSR/hydration, and types. A frame mismatch becomes a numbered **DV** with a signals-only repro in `ref/oracle/repros/`. Then Ryan rules each DV either a Solid bug (filed upstream) or Solid being right (the spec adopts Solid's answer). Examples:
   - The first batch on 10-26: DV-3/4/7/8/9..17 became solidjs/solid #4268–#4287, and most were fixed within hours (#4282, #4278, #4277, #4279, #4276, #4281, #4299, #4302).
   - DV-10 (#4284) and DV-11 (#4272) were reversed toward Solid.
   - DV-18 (#4305) was a regression bisected to one commit.
   - DV-19..23 came out of Solid's **#4695** rulings ("ruled, not built"), and DV-24 is in #69.
   - The milestone: on 10-27 at rc.19, **zero recorded divergences**.
2. **AI-written apps plus a timing fuzzer (eval).** Agents write the same apps in several arms, and `harness/fuzz.mjs` replays seeded async timings against oracles (A1–A5, B1–B5). When an .rx app shows a hole, it's traced down to a plain-Solid repro under `eval/results/*/repro`. Most "language" defects in rounds 7–15 turned out to be **Solid optimistic-store / keyed-projection / error-boundary bugs**. Examples: #4437 (createOptimisticStore swallowing errors), #4795 (guess while loading → became Solid's `OPTIMISTIC_WRITE_WHILE_LOADING` and RX's `GUESS_WHILE_LOADING`), #4840 (infinite loop), #4928/#4969 (reasks recursion), #4972 (RangeError in heap insert), #4990 (Show fallback with pre-hold values), #5002, #5077 (For row and memo disagree after a failed re-ask), #5095, #5104, and #5146 (hydrated projection stops following, a side effect of the #5097 fix). Rounds are often **frozen on a Solid commit that includes the fixes they found** (PREREG-11 lists #4724, #4737–9, #4748, #4751; PREREG-15 "Solid fixes through #4904").
3. **Pin discipline.** `ref/SOLID_NEXT` and `compiler/Cargo.toml` pin an exact Solid commit (rc.16 → rc.19 → rc.20 → rc.21 → rc.22 → rc.23 → main 2.0.x). Every repin reruns all runners and the repros, and the PR titles list which upstream issues the pin fixes (#9, #30, #64, #90, #93).

**Scale.** About 95 solidjs/solid issues mention ReactiveScript. Most are filed by ryansolid, with brenelz, tembo[bot] and cgaaf also filing. Almost all are closed, which means fixed in Solid. **Still open upstream:** #5092 (lowered `<Show>` differs from the `<Show>` component during a held write), #5117 (store lane derivations staged per key: 8 torn/undefined row repros), #5118 (guess before first answer, S-56), and #5174 (from #94). Solid also changed its own API surface for RX: `compile_program`/`compile_style` (#4290/#4289) and the vite-plugin `frontends` hook (#471). devagrawal09's own solidjs/solid issues (#4178–#4223, #4552, earlier ones) predate RX and are general 2.0 rc bugs. They're context, but not oracle output.

So there's a two-way contract. RX is defined as "Solid 2.0's semantics, statically checked", and in practice RX became the **highest-yield bug source for Solid 2.0's async engine during the rc → 2.0 window**. The work goes: the spec states what Solid should do, the oracle shows what it does, and the eval/fuzzer finds the shapes nobody wrote a test for.

---

## 5. Open threads / logical next steps

- **Explain the board gap.** Round 15 shows .rx best-in-class on desk9 and worst on board. #94 shows that much of the board gap was Solid bugs (now fixed), but desk9 Haiku regressed (1.50→3.50) and board Haiku is still ~19 vs ~3 for React/Foldkit. Next: trace the remaining defects into language checks, guide changes or upstream bugs, and decide whether a round 16 runs on Solid 2.0.x final.
- **Hold-coupling semantics (#75, #76, #77).** This is the first real challenge to the #20 ruling. The questions: is lowering unread equations to eager `createMemo` (E-3 vs CP-4b) a spec bug, should `provide` of an object couple its fields, and what's the guide's answer? Each needs a ruling, and possibly a Solid-side change (lazy memo / per-field provision).
- **Product-build hygiene.** The harness surface is leaking into product output: `__rt.reg` (#80) and the prelude names `__B.*` (#74). Add a "conformance vs product" lowering split and test it. Fix the cheap correctness bugs: #73 string escapes, #78 type-only imports, #79 untracked `ref` read, plus the three bugs #70 found (path functional writes, `push` on a store read, structured equation lowered to memo vs `createProjection`).
- **Land the community PRs.** Merge #91/#95 (small, tested), #68 after the rebase (and decide the spec/09 and spec/11 questions it raises), #92 (Zed), and #72. Make a call on #69/MO-11 (router and declared components). It's the gate to real routed apps and the official template (solidjs/templates#347).
- **Distribution for library authors.** #83 (ship `.rx` source through node_modules), #81 (compile-time styling: decide whether it's a goal, and if so a verbatim module-scope form plus plugin ordering), #82 (a TS 7.1 content mapper, which reuses CP-8c's projection and is cheap given the existing pieces). Together these make up the "RX for component libraries" story that the cgaaf/ethan-huo reports describe.
- **Ownership soundness (#37).** Close O-4a (closure through an action argument, `retains(...)` in signatures) and run the headless-widget port that prices `REGION_ESCAPE` for the library tier.
- **Multi-frontend / semantic core (#1, #21, #20).** CP-6 exists, but #21's TSX frontend is still a demo, and #70's Solid→.rx converter is a second, text-based take on the same idea. A next step would be to consolidate them: a TSX → resolved-model frontend that checks plain Solid 2.0 code with RX's rules, which is the "Solid Sound" idea in #1.
- **Playground and learning.** Host #70 at reactivescript.dev/playground (needs a wasm32 build step and `base`), and consider making "show me the Solid 2.0 primitives" the main teaching surface.
- **Upstream loop maintenance.** Track #5092/#5117/#5118/#5174 and repin when they land. Keep "0 recorded divergences" as a release gate. Decide whether the oracle/repros become a test suite Solid itself runs in CI.
- **Release cadence.** 0.3.1 is two weeks old, and `CHANGELOG.md`'s Unreleased section already holds a breaking change (`CATCH_NOT_ON_AWAIT`), guesses over writables, EF-2a, STALE_CAPTURE and ARGUMENT_COUNT. A 0.4.0 pinned to Solid 2.0.x final is the obvious next release.
