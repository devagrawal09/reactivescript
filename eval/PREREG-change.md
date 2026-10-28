# Round 4: changing an existing app

Pre-registration. Everything in this file was fixed and committed before the round's first agent run.

## Why this round

Rounds 2 and 3 (`results/plain-2026-10-27/`, `results/overlap-2026-10-27/`) had agents write small apps from
scratch. Neither found a defect gap. This round asks the other half of Ryan's question: does an agent keep an app
correct when it **changes** one it did not write, where the new feature adds writes that overlap the app's existing
ones?

## Design

- **Bases**: round 3's frontier-model tracker apps, `results/overlap-2026-10-27/runs/big/tracker-<arm>-<n>`. Run n of
  each task and arm starts from base n of that arm, for both models. On Solid next @ ac28157a every base passes all
  of the tracker's visible, hidden and hidden-overlap tests.
- **Tasks** (`tasks/<task>/brief-plain.md`, the change; `BASE.md`, the tracker's plain brief, which the app must keep
  meeting). None names a race.
  - rename: rename the selected issue (`renameIssue`), shown in the list and the detail straight away.
  - close: close an issue (`closeIssue`); it leaves the list straight away and comes back if declined.
  - comments: load the selected issue's comments (`fetchComments`) and post one (`addComment`), shown straight away
    with `(sending…)`.
- **Tests**: per task `visible.mjs` (the tracker's 4 plus 2 new), `hidden.mjs` (new tests plus the tracker's hidden
  tests as regressions) and `hidden-overlap.mjs` (new overlap tests plus the tracker's overlap tests). rename 16 + 7,
  close 15 + 6, comments 17 + 6 hidden and overlap tests.
- **Prompt**: `harness/prompt-change.md`. Each run keeps scratch files in its own `.scratch` folder (round 3's leak).
- **Toolchain**: Solid next @ ac28157a (2.0.0-rc.19 plus the #4329 fix, solidjs/solid#4330) in both arms, through
  `eval/package.json`. The .rx compiler and runtime from this branch: MO-1d `SHADOWED_IMPORT` (taken by default
  2026-10-27), and `refresh` re-asking the question under a whole-value guess (`ref/compile/rt-web.ts`). The .rx
  arm gets `docs/spec` and `docs/guide/async.md` as in round 3, unchanged.
- 3 tasks × 2 arms × 2 models (frontier, Haiku) × 3 runs = 36 fresh runs, 15 `./check` + `./test` each.

Hidden test files, SHA-256 at freezing:

```
869e02eceb679c5907a67571a26f061157eefd86e8e38a1a7aec8db7d9e65fc0  tasks/rename/hidden.mjs
532e2caf837f3effaf77c5979af2651ed4d0ec2973b496d76846035d45831403  tasks/rename/hidden-overlap.mjs
86aebac10d51c9244504e5da3b368c356e6b8c65dfab5d9dbc35b03adb66604d  tasks/close/hidden.mjs
669c606395e539e031ca7f376304a42607d15ffccb823b291b5d616f30ddce42  tasks/close/hidden-overlap.mjs
25d241a2309310943ed24d72d26c2a7e638a6feecbd3397b39123ebf5e956dab  tasks/comments/hidden.mjs
3d95d4274efea4cd7d793140d2daab3f6b087bcd22c6b4ff7e5a8492d4d361ec  tasks/comments/hidden-overlap.mjs
c02e80f9b64e44dd843b601713ddc67553a5f85835e36ee5d13c35fb4121d09e  tasks/tracker/hidden.mjs
5d3e09edb9f0c2845aba82fc43b9689c8fe1066167fefa2dd04cbb93f4711b3e  tasks/tracker/hidden-overlap.mjs
```

**References** (`reference/<task>/<arm>`, not subjects) were written on the bases. Both arms pass every test, except
the .rx comments reference on "a post on one issue does not show on another" (below).

**Tests loosened while writing the references** (before freezing). By H-11 two guesses on one slot from two actions
are one change, so a declined guess can stay on screen until the other action settles. Ryan (2026-10-28): that is the
desired behaviour. Four tests were changed to accept it: close's "a declined close keeps an assignment…", "a declined
assignment keeps a close…", "two closes at once: a declined one does not undo the other", and comments' "two posts at
once: a declined one does not take the other with it". Each still checks the end state after both settle.

## Hypothesis and test

- **H1**: the React arm ships more defects than the .rx arm.
- **Primary measure**: defects shipped: a failed build or any failed visible, hidden or hidden-overlap test at the
  agent's "done" (`node harness/score.mjs <dir> --overlap`), except the one test below. One number per arm, pooled
  over tasks and models (18 runs each).
- **Primary test**: Fisher's exact test, two-sided, α = 0.05 (`node harness/compare.mjs`). H1 holds if the React
  rate is higher and p < 0.05. **H1 reversed** is reported as plainly.
- **Outside the count, reported alongside**: comments' "a post on one issue does not show on another". The .rx
  idiom for it (a whole-value guess on the comments source) shows solidjs/solid#4336 (filed 2026-10-28): the guess
  stays on screen after the selected issue changes, until the post settles. `score.mjs` runs it and lists it per run
  under `failedAlongside`, for both arms, and does not count it.
- **Other runtime bugs** found during the round count as defects, as in rounds 2 and 3, and are listed separately
  with the primary result recomputed without them.
- **Reported alongside**: the same table per model and per task; base regressions (tracker tests failed) apart from
  new-feature failures; each failure classified by hand; agent tokens and cycles.
- Published as is, whatever the outcome.

## Known limits

- Isolation is still by instruction.
- The bases are frontier-model apps; the small model changes code it would not have written.
- The new tests were written after round 3's results were known, and tuned on the references.
- 18 runs per arm detects a large effect only.
