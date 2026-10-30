# Round 7: maintenance chains

Pre-registration, fixed and committed before the round's first run. Builds on `PREREG-cost.md` (round 5),
`PREREG-cost-5b.md` and `PREREG-cost-6.md`; everything there holds unless this file changes it.

## Why

Rounds 1 to 6 gave each agent one change to a clean app. Frontier agents wrote the guards a race needs by hand (request
numbers, guess lists, a page id) and shipped few defects in any arm, so .rx's guarantee (a stale answer cannot
overwrite a newer one; a guess holds until its write is answered) did not show. Ryan (2026-10-29): "the agents work
around the foot guns anyway. So the benefit here isn't really being shown ... let's do the maintenance tests."

The claim tested here: hand-written guards decay when the app is changed again and again by agents who did not write
them, while in .rx there are no guards to decay. Each chain is four changes in a row, each made by a fresh agent to the
app the previous agent left, with the test suite growing as it would in a real project.

## Chains

- **Steps** (`tasks/chain1` … `chain4`, written by `harness/make-chain.mjs`): 1 labels, 2 open-issue count,
  3 related help (the round 5 tasks, unchanged), 4 row actions (new: `tasks/rows`, assign and close from a list row,
  with a row error; it touches the guards of the desk's assign and close and the count's).
- **Step k's run** starts from step k−1's run's `src/` (step 1 from `reference/desk/<arm>`), whatever state it was
  left in. `BRIEF.md` is step k's change brief; `BASE.md` is the desk brief plus the earlier steps' change briefs, in
  order. The visible tests are every step's so far (22, 24, 26, 30); the hidden and overlap tests are every step's so
  far (58+26, 64+29, 70+32, 77+38), so an earlier step's hidden tests become regression tests.
- **Arms**: React and .rx, as in round 5b (React plain; .rx with the guide's two pages inline, `--inline-docs`). Same
  prompt template, model and effort as rounds 5 to 6. Solid and Foldkit are not run.
- **6 chains per arm**, `chain<k>-<arm>-<n>`, n = 1..6, in `/home/claude/runs/r7`. 48 runs.
- **Batches**: each step's 12 runs (both arms) launch together, after every run of the step before has finished, so
  both arms start each step in the same prompt-cache state.
- **References**: `reference/chain1..4/{react,rx}`, merged from the round 5 references plus row actions, pass every
  visible, hidden and overlap test of every step (the .rx ones fail only the #4425 test, which stays alongside, as in
  round 5).

## Measures

- **Defect at a step**: the run fails a visible, hidden or overlap test of its step (the #4425 test outside the count),
  or does not build. Scored per run with `harness/score.mjs --overlap`.
- **New defect at a step**: a test that the previous step's app passed (or that is new at this step) fails. A test
  already failing in the base is inherited, not new.
- **Regression**: a new defect in a test of an earlier step (the step's change broke something the agent was not
  asked to touch).
- **Cost**: billed cost without each run's first call (`harness/cost-warm.mjs`), summed per chain.

## Hypotheses and tests

- **H7a** (primary): React chains end with a defect more often than .rx chains: chains whose step 4 app has a defect,
  Fisher's exact test, one-sided, α = 0.05. With 6 chains per arm only a large gap can reach significance (e.g. 5 of 6
  against 0 of 6: p = 0.008; 4 of 6 against 0 of 6: p = 0.03; 3 of 6 against 0 of 6: p = 0.09).
- **H7b** (secondary): React runs have more new defects than .rx runs over all 24 runs per arm: Fisher's exact test on
  runs with at least one new defect, one-sided.
- **H7c** (secondary): React runs have more regressions: same test on runs with at least one regression.
- Reported alongside: cost per chain and per step (one-sided permutation tests both ways, 100,000 relabellings, seed
  5); per step defects; which guards decayed (read from the failing tests and the diffs).

The direction is stated from the claim being tested, not from a prior that it holds: in rounds 2 to 5 React shipped
as few defects as .rx. A null or reversed result is reported as plainly.

## Limits

- Six chains per arm: power is low for anything but a large gap.
- The step order is fixed (labels, count, related, rows); row actions come last because they reuse the most guards.
- Inherited defects make later steps' bases differ between chains; the per-step "new defect" measure is there for that.
- Published as is, whatever the outcome.
