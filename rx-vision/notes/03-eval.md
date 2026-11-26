# 03 — The evaluation program

Slice: `eval/` (README, 12 PREREGs, `results/`), `examples/ai`, `examples/ai2`, PR #94, and the `eval-demo` / `eval-todo` / `lsp-eval-snippets` branches. Read-only pass, 2026-11-24.

**Naming collision first.** "eval" means two different things in this project:

1. **The AI eval**, `eval/` on main. A benchmark: fresh agents build the same app in .rx and in other stacks, and hidden tests, overlap tests and a timing fuzzer grade the result. Most of this doc is about this one.
2. **Runtime `eval`**, on Dev's fork (`eval-demo`, `eval-todo`, `lsp-eval-snippets`). A language feature: `eval(code, { bindings })` / `createEval` runs a string of .rx inside a running app, checked against a typed interface. Covered at the end under "the other eval". The session transcript is about this one, not the benchmark.

---

## 1. What the program measures

The thesis is "agents write .rx correctly more easily than the alternatives." The program has tested it in three ways over time.

### a. Cold-writer frame prediction (Oct 2026, `examples/ai`, `examples/ai2`)

These aren't benchmarks. They test whether the spec is readable. Fresh agents got only the spec, wrote an app, and predicted each frame (what the screen shows after each scripted landing) before anything ran.

