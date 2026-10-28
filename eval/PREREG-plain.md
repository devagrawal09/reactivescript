# Round 2: briefs that don't name the races

Pre-registration. Everything in this file was fixed and committed before the round's first agent run.

## Why this round

In the pilot (`results/pilot-2026-10-27/`), no arm shipped a defect. The briefs said "answers can arrive in any
order" and "only the answer for the current query may ever show", so the agent knew which races to guard, and it
guarded them in React as well. This round asks the question the pilot couldn't: **when the brief only describes the
screens, does the agent ship a race in React that it doesn't ship in .rx?**

## What changes from the pilot

- **Briefs**: `tasks/<task>/brief-plain.md`. Each one keeps every screen, text and test id of `brief.md` and drops
  every sentence about timing or staleness: "answers take an unknown time and can arrive in any order", "only the
  answer for the current … may ever show", "nothing from the previously selected …", "edits the user makes while a
  save is in flight stay in the form", "a failure in the list never changes the detail". What is left says what each
  screen shows given what the user did and what the server answered. Example: "Two characters or more: call
  `search(q)` and show `searching…` until the results arrive."
- **Prompt**: the line about `./test` no longer says the tests control the fake backend's answers, and the agent's
  copy of `src/flights.js` loses its header comment (which says tests decide the order answers arrive in). The code
  itself is unchanged. `node harness/scaffold.mjs <task> <arm> <dir> --brief plain` writes all of this, prompt
  included (`<dir>/.prompt`).
- **The .rx guide's examples** no longer use the tasks' own code: `guide/async.md` showed the search equation and
  the settings save action verbatim. They are now a forecast lookup and a profile save, with the same idioms (both
  pass `rxc check`). The guide still explains the language's model in general (a stale answer is thrown away, an
  action is one change). That is documentation of .rx, the same way the React agent knows React's from training.
- **Two models**: the session's frontier model, and a small model (Haiku), launched as subagents with no memory of
  each other.

## What does not change

- Hidden tests, byte for byte (SHA-256 as frozen for the pilot):
  ```
  1d77a1daa81d15d40045d1f4665f9fdcebbe9abb6356db5b3a6eb8b29d30d0ae  tasks/search/hidden.mjs
  c02e80f9b64e44dd843b601713ddc67553a5f85835e36ee5d13c35fb4121d09e  tasks/tracker/hidden.mjs
  58d2a1daa4a1b8d2ea559ab56bb37ee9193dcf3d31d03e362107e25ee3b106b6  tasks/settings/hidden.mjs
  ```
  Each hidden test checks something the plain brief states: a stale answer on screen contradicts "the results for
  the query" or "the selected issue", a reset draft contradicts "saving never changes the draft". No hidden test
  needs a sentence that the plain brief dropped. Both references pass every visible and hidden test when scaffolded
  with `--brief plain`.
- Visible tests, arms, toolchain (Solid rc.19, React 19.2, TanStack Query 5), the 15-command budget, scoring
  (`harness/score.mjs`), and the DV-8 rule (a .rx failure due only to `key` on a projection is a runtime bug, not an
  agent defect).

## Runs

3 tasks × 2 arms × 2 models × 3 runs = **36 runs**, each a fresh agent in its own directory. A run that ends
without the agent declaring done (a crash or a tool error, not a wrong app) is run again; every such rerun is
reported.

## Hypothesis and test

- **H1**: the React arm ships more defects than the .rx arm.
- **Primary measure**: defects shipped, as in the pilot: runs where, at the agent's "done", the build fails or any
  visible or hidden test fails. One number per arm, pooled over tasks and models (18 runs each).
- **Primary test**: Fisher's exact test, two-sided, on that 2×2 table, at α = 0.05. H1 holds if the React rate is
  higher and p < 0.05. `node harness/compare.mjs <runs-dir>...` computes it from `score.mjs`'s output.
- **Reported alongside, not tested**: the same table for each model and each task; hidden tests failed per run;
  `./check`+`./test` cycles; app lines; tokens; each failed hidden test, classified by hand (stale answer, lost
  rollback, draft reset, stuck state, wrong text, build failure).
- **Whatever the outcome, it is published as is**, including a null result or a result for React.

## Known limits

- Isolation is still by instruction (agents share a machine with this repo).
- Hidden tests were written for the pilot's briefs. This makes them conservative here (they test only what both
  briefs say), not tuned to this round.
- 18 runs per arm detects a large effect only. A pooled split like 9/18 vs 2/18 reaches p < 0.05; 6/18 vs 2/18 does
  not. A null result here means "no large effect on these three apps", not "no effect".
- .rx failures that are a compiler or runtime bug, not the agent's, are counted as defects in the primary measure
  (a user would get the bug either way) and listed separately.
