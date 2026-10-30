# Round 5b: does the guide close the cost gap?

Pre-registration, fixed and committed before the round's first run. An addendum to `PREREG-cost.md` (round 5);
everything there holds unless this file changes it.

## Why

In round 5 (`results/cost-2026-10-29`) a change cost 30% more in .rx than in React (131k vs 101k billed units per
run), level with Solid 2 TSX (135k). Output tokens were equal; the gap was turns (9.7 vs 7.1 model calls). 16 of 18
.rx runs searched `docs/spec/` for semantics the inline guide didn't give, listed from the transcripts:

- count (6 of 6 runs): when an `effect` runs: under a guess, while its input loads, after a failure (spec 02 EF-2,
  04 R-2, 05).
- labels (3 of 6): whether guesses of two actions revert apart (05 H-7, H-11; 06 AC-3).
- related (1 of 6): `peek` (02).

The guide covered the second and third already. It said nothing on the first beyond "runs after `count` changes".

## Change

One change between round 5 and 5b: `guide/async.md` gains section 6, "Effects: acting on a value as it changes"
(when an effect runs, loading and failing inputs, guesses, lifetime, order), and `guide/language.md`'s effect line
points to it. About 400 extra tokens in the prompt. The section states language rules; it has no task code and
names no task's elements. Everything else is round 5's: bases, briefs, tests (same SHA-256 as listed there),
prompt template, toolchain (Solid next 5e68925c), checker, model at default effort, the one-line start pointing to
`.prompt`.

## Runs

The .rx arm only: 3 tasks × 6 = 18 runs, `/home/claude/runs/r5b/<task>-rx-<n>`, scaffolded as in round 5
(`scaffold.mjs <task> rx <dir> --brief plain --base reference/desk/rx --inline-docs`), launched by task as in round
5. React and Solid are not rerun: their prompts and docs did not change.

## Hypotheses and tests

- **H1b** (primary): the change costs less in .rx (5b) than in React (round 5's 18 runs). One-sided permutation test
  on the difference of means, 100,000 relabellings, seed 5, α = 0.05 (`harness/cost.mjs` over a list of round 5's
  React runs and 5b's .rx runs).
- **H3** (secondary): .rx 5b costs less than .rx 5, same test. This is the guide's effect.
- Reported alongside: Solid − .rx 5b; per task cost and calls; doc lookups per run (tool calls that open
  `docs/`); defects as in round 5, with #4425's test outside the count.

## Limits

- Not concurrent with the baseline: the React and Solid runs are from earlier the same day. Same model, effort,
  toolchain and harness; serving-side drift can't be ruled out.
- The guide section was written after seeing what round 5's agents looked up, so it answers questions these tasks
  raise. It answers them as rules of the language, the way any user-facing guide would; whether it is "tuned" is
  for the reader to judge from the diff. A win here says how much documenting semantics is worth, not that .rx is
  cheaper by itself.
- Published as is, whatever the outcome.
