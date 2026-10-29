# Round 6: what a change costs in Foldkit

Pre-registration, fixed and committed before the round's first run. An addendum to `PREREG-cost.md` (round 5) and
`PREREG-cost-5b.md`; everything there holds unless this file changes it.

## Why

Ryan (2026-10-29) asked whether Foldkit shows the same effect. Foldkit (foldkit.dev) is The Elm Architecture in
TypeScript on Effect: one Model, messages, a pure update, side effects as Commands. Its pitch includes AI-assisted
development: every change follows the same visible structure. It is also newer than the model's training, like .rx
and Solid 2, but asks for much more code per feature. Round 5 found that cost follows turns spent on semantics the
agent is unsure of, not source size. Foldkit tests the other side: a framework with explicit, conventional
structure and no reactive timing to look up, at about twice React's code.

## Arm

- **Foldkit** 0.170.0 with effect 4.1.0 and @effect/platform-browser 4.1.0 (`eval/package.json`).
- **Bases** (`reference/desk/foldkit`, `reference/{labels,related,count}/foldkit`): written for this round by the
  same author as the other arms, following Foldkit's `FOLDKIT.md`: a root `main.ts` with a page union and
  Submodel views, one module per page (`issues.ts`, `help.ts`, `settings.ts`), Commands per API call, request
  sequence numbers to drop stale answers, a `pageId` on page messages to drop a discarded page's answers. Desk
  1,147 lines / 42 KB (React 570 / 20 KB, Solid 419 / 15 KB, .rx 315 / 11 KB). Every Foldkit reference passes every
  visible, hidden and overlap test of its task, including the #4425 test that the .rx and Solid references fail.
- **Docs**: Foldkit's own agent conventions file, `FOLDKIT.md` from `create-foldkit-app` at the release tag (about
  5k tokens), at the end of the prompt (as the Solid arm gets Solid's primer). The Foldkit repository at tag
  `foldkit@0.170.0` (examples, skills, `AGENTS.md`, the framework source) is readable in the run's `docs/foldkit`,
  which is what `FOLDKIT.md` tells agents to vendor.
- **Checker**: `tsc --noEmit` with Foldkit's template `tsconfig` (strict, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`). Foldkit's lint (oxlint with its plugin and effect-tsgo) is not published on npm,
  so the arm has none; React and Solid have ESLint.
- **Build**: the harness boots `src/main.ts`'s `Model`, `init`, `update`, `view` with `Runtime.makeApplication` and
  `Runtime.run`, as Foldkit's `entry.ts` does.

## Runs

3 tasks × 6 = 18 Foldkit runs, `/home/claude/runs/r6/<task>-foldkit-<n>`, scaffolded with
`scaffold.mjs <task> foldkit <dir> --brief plain --base reference/desk/foldkit --inline-docs`, launched together.
Same tasks, briefs, hidden tests (SHA-256 unchanged), prompt template, model and effort as rounds 5 and 5b. React,
Solid and .rx are not rerun.

## Measure

Round 5b found that a run's first call (the same text in every run: system prompt, tools, the one-line start) is
priced by the prompt cache's state when the batch starts, not by the arm. This round's primary measure is therefore
**billed cost without the first call** (`harness/cost-warm.mjs`), compared with round 5's React and Solid runs and
5b's .rx runs on the same measure. Raw billed cost is reported beside it.

## Hypotheses and tests

- **H6a** (primary): a change costs more in Foldkit than in React. One-sided permutation test (Foldkit − React),
  100,000 relabellings, seed 5, α = 0.05.
- **H6b** (secondary): a change costs more in Foldkit than in .rx (5b). Same test.
- Reported alongside: Foldkit − Solid; per task cost, model calls, output tokens, doc lookups (`docs/` reads);
  defects as in round 5 (the #4425 test stays outside the count; Foldkit's reference passes it).

The direction is stated in advance from the author's prior (Foldkit: more code to write per change, and unfamiliar).
A Foldkit mean at or below React's is reported as plainly.

## Limits

- Not concurrent with the baselines (rounds 5 and 5b ran earlier the same day); same model, effort, toolchain.
- The Foldkit bases were written by someone who had not used Foldkit before this round, from its docs and examples;
  an experienced Foldkit author might write them shorter.
- No lint in the Foldkit arm (above).
- Published as is, whatever the outcome.
