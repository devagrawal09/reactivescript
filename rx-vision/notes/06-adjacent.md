# 06 — Adjacent work and prior sessions

Scope: the sibling dirs under `~/work/solidjs/` (other than `reactivescript/` and the `rx-*` worktrees), plus `~/work/reactivity` and `~/work/labs/reactivity-board`. Also three session dumps and `~/agent-profile/PROFILE.md`. Everything was read-only. I ran no builds and wrote nothing outside this file. I made a few `gh` GET calls.

## TL;DR

- Almost all the adjacent work from Nov 18–24 falls into three clusters. All three are **Solid-core work, not ReactiveScript work**. They live as worktrees of one Solid clone (`~/work/active/research/solidjs`, remote `fork` = devagrawal09/solid).
  1. **Observability / devtools / time travel**: a design doc, 3 spikes, 3 design experiments, 2 local PRs, 1 draft PR upstream (#5089), and a devtools History panel.
  2. **The Solid bug pipeline**: repro, fix, and verification baselines.
  3. **Store and runtime tiers**: Solid-side prototypes with **paired RX compiler prototypes**. This is the only cluster where RX code is actually being written against new Solid surface.
- The link between cluster 1 and RX is conceptual, not code. RX's spec/99 sorts Solid's diagnostic codes into three bins:
  - **U**: the grammar makes the mistake unwritable.
  - **S**: the static checker catches it.
  - **R**: it stays with the runtime's attribution engine.

  The devtools and the attribution engine are **the bin-R half of RX's diagnostics story**, and the codes keep the same names on both sides (CN-1b). The time-travel "pin" also adds a new kind of guess, which RX's semantic model and the rust-solid port would eventually have to model.
- `~/work/reactivity` and `labs/reactivity-board` are old and unrelated. The "rx" in `reactivity/rxjs*` means **RxJS**, not ReactiveScript.
- The all-agent profile **barely mentions ReactiveScript** (one line). RX work mostly runs in Claude Code web "project threads" and a Tembo sandbox, so local agent history under-represents it. The vision has to come from the repo's own docs and handoffs, not from the profile.

## 1. Directory map

| Dir | What it is | Goal | Relation to RX |
|---|---|---|---|
| `DESIGN-minimal-core-devtools.md` | Loose file (701 lines, Nov 19) | Design review of 3 spikes. Core gets only `tap` + node accessors (PR 1) and `openView` (PR 2); everything else lives in the devtools. Has a "Questions for Ryan" section. | Indirect: the diagnostics layer that RX's bin R relies on |
| `solid-changes-feed` | Worktree of the Solid clone, `spike/lean-changes-feed` | "What each drain showed" (`FlushEvent.changes`) without the attribution engine: a second hook slot plus `changeFeed` | Same |
| `solid-time-travel` | Worktree, `spike/time-travel-overlay` (merges the feed spike) | Time travel as a view over the lane system: one hold plus lanes of pinned guesses | Semantic: a "pin is a guess that no truth corrects" (breaks F-11/D-34 as written) |
| `design-feed-kernel` | Worktree, `design/feed-kernel` (throwaway) | Proves the change feed can live outside core (234-line `userland/change-feed.ts`) on a drain-hook slot | Indirect |
| `design-hook-slots` | Worktree, `design/hook-slots-v5` (throwaway, V1–V5) | Hook-slot designs measured by bytes and per-call cost | None |
| `hs-art`, `hs-bench` | Artifact dirs, not git | Size JSON per hook-slot variant v0–v5. A pinned-core bench across postures (idle/ext1/ext2/engine). | None |
| `design-view-primitive` | Worktree, `design/view-primitive` | The smallest core `openView`. Time travel moves to `userland/time-travel.ts`. The observer partition is dropped; the toolbar runs on its own Solid copy. | Semantic (pins) |
| `dvp-tools`, `fk-tmp` | Scratch, not git | rolldown + brotli module-size script, mangled view bundle, feed-kernel dists | None |
| `pr-drain-tap` | Worktree, `feat/signals-drain-tap` | Local PR 1: tap + accessors + second slot. **Shelved** after the user's "one way" ruling. | None |
| `pr-view` | Worktree, `feat/signals-view` (untracked `PR_BODY.md`) | `openView`. Posted as **draft PR solidjs/solid#5089** (still draft and open, updated Nov 19). | Semantic |
| `ssd-hist-solid` | Worktree, detached | The #5089 Solid build, linked into the devtools by pnpm override | None |
| `pr-repro` | Worktree, detached (untracked `FINDINGS.md`, `fix.patch`) | Shows the nested-lane stack overflow is reachable from the public API: an input guess, then its held async reader's guess, in the same tick | Same class of bug RX's oracles find |
| `pr-nested-lane` | Worktree, `fix/signals-nested-lane-guess`. **Uncommitted** `guesses.ts` fix + test + changeset. | Issue + fix PR for that bug. The user said "go". I found no matching issue authored by the user, so this looks **unfinished**. | Same |
| `pr-base`, `pr-base-main`, `pr-art`, `pr-art-nl` | Detached baselines + artifacts | Verification baselines: test tables, size tables, a native `@solidjs/compiler` build recipe (`pr-art/COMPILER.md`) | Shared infra: RX's `scripts/setup.sh` also builds Solid's native compiler from source |
| `rt-proto-tiers` | Worktree, `proto/rt-tiers` (same tip as `store-proto-features`, `413a25201`) | Build-time store feature switches (`__STORE_ACCESSORS__/GUARDS/SHALLOW/FAMILIES/OPTIMISTIC/DELETE`) and a `dist/select` tier | **Direct**: RX emits a feature manifest that sets these |
| `store-proto-{base,core,plain,both,features,sitecache,slots,writes,combined}` | Worktrees, `proto/store-*` (Nov 23) | Store runtime prototypes: target-level traps, `plainData`, `storeGetAt` site reads, `storeShape` fixed layouts, `storeWrite` | **Direct**: each has an `rx-store-proto-*` twin (`proto(ref/compile): … (Solid proto/store-X)`) |
| `store-proto-bench` | **Clone of the reactivescript repo**, `proto/store-bench` | Benches + differential fuzz + patches for the store prototypes, `.rx` workloads (counter/deep/keyed/rows/optimistic) | Direct, and RX-owned |
| `solid-start-devtools` | Own clone (fork; upstream solidjs/solid-start-devtools) | The Solid 2 dev toolbar: Health, Activity, Structure | Consumer of bin-R diagnostics |
| `ssd-lazy-engine` | Devtools worktree, `spike/lazy-attribution-engine` | Load the attribution engine only while recording (−149 KB / 46 KB gz at page load) | Indirect |
| `ssd-time-travel` | Devtools worktree, `spike/time-travel` | First History view on the spike's `timeTravel` | Indirect |
| `ssd-history` | Devtools worktree, `feat/history-time-travel` (`b699c7a`) | The real History panel: recording through the engine's single `flush` subscription, rewind via `openView`, toolbar on a private Solid instance, page lock with "Unlock page". **Unpushed.** Drop `a16a600` (the local Solid link) before pushing. | Indirect |
| `solid` | Old clone of solidjs/solid at 1.9.7 (May 2025) | Stale | None |
| `solidbase` | Fork of kobaltedev/solidbase | Solid 2 migration + REPL support. REPL PRs #178–181 are waiting on review. | None today. A possible docs/REPL host for RX (RX's `site/` is a bare Cloudflare `index.html`). |
| `~/work/reactivity/{rxjs,rxjs-signals}` | Not git, Oct 2023 | SolidStart 0.3 + RxJS interop demos | None (name collision only) |
| `~/work/labs/reactivity-board` | Not git, Nov 2024 | Four TS sketches: push, pull, pull-continuous (time-indexed), and stateful observables | Conceptual ancestry at most |

The `rx-*` worktrees (eval-todo, lsp-eval, pin-main, pin-main-rust-{engine,render}, store-proto-*) are other slices. They do matter here, though: the `eval-todo`/`pin-main` branches are the **"solid-model" line**. Its tree is different (`frontend/`, `rust-solid/`, `apps/`, `dashboard/`, pinned `reactivescript/` + `solid-next/`). That line is where the oracles and fuzzing live (section 4).

## 2. How each cluster relates to ReactiveScript

### 2.1 Observability, devtools, time travel (Nov 18–19)

**Chain of events.**
1. The user asked whether the devtools could rely on `flush.changes`, noting "Ryan mentioned that DevTools should not require bringing in the complete attribution engine".
2. That produced three spikes: lean feed, lazy engine, and time travel.
3. Next came a Fable "design" review with three throwaway experiments, then two local PRs.
4. Then a ruling from the user:

> "i dont want multiple ways of doing the same thing in the observability engine of solid. features should be consolidated."

5. PR 1 (tap) was shelved. PR 2 (`openView`) was rebased onto main and drives time travel from the existing `attribution.enable()` + `flush` record. It went up as draft #5089.
6. The devtools History panel was rebuilt on it: one recording path and one rewind path, with the old `createTracked` overlay removed.

**Connection to RX:**
- **Shared diagnostic vocabulary.**
  - `spec/99-diagnostics.md` takes Solid's dev-diagnostic table and puts every code in a bin: U (unwritable), S (static), or R (runtime: "stays in the runtime's attribution engine unchanged").
  - `spec/08` CN-1a: "Bin R is not a constraint: it is the runtime's attribution report … and never fails a build."
  - CN-1b: static errors keep the dev runtime's names.

  So the attribution engine plus the devtools Health/Activity views are where RX programs get the diagnostics RX deliberately does not check. Examples: `SILENT_HOLD`, `ASYNC_WATERFALL`, `LONG_HOLD`. RX eval rounds already cite these at run time (`eval/results/fuzz-2026-10-30`: "attribution already reports it at run time (`SILENT_HOLD`)").
- **Cost.** The lazy-engine spike's numbers matter for any "RX app + devtools" story. Today 19 issue codes come only from the engine (~15 KB brotli at the observe tier, up to ~9× slower flushes in the worst case).
- **Semantics.** `openView` pins are "an ordinary optimistic guess over that hold", but one that no truth corrects. RX encodes guess rules in the language (`guess x := v`, 06 AC-3a `GUESS_WHILE_LOADING`). If pins become official, they are a runtime-only construct. RX would not expose them, but the rust-solid port and the conformance oracles would have to tolerate or model the extra hold.
- **The nested-lane bug.** The time-travel spike found it, and `pr-repro` showed app code can reach it: `createOptimistic` input guess, then the async reader's guess, same tick. That is the same class of bug RX's differential fuzzing surfaces (the `solid-model` handoff lists 11 suspected Solid bugs from fuzzing rc.21). The two efforts are separate bug feeds into Solid.
- **Agents did not cross-read.** The time-travel spike notes: "the optional reactivescript handoff was not read." Nobody has checked whether RX's guess/hold model (or rust-solid's engine) could have informed the view design, or vice versa.