- `examples/ai` (feed, wizard, grid), spec only, no checker: **34 of 35 frames** predicted right. The miss became rules EF-2 and H-1.
- `examples/ai2` (tracker, settings, search), multi-module, with the checker in the loop: **36/36 frames** right by the spec. Where the runners disagreed, the **runners** were wrong: three interpreter bugs, two lowering gaps (E-11, the hoisted `await`), and Solid bug DV-8 (solidjs/solid#4271).
- The agents' notes changed the language: `component C()` with no props, `export type` importable, sources holding their initializer's failures, diagnostics carrying markup lines, H-12 (a re-armed `loading` takes over from `errored`), and R-f-10 (`errored fallback(e: Panic)`).

### b. Head-to-head rounds (`eval/`, pilot through round 15, plus the PR #94 rerun)

Every round has the same core:

- Every API call is a **flight** (`harness/flights.js`) held in the air until a test lands it or fails it, so the test picks the answer order.
- **Hidden tests** play the adversarial orders. **Overlap tests** (from round 3) put two writes in the air at once, or a write against a reload.
- From round 8 there is a **seeded timing fuzzer** (`fuzz.mjs`, later `fuzz-board.mjs`) with per-frame and settled oracles.
- Tests assert only what a user sees.
- The headline is **defects**: failed hidden tests + failed overlap tests + fuzz seeds that found a hole, minus traced by-design holds (H-11, shared-list holds).
- Cost (billed tokens to $), turns, time and lines are reported alongside.

| Round | Date | Design | Headline |
|---|---|---|---|
| Pilot | 10-27 | search/tracker/settings, .rx vs React, frontier, briefs name the races | 0/9 vs 0/9 defects. .rx used 2.4× tokens and 73 vs 168 lines. Didn't discriminate. |
| 2 (plain) | 10-27 | Race sentences removed from the briefs; frontier + Haiku | React 0/18, .rx 1/18. H1 not supported. Models guard stale answers unprompted. |
| 3 (overlap) | 10-27 | Overlapping writes | 4/18 vs 5/18 (p = 1.0). All frontier .rx failures were solid#4329. Without it, 4/18 vs 2/18. |
| 4 (change) | 10-28 | Change an app you didn't write (rename/close/comments) | React 0/18, .rx 3/18, all Haiku. Two of the three were read-before-await, write-after. |
| 5 / 5b / 6 (cost) | 10-29 | Cost to change the issue desk; .rx vs React vs Solid 2 TSX, then Foldkit | .rx cost 30% more than React (p = 0.989 against H1), level with Solid. Foldkit cost the most. Cost tracks turns, and turns track how sure the agent is of the semantics. 0 defects in every arm. |
| 7 (chains) | 10-30 | 4-step maintenance chains, fresh agent per step | **Reversed.** React 0/6 chains ending with a defect, .rx 4/6, all at step 4 (row actions hitting H-11, then a Solid bug). .rx cost 1.65× per chain. React guards didn't decay. |
| 8 (fuzz) | 10-30 | 50 seeds × 138 desk apps from rounds 5–7 | **Reversed.** Mean share of seeds with a hole: React 0.9%, .rx 19.9%, Solid 10.1%, Foldkit 0.3%. No .rx hole came from an answer applied out of order. Holes came from three Solid optimistic-store bugs, handler reads of absent values (became R-8), and the desks' own choices. |
| 9 | ~11-01 | desk9 built (not preregistered) | Small React/plain scored 28–32/38 overlap, small .rx 34–36. First sign of the "raises the floor" hypothesis. |
| **10** (desk) | 11-02 | desk9, 4 arms (.rx, React, plain TS, Foldkit) × frontier/small, cost per correct app | Small tier: .rx 6.7 vs React 14.7 (**H10a supported**, Holm p = 0.014) and vs Foldkit 14.5 (supported). vs plain 9.8 not supported. Small .rx didn't reach frontier React (H10c failed). No correct app in any arm. |
| cost-11-03 | 11-03 | One-page `guide/reference.md` inlined | Cost −12%, calls unchanged. **First fully correct app on desk9 in any arm** (once Solid fixes landed). |
| **11** | 11-11 | Round 10 replicated on a newer Solid | Small: .rx 3.8, React 9.7, plain 14.5, Foldkit 13.2. **All three H11a/b supported.** Frontier: all arms 2–3. First 0-defect apps (frontier .rx-1, React-1). |
| XState side check | 11-11 | 9 XState desks | Small 7.0, frontier 2.0. Better than Foldkit, between React and .rx. |
| **12** | 11-11 | 5 arms (adds XState), 6 runs per tier | Small: .rx 6.0 (median 4) vs React 11.3, plain 12.3, Foldkit 13.2, XState 13.0. Raw p = 0.046 vs React, but **H12a not supported after Holm** (0.091). Only vs Foldkit held. Frontier .rx was **worst** (3.2 vs React 1.8; one 10-defect desk). |
| 13 (probes) | 11-13 | Hand-written desk9 reference reaches **0**; guide sections "lay every view over the answer" and "data belongs with its lifetime"; Exact (expo/exact) ported as the `contract` arm | Opus .rx on the lifetime-rule guide: 2, 0, 0. Exact: 1.0. Both guide-caused failures and Solid bugs (blank text #4831/#4834, loops) were found and filed. |
| **14** (exploratory) | 11-13 | Frontier only: .rx vs React vs Exact, 6 each | .rx 0.33 (4/6 at zero), React 2.17, Exact 1.67. After Solid fixed #4840/#4841, **.rx 0/0/0/0/0/0**. React's misses were mostly one class: a guessed comment or label lost on reload. |
| **15** (publication round) | 11-16/17 | 6 arms × 2 tasks (desk9 + **held-out board**) × 2 tiers × 6 = 144 apps, released builds only (Solid rc.23), PREREG frozen | See below. |
| Rerun (PR #94, open) | 11-23 | 24 new .rx apps on Solid main 30e7805eb, current guide | desk9 Opus 0.33, Haiku 3.50; board Opus 3.67, Haiku 19.00 |

**Round 15 in detail.** It is the only round run on released builds with a held-out task, so it's the one that counts.

| | rx | React | Exact | XState | Foldkit | vanilla |
|---|---|---|---|---|---|---|
| desk9 Opus | **0.00** | 3.17 | 1.67 | 2.67 | 2.67 | 5.00 |
| desk9 Haiku | **1.50** | 9.00 | 21.83 | 16.50 | 16.00 | 11.00 |
| board Opus | 6.33 | **0.67** | 7.17 | 1.50 | 1.33 | 1.50 |
| board Haiku | 25.17 | 3.00 | 31.67 | 15.67 | **2.83** | 3.00 |

- H15a (Haiku, pooled, rx < each arm): **not supported**. vs React: −7.33 in React's favour, p = 0.89.
- H15b (Opus, rx no worse than React by more than 1 defect): **not supported**. +1.25 [0.33, 2.17].
- H15c (board Haiku, rx < React): **not supported**. p = 1.
- **The honest reading:**
  - On the familiar task, .rx wins clearly at both tiers.
  - On the held-out task, .rx is second worst, ahead only of Exact.
  - Traced cause: all 6 Opus board apps carried over desk9's guess-ledger shape instead of the guide's "one store over the server". The checker accepted the ledger shape, and the hand-written writes it forces after an accept are where the agents failed (wrong column, stale card, placeholder shown twice).
  - Four Solid bugs were filed (#4969–#4972), but fixing them barely moves the gap.
  - The write-up calls this "a guide/teaching result … not a sign that the language's semantics are wrong."
- Cost: Opus .rx is ~$1.23 on desk9 (level with React's $1.20) and $1.66 on board (vs React $0.90). .rx apps are consistently the smallest: 340–454 lines, against React's 650–970 and Foldkit's 1,600–2,500. The whole round cost $128.74.

**After round 15** (board probes 2026-11-17, then PR #94):

- **Probe 1:** the AC-1g draft check. Mean 5.67 vs 6.33, no real change.
- **Probe 2:** the guide rewritten to "one shape: guesses on the answer stores, accepts re-ask them". All 3 apps adopted it (mean 5.0).
- **Probe 3:** "re-ask every list the row can be in". Hold probes now pass, but fuzz holes rose (mean 9.67), mostly from new Solid bugs (#4987, #4988, #4990, #4998, #4999, #5002, #5003). Regraded on Solid main: 3.67 / 8.67.
- **PR #94** (24 fresh .rx apps on Solid main, probes widened):
  - board Opus 6.33 → **3.67** (0, 14, 1, 0, 0, 7; one desk is agent code, one is solid#5174);
  - board Haiku 24.67 → 19.0;
  - desk9 slipped a little (Opus 0 → 0.33, Haiku 1.5 → 3.5).
  - The PR is open. It records two probe changes as "judgement calls, for Ryan to check".

### c. Side programs

- **Mutants** (`mutants/`): naive React drafts (fetch effects without cancellation, a rollback to the wrong value, a form that re-seeds). They pass every visible test and fail 3–5 hidden ones. Run before freezing, they show the hidden tests can catch what they're meant to catch.
- **Probes** (`probes/`): exploratory checks on finished apps. The round 3 overlap tests started as probes on round 2's apps.
- **References** (`reference/<task>/<arm>`): hand-written in every arm. From round 15 on, every arm's reference must grade 0 before a round starts (the "gate"). Writing the board reference changed the guide and the language (ST-4a keys at any depth) without looking at agent output, which is how board stays "held out" (not blind to the authors, as stated).
- **Oracle and regrades**: `rc21-regrade` and others regrade older apps on newer Solid to separate agent defects from runtime defects. Rounds 5, 7, 10 and 11 didn't commit their run sources and can't be regraded.
- **Outside harnesses**: `scaffold.mjs … --inline-docs` + `grade.sh` make a desk self-contained, so Cursor/Codex/Grok runs can be graded the same way. Expo's Exact grades its own reference with this harness (their `bench/reactivescript`).

---

## 2. Methodology

- **Preregistration.** Each counted round has a `PREREG-*.md` committed before the first run. It fixes the hypotheses, primary measure, test, α, hidden-test SHA-256s, toolchain pins and run counts, and says "published as is, whatever the outcome."
  - Tests: Fisher's exact for rounds 2–4; one-sided permutation tests, Holm-corrected across a family, for rounds 5+ and 10–15; bootstrap 90% intervals for "no worse than" claims.
  - Every deviation is written up in the result (scratch-folder leaks, agents reaching the project thread's reply tools, a stray "Merge" message delivered into run contexts, container restarts, re-runs).
  - **Reversals are reported as plainly as wins**: rounds 7 and 8 are headlined "not supported, reversed."
- **Exploratory rounds are labelled.** cost-11-03, 9, 13, 14, the XState side check, the board probes and the PR #94 rerun all say "not preregistered" up front. PREREG-15 explains why: rounds 10–14 changed guide, Solid or grader between runs and used a tuned task, so round 15 was the one built to be publishable.
- **Every failure is traced and attributed** to the agent, the guide, a by-design hold, or a Solid bug. Solid bugs **count against .rx** (the user gets the bug either way). Each gets a plain-Solid repro in `repro/` and an upstream issue, and the result is recomputed without it as a secondary number.
- **Holds vs defects.** A consistent hold that settles isn't a defect; a tear, a flicker back, never settling, or a crash is. Hold probes (`trace/holds*.mjs`) replay a failing test and accept the expected screen or the exact pre-write screen, then require the settled screen to be right. Rulings like H-11, shared-list holds, "same field twice ends at the server's last answer" and "after the page was left is out of scope" are applied to every arm, and their exclusions are listed per desk.
- **Weak spots the program admits:**
  - isolation is by instruction (same machine, public hidden tests);
  - oracles encode the author's reading of the briefs;
  - base desks dominate the fuzz counts (138 apps ≠ 138 independent samples);
  - 3–6 runs per cell only detects large effects;
  - the outside review of PREREG-15 is still to come (waived pre-run);
  - probe changes in PR #94 are judgement calls made after seeing results.

---

## 3. How the evals fed back into the language

This is the most valuable output so far. Almost every round produced a rule, a check, a guide change or a Solid fix.

**Static checks (compile errors) traced to eval findings:**

| Rule / diagnostic | Origin |
|---|---|
| `STALE_WRITE_BACK` (AC-1e) | Round 4: Haiku's read-before-`await`, write-after lost updates. Over all 76 earlier .rx apps it fires on exactly the 2 defects plus 1 latent bug in a passing app. |
| `UNGUARDED_SNAPSHOT` (R-8), tightened 11-13 | Round 8 fuzz: 209 crashes from a handler reading `shown.some(…)` outside its `loading` region. Tightened after the desk9 reference's seed 11: a region covers a failure only if it reads the value, not just `pending?`. |
| `LOADING_ON_OUTSIDE_HOLD` (CN-3e) | Round 9: a count effect outside the list's `loading on(filter)` froze the list in 39 of 82 apps. |
| `GUESS_WHILE_LOADING` (AC-3a) | Round 12: flags 8 handlers in 5 apps, each confirmed in a browser, none in unflagged apps. It also caught the eval's own references and `examples/ai/feed.rx`. |
| `STALE_CAPTURE` (AC-1g) | Round 15 board: wrong-column and stale-card writes after an accept. The draft (pre-`await` reads only) was beaten in a probe by agents moving the read after the `await`, so the final rule covers any source read in an answer write. Fires on 9/12 round 15 board apps, each on the traced defect. |
| `SHADOWED_IMPORT` (MO-1d) | Round 4: a `source filter` hid the prelude's `filter`. |
| `CATCH_NOT_ON_AWAIT`, EF-2a, board oracle B5 | Board probes after round 15. |
| "Check passes, build fails" principle | Pilot: the checker must refuse what lowering can't do. |
| R-f-11 `FOREIGN_FAILURE`, **withdrawn** | Drafted from round 10, matched 1 program in 695. A useful record of a rule that eval data argued *against*. |

**Semantics and API:**

- `onFlush` (EF-8): the pilot's "async actions push agents back to sequence numbers" finding.
- `indexOf` in the prelude, and the per-row guess idiom: round 3.
- Inferred actions (AC-1b/c/d, PR #17).
- H-11 rulings, applied as by-design holds in every arm: chains, rounds 10 and 15.
- Guesses kept as entries per key (`ref/` runtime) after S-store-8.
- ST-4a (keys at any depth): from the board reference.
- `refresh` of a keyed equation actually re-asking: a runtime bug found by the desk9 reference.

**Guide:**

- The race/timing examples were scrubbed of the tasks' own code (round 2).
- `guide/reference.md`, one page of rules looked up by id: cost-11-03.
- §4 "refresh every question you guessed on".
- "three layers", then "lay every view over the answer".
- "data belongs with its lifetime", rewritten after it over-applied to settings.
- "one store over the server", then "one shape: guesses on the answer stores" (ledgers removed).
- "re-ask every list the row can be in".
- "don't skip a guess because `pending?` reads true in the handler".

The guide is now visibly shaped by the eval loop. That's both its strength and why round 15's held-out task mattered.

**Solid 2.0 itself.** The eval doubled as a fuzzer for Solid 2's async and optimistic core. Filed with plain-Solid repros, roughly in order: #4271 (DV-8), #4329, #4336/#4337, #4425, #4437, #4440, #4441, #4627, #4629, #4631, #4661, #4689 (DV-19), #4690, #4762, #4786, #4787, #4829/#4831, #4834/#4835, #4840, #4841, #4969–#4972, #4987, #4988, #4990, #4998, #4999, #5002, #5003, #5077, #5090, #5095, #5104, #5146, #5174. That's **~40 issues**, most fixed before 2.0.0/2.0.3. This is arguably the program's largest external effect so far.

---

## 4. What's in progress now

- **PR #94** (open, 11-23): the post-round-15 .rx rerun on Solid main 30e7805eb. Board Opus roughly halved (6.33 → 3.67); desk9 slipped a little. It waits on Ryan's call on the two widened hold probes. Haiku board is still ~19, against React's 3.0 and Foldkit's 2.83 in round 15.
- **Main since round 15:** AC-1g landed. The guide was rewritten to one server-data shape. The board oracle gained B5. Solid was re-pinned to main three times as the eval's repros got fixed (#5088, #5091, #5095, #5101, #5104, #5146).
- **Not yet started (by evidence in repo):**
  - a round 16 PREREG;
  - the outside review of PREREG-15;
  - a non-.rx rerun on the same day/build (PR #94 compares fresh .rx apps against round 15's other arms; the write-up doesn't flag that, and it should).
- **The other eval** (Dev's fork, see below) is active this week. It's a different feature, but it touches the same thesis: agents writing .rx at run time.

### The other eval: runtime `eval` (fork, `eval-demo` → `eval-todo`, `lsp-eval-snippets`)

- `docs/eval/RFC.md` (draft, unposted) proposes two site forms:
  - `{eval(code, { count, bump })}` in markup;
  - `label: string = eval(formula, { count }, { type: "string" })` for one value.
- Bindings are the code's whole scope and are read-only (O-4 at the boundary: writes only through bound actions). The interface is derived by the checker, refusals are typed (`UNBOUND`, `READ_ONLY`, …) and caught by `errored`, and a changed code string disposes and recreates like a keyed `Show`.
- **Motivation, stated:** generated UI. A model writes a widget against a typed interface, which is the AI thesis applied at run time instead of build time.
- **Prototype:** differential fuzz against native Solid rc.21, 0 divergences on 3,000 seeds (sync and async).
- `eval-todo` (6 commits ahead of `eval-demo`) is a Solid 2 page whose todo app, inventory admin and **self-editing code editor** are .rx strings evaluated live. Its `FINDINGS.md` is a sharp list of 20 gaps the plan-v2 subset forces:
  - no `if` in handlers, no `-`, no sort, no string comparison, no `includes`, no reduce;
  - no components, no spreads, and no action calling an action;
  - plus a Solid 2 point: plain writes in an action are held until it settles.
- `lsp-eval-snippets` (upstream-based, 4 commits, not pushed) teaches the language server `// @eval` + `// @bind` snippet files, released locally as 0.3.2-eval.0.
- A `pin-main` migration of the fork onto upstream main + Solid main (`optimistic` → `guess`) is in flight across three worktrees.
- Open decisions on the RFC:
  - scalar-only value eval;
  - where to post it;
  - state on swap.

---

## 5. Where it's logically heading

1. **From "fewer defects" to "fewer defects off the training set".** Round 15 showed the desk9 win partly reflects a guide tuned on desk9. The next credible claim needs more held-out tasks (board was one) and a guide frozen before seeing them. The pattern since round 15 is to fix the guide on board, which spends board's held-out status. A round 16 needs a fresh task.
2. **Teaching gaps → static checks.** The arc runs from guide advice to compile error: STALE_WRITE_BACK, UNGUARDED_SNAPSHOT, LOADING_ON_OUTSIDE_HOLD, GUESS_WHILE_LOADING, STALE_CAPTURE. Round 15's lesson ("the ledger shape is legal") points straight at the next one: refuse or warn on bookkeeping shapes the language is meant to replace. Several failures are explicitly "a check can't see this" (which lists to re-ask after a move). Those stay guide territory, or call for a new primitive.
3. **The real claim is the small-model floor.** Ryan's stated bar: .rx must at least equal React at frontier, and the small-model gap is the claim it may win. The evidence for that: desk9 Haiku 1.5 vs 9.0 in round 15, and rounds 10–11 supported. The evidence against: board Haiku 25 vs 3. The next rounds have to show the floor holds on unfamiliar shapes.
4. **Cost has converged and is no longer the question.** Opus .rx cost is about React's on desk9. The remaining gap is turns spent looking up semantics. reference.md, inline docs and LSP diagnostics are the levers, not shorter code.
5. **Runtime correctness is the dependency.** Every round found Solid bugs. With Solid 2.0 released and the repros mostly fixed, results are becoming about agents and the guide rather than the runtime. That makes a clean, released-build round more meaningful than any so far.
6. **Generated code at run time.** The fork's `eval` work extends the thesis from "agents write .rx files" to "agents emit checked .rx into a live app." If it goes upstream, it needs its own eval: can a model write a widget against a bound interface that the checker accepts the first time?

---

## Open threads

- PR #94 is open: Ryan has to rule on the widened `holds9.mjs`/`holds.mjs` re-ask answering and the new `holds-board-reopen.mjs`. Both were changed after seeing results.
- PR #94 compares fresh .rx apps against round 15's other arms, run on a different build and day. A same-day rerun of React/Foldkit/plain on board would make the comparison fair.
- The outside review of PREREG-15 was promised "after", and it hasn't happened in the repo.
- Board is no longer held out: the guide, the oracle (B5) and the checks were tuned on it after round 15. Round 16 needs a new unseen task, and probably two.
- The board Haiku gap (19–25 vs React 3) is unexplained beyond "two mostly broken apps", and it isn't traced at the depth Opus was.
- Is there a static check for "ledger" or bookkeeping shapes, or for "re-ask every list the row can be in"? The board write-up says possibly. AC-1g covered one slice.
- Rounds 5, 7, 10 and 11 can't be regraded (sources not committed). Commit run sources for every future round.
- Isolation is by instruction. A published round should use containers, and hidden tests outside the public repo.
- Haiku agents in PR #94 each posted a stray chat message with a tool they were told not to use. Remove those tools from the harness rather than relying on instruction.
- The cost methodology has a cache-state artifact (round 5b). `cost-warm.mjs` handles it post hoc; future preregs should name it.
- The `eval` naming collision: the RFC should probably not be called "eval" alongside `eval/` in the same repo, or the benchmark dir should be renamed.
- Runtime eval RFC: unposted. Its decisions are open (scalar vs structured value eval, where to post, `preserve` on swap), and the plan-v2 subset gaps in `FINDINGS.md` need resolving before it can host real generated UI.
- `examples/ai`/`ai2` frame prediction hasn't been repeated since October, on the current spec and guide. It's a cheap check worth re-running per release.
