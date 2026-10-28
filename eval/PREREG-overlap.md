# Round 3: overlapping writes

Pre-registration. Everything in this file was fixed and committed before the round's first agent run.

## Why this round

Round 2 (`results/plain-2026-10-27/`) found no defect gap: with briefs that don't name the races, React shipped 0
of 18 defects and .rx 1 of 18. Current models guard a single stale answer in React unprompted. What the agents
reported as unsure, and what no hidden test probed, was **overlapping writes**: two writes in flight at once, and a
write racing a re-load of the data it changed. Exploratory probes on round 2's finished apps (`probes/`, not a
test of anything) showed failures there on both sides. This round tests that question on fresh runs.

## What changes from round 2

- **Hidden tests**: each task gets `tasks/<task>/hidden-overlap.mjs`, run in addition to the unchanged
  `hidden.mjs`. Each test checks something the plain brief already states, in a case where two things are in
  flight:
  - search (1): a retry's answer landing after another selection must not show. The brief says the pane shows the
    selected hit's item.
  - tracker (2): two issues assigned at once, one declined; and the list loading while an assignment is out. The
    brief says a declined row "goes back to the assignee it had before" and that the row shows the new assignee
    "straight away" and "keeps" it if the server accepts.
  - settings (3): an earlier save failing after a later one succeeded; a later save failing while an earlier one is
    out; an earlier save landing while a later one is out. The brief says the saved line shows the values being
    saved with `(saving…)`, the saved settings when a save succeeds, and goes back and shows `save-error` when it
    fails.
- **The .rx guide** teaches guessing one row of a list (`optimistic xs[i].field := v`, with `indexOf` to find the
  row) instead of the whole list. A whole-list guess makes two actions one change (H-11). The example is a generic
  todo list, not a task's code. **The prelude** gains `indexOf(xs, f)` (Ryan, 2026-10-27), and the .rx prompt's
  prelude list names it.
- Everything else is as in round 2: plain briefs, prompt, visible tests, toolchain, budget, 3 tasks × 2 arms ×
  2 models (frontier, Haiku) × 3 runs = 36 fresh runs.

Hidden test files, SHA-256 at freezing:

```
5776f8888055c4f5c13261b8637e048ebbb4f919602afb6f294a78ae4339b4d2  tasks/search/hidden-overlap.mjs
5d3e09edb9f0c2845aba82fc43b9689c8fe1066167fefa2dd04cbb93f4711b3e  tasks/tracker/hidden-overlap.mjs
aa1d42209d188ea4c54220c816d0ffe718e7ebe65c2d9b9d3fbf5fa23949aade  tasks/settings/hidden-overlap.mjs
1d77a1daa81d15d40045d1f4665f9fdcebbe9abb6356db5b3a6eb8b29d30d0ae  tasks/search/hidden.mjs
c02e80f9b64e44dd843b601713ddc67553a5f85835e36ee5d13c35fb4121d09e  tasks/tracker/hidden.mjs
58d2a1daa4a1b8d2ea559ab56bb37ee9193dcf3d31d03e362107e25ee3b106b6  tasks/settings/hidden.mjs
```

The references are not subjects, and neither passes everything: both fail some overlap tests (`reference/` is
unchanged from the pilot). The tests were checked to run and to fail for a stated reason, not to be passable by the
references.

## Hypothesis and test

- **H1**: the React arm ships more defects than the .rx arm.
- **Primary measure**: defects shipped, where a defect is a failed build or any failed visible, hidden or
  hidden-overlap test at the agent's "done" (`node harness/score.mjs <dir> --overlap`). One number per arm, pooled
  over tasks and models (18 runs each).
- **Primary test**: Fisher's exact test, two-sided, α = 0.05 (`node harness/compare.mjs`). H1 holds if the React rate
  is higher and p < 0.05. **H1 reversed** (the .rx rate higher, p < 0.05) is reported as plainly.
- **Reported alongside**: the same table per model and per task; overlap tests failed per run; each failure
  classified by hand (stale answer, lost rollback, wrong revert, error lost, runtime bug, build failure).
- **Runtime bugs**: solidjs/solid#4329 (a per-key guess dropped when a re-ask lands mid-action) is live in rc.19 and
  touches the tracker's "list loading while an assignment is out" test for a .rx app that guesses per row. As in
  round 2, such a failure counts as a defect in the primary measure (the user gets the bug either way) and is
  listed separately with the primary result recomputed without it.
- Published as is, whatever the outcome.

## Known limits

- Isolation is still by instruction.
- The overlap tests were chosen after the exploratory probes had been run on round 2's apps. They run here only on
  fresh runs, and four of the six are the probes as they were run.
- 18 runs per arm detects a large effect only (round 2's PREREG gives the arithmetic).