### 2.2 The Solid bug pipeline

`pr-base`/`pr-art` set up how to build and test Solid like CI, including the native compiler recipe. RX's pin moves keep producing Solid repros:
- `e650b85`: "Pin Solid main 30e7805eb (#5095, #5104, #5146 fixed)"
- `33f862f`: "repro for solidjs/solid#5146"
- round 14 produced Solid #4840/#4841

So in practice RX acts as a **conformance oracle for Solid itself**. Each pin bump is also a Solid regression sweep.

### 2.3 Store and runtime tiers (Nov 23–24): the direct feed

This is the one place RX drives Solid design. Solid-side `proto/store-*` branches add entry points a compiler can target:
- target-level traps (`storeGet/storeSet/...`)
- `plainData`
- `storeGetAt` read sites
- `storeShape` fixed layouts
- `storeWrite` walks
- build-time feature switches (`rt-proto-tiers` / `store-proto-features`)

Matching `rx-store-proto-*` branches teach `ref/compile` to emit them, e.g. "a feature manifest that sets Solid's store switches", "read sites for fixed-key member reads". `store-proto-bench` (in the RX repo) measures them with `.rx` workloads, using a noise-floor protocol and differential fuzz.

This is the payoff of the thesis "RX knows the static graph": the compiler can pick a runtime tier and fast paths that hand-written Solid can't safely pick. It is probably covered by the store-compiler slice (`store-compiler-design.txt`). For the roadmap, file it under **"RX → Solid: compile-time knowledge buys runtime tiers."**

## 3. What the user has said about ReactiveScript's purpose and direction

From the sessions in scope (short quotes; the user's words unless marked):

- **The repo-summary session.** The agent called RX "very active, last pushed yesterday, and none of it has a PR". It found 13 merged `claude/project-thread-*` branches plus handoff branches: `eval-demo`, `plan-v2-composition`, `rc-frontend`, `rc-ladder`, `rust-solid-perf-r1…compose`, `solid-model`. Decisions it listed as waiting on the user:
  - plan v2.3 composition (cross-module imports, prop defaults, rest/spread props; "In the t3code survey, imports are the biggest blocker")
  - the Eval RFC: scalars vs arrays/records, "whether to send the RFC to Ryan privately first", whether to link the demo
  - the next `solid-model` slice: native window / slice-6 gaps / move to latest Solid + RX
  - deleting 7 merged fork branches
- **The eval-todo session.** The user's asks show a "dogfood RX inside Solid 2" direction:
  - "build me a new solid 2 web app that uses `eval(() => ...rx code, { bindings })` to show a little todo app with optimistic updates built entirely in rx and evaled live"
  - "a little code editor where i can write rx code, that is built in rx … can live edit its own code and have changes made in realtime to itself"
  - "make a slightly larger app with forms and tables to stress test rx and eval a bit"
  - tooling pull: "is there an lsp for .rx yet" / "i need it in my vscode" / "is there not a proper vite plugin for rx" / "do the proper lsp fix"

  When the agent framed rust-solid re-parity as a big project, the user pushed back (the agent conceded "I was estimating in human time"). The decision was **full parity**: keep the Rust workers going until they're back to ~985–1000 agreements per 1000 fuzz seeds.
- **The `solid-model` README/HANDOFF** (the fork line the eval work sits on) states the widest vision:
  > "'Solid' is a semantic model plus a conformance suite. Syntaxes, host languages, runtimes (Solid JS, a Rust port), renderers and client/server placement are plugins around that core."

  A plugin is accepted "only where it is identical to native Solid 2". Three levels are "always kept apart": syntax we recognize, the verified subset, and full readiness ("never claimed").
- **RX README (upstream):**
  - mistakes become "things the compiler refuses, the way Rust refuses a borrow"
  - "It is also meant to be easy for an AI to write correctly" (fresh agents predicted 70/71 frames)
- **The devtools session**, as principles that transfer directly to RX:
  - "i want minimal changes made to the solid core … heavy lifting to happen outside"
  - "one way to do a thing"
  - "different systems communicate with same apis plus i feel like there's too many combinatorics? isnt there a simpler overall system"
  - "please use more code and pseudocode examples than prose"
- **PROFILE.md.** Only one line: "He compares Solid 2 to Foldkit, ReactiveScript, and Datastar." It lists Solid 2 rules (no effects for async, derive by passing a function, throw to boundaries). RX now turns those rules into grammar and checker rules. It also records "One way to do a thing. Consolidate overlapping features." Otherwise the profile's through-line is Specter, OC++, and Codemod. RX is invisible there because its work happens in Claude Code web / Tembo, not in local transcripts.

## 4. Working style around RX

- **Claude Code web "project threads".** There are 40 `claude/project-thread-*` remote branches. Upstream `solidjs/reactivescript` main has **293 commits authored by "Claude" vs 110 by Ryan Carniato**, merged via PRs like #71 `solidjs/claude/project-thread-xp2irv`. The upstream RX repo is largely agent-written under the user's direction.
- **Handoff branches.** Each work branch has a `handoff/*` twin with a `docs/HANDOFF.md` written for "a fresh session": goal and thesis, how the user works, environment, a "Start here" list. Spikes do the same (`HANDOFF-time-travel.md`, `SPIKE-*.md`, `PR_BODY.md` kept untracked).
- **Oracles and fuzzing.**
  - Differential fuzzers compare every leg with native Solid "trace for trace, byte for byte" (TSX/yield frontends, plan v2 emitter, rust-solid engine and renderer, SSR, Frames), scored per 1000 seeds.
  - Gates carry recorded counts: "a run that differs is a failure, not a tolerance".
  - Briefs say "Never loosen a check to get green".
  - Upstream strict-tsc baselines get re-recorded on pin moves.
- **Pinned, read-only checkouts.** RX and Solid are pinned by commit (`frontend/pins.json`, `scripts/setup.sh`). Each agent gets its own worktree, with those checkouts symlinked in. Pin moves are their own tracked projects (`pin-main`, split into frontend / rust-engine / rust-render workers with file-ownership fences).
- **Agent topology.**
  - A custom `orchestrator` agent (Fable) delegates to `general` children (Opus for hard work, Haiku for mechanical work). It was created mid-session after a `general` agent couldn't spawn children.
  - Nesting depth is 2.
  - Each worker owns specific files, and the briefs say "do not touch" sibling worktrees.
  - An independent verifier reviews results, and the parent re-checks claims ("their output is sometimes truncated or wrong").
- **Publishing discipline.**
  - Local commits only. Push, PR, issue or comment needs an explicit "go", and an OK covers only the action it names.
  - GitHub comments are blockquoted and signed "— *Claude via OpenCode*".
  - Numbers are labelled [measured]/[spike]/[estimate].
- **Communication.** Code-first explanations, two decisions at a time, vertical slices ("tracer bullets"), and browser passes in the user's paired Chrome.

## 5. Open threads

- **#5089 (`openView`)** is a draft and needs Ryan's rulings:
  - the pin-vs-F-11/D-34 rule
  - frozen frames for views
  - stores (unread properties have no node, so they can't rewind)
  - whether reads outside rendering should see the present

  Two confirmed bugs (an extra `Symbol(STORE_TRACK)` change at the landing, and a `SILENT_HOLD` that names the wrong click) await a go-ahead to push fixes. One test filters `SILENT_HOLD` out and may be hiding the second.
- **The nested-lane bug** (`pr-nested-lane`): the fix and test sit uncommitted, and I found no filed issue. Was it abandoned mid-run or filed under another account? The user had approved posting.
- **Devtools History panel** (`ssd-history`, `feat/history-time-travel`): unpushed. It needs `a16a600` dropped and the `OPEN_VIEW_MIN_VERSION` message decided (the recommendation was to drop the version number). It depends on #5089 landing.
- **PR 1 (tap)** is shelved, and the "one way" ruling stands. The question "can the devtools avoid the full engine?" is now answered only by lazy loading.
- **RX × devtools has never been joined up.** Nothing shows an RX app running under the dev toolbar, mapping bin-R findings back to `.rx` source locations, or the LSP surfacing runtime attribution. That is a natural roadmap item, given CN-1b's shared codes.
- **RX × time travel.** Could RX's static graph (sources, guesses, regions) give the History panel names and structure that runtime node ids can't? Could RX's model say which pins are safe? Nobody has read across.
- **The store/runtime-tier prototypes** (`proto/store-*` paired with `rx-store-proto-*`) are the live RX→Solid design channel. Their Solid-side changes would need upstream PRs, and that conversation with Ryan hasn't started.
- **Solid-bug feed from RX.** The 11 rc.21 suspected bugs from the `solid-model` handoff haven't been re-triaged on Solid main. The `pin-main` move is partly that work. The rust-solid parity drop (e.g. boundaries 356/1000, render 420/1000 on Solid main) is the biggest open item there.
- **Pending decisions from the summary session:** plan v2.3 composition (imports, prop defaults, rest/spread), the Eval RFC (value shapes; sending to Ryan privately first; linking the demo), the next `solid-model` slice, and deleting the merged fork branches.
- **Tooling gaps the user asked about:** no "proper vite plugin for rx". The LSP eval-snippet support (`0.3.2-eval.0`) is local-only on `lsp-eval-snippets`. The upstream parser hangs on an unclosed trailing tag (worth an upstream issue).
- **solidbase** could host RX docs and a REPL (it already has Solid 2 REPL work). There's no link today.
- **Profile gap:** `PROFILE.md` has almost nothing on RX. If the roadmap doc is meant to steer agents, a short RX section (thesis, gates, "never loosen a check", pin discipline) belongs in the standing profile/AGENTS file.
