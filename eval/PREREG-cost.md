# Round 5: what a change costs

Draft pre-registration. It is frozen (hidden test hashes, toolchain pin) in the commit before the round's first
counted run.

## Why this round

Rounds 2 to 4 measured defects and found no gap that holds up (`results/`). Ryan's question for this round is cost:
does an agent spend fewer tokens changing an app written in .rx than the same app written in React? In round 4 it
spent more (billed cost about 1.5× React's), mostly on reading the .rx docs from disk and on failed checks. A 9-run
pilot with the docs in the prompt (`scaffold --inline-docs`, `guide/language.md` + `guide/async.md`) cost about 9%
less than React (81k vs 89k billed units, p = 0.13 one-sided, not pre-registered). Those apps were small (one file,
about 100 lines), so most of the cost was the fixed prompt; this round's base app is bigger, which is where .rx's
smaller source should count.

## Design

- **Base**: the issue desk, `reference/desk/<arm>` (brief `tasks/desk/brief-plain.md`, given to the agent as
  `BASE.md`): three pages behind tabs (issues with assign, rename, close and comments; help search; settings), the
  six earlier tasks in one app. .rx 315 lines in 6 files, Solid 2 TSX 419 lines in 6 files, React 570 lines in 9
  files. All three pass the desk's 90 tests on the round's toolchain.
- **Arms**: .rx; React 19 + TypeScript (TanStack Query available); Solid 2 TSX (added 2026-10-28, Ryan), which asks
  whether a .rx difference is the language's or Solid's: Nolan Lawson's benchmark found SolidStart no cheaper than
  React. The Solid base follows the .rx base's design (same stores, actions and boundaries), written as a Solid 2
  author would.
- **Tasks** (`tasks/<task>/brief-plain.md`; none names a race):
  - labels: add and remove the selected issue's labels (`fetchLabels`, `addLabel`, `removeLabel`), straight away,
    reverted if declined. A feature inside one page.
  - related: the selected issue's related help (`search` on its title); clicking one opens the help page on it. A
    change across pages.
  - count: the open-issue count on the issues tab, live through closes, kept on other pages. State lifted out of a
    page.
- **Tests**: per task `visible.mjs` (the desk's 19 plus 2 or 3 new), `hidden.mjs` (the desk's hidden tests as
  regressions plus 6 to 8 new) and `hidden-overlap.mjs` (the desk's overlap tests plus 3 to 5 new). References
  (`reference/<task>/<arm>`, not subjects) pass all of them in all three arms.
- **Prompt**: `harness/prompt-change.md`, with `--inline-docs`: the .rx arm gets `guide/language.md` and
  `guide/async.md` (about 3k tokens) at the end of its prompt; the Solid arm gets Solid's own agent primer,
  `solid-js/skills/solid-2.0/SKILL.md` (about 2.4k tokens), with the full cheatsheet and skills readable in
  `node_modules/solid-js`; React gets nothing (it needs nothing). Checkers: `rxc check`; tsc strict plus ESLint
  react-hooks for React; tsc strict for Solid (eslint-plugin-solid has no Solid 2 config on npm yet). Each run keeps scratch files in its own
  `.scratch` folder and uses no messaging tools.
- **Model**: the frontier model only, at the agent harness's default effort; the model id and effort are recorded with
  the results (cost is the question; round 4's small-model runs add variance, not an answer).
- **Runs**: 3 tasks × 3 arms × 6 runs = 54. Run k of a task starts from the same base in its arm.
- **Toolchain**: Solid next at the pin in `ref/SOLID_NEXT` at freezing (must include the solidjs/solid#4379 fix: on
  6b792a9 the .rx and Solid bases fail one desk test, "a list that loads while an assignment is out keeps the new
  assignee").

## Hypothesis and test

- **H1**: changing the desk costs less in .rx than in React.
- **H2** (secondary): changing the desk costs less in .rx than in Solid 2 TSX.
- **Primary measure**: billed cost per run, from the run's transcript (`node harness/cost.mjs <agents.txt> <dir>`):
  input × 1 + cache write × 1.25 + cache read × 0.1 + output × 5, in uncached-input-token units (the API's price
  ratios), over all of the run's model calls. One number per run, pooled over tasks (18 runs per arm).
- **Primary test**: one-sided permutation test on the difference of means (React − .rx), 100,000 relabellings,
  α = 0.05. H1 holds if .rx's mean is lower and p < 0.05. A higher .rx mean is reported as plainly. H2 is tested the
  same way (Solid − .rx) and reported as secondary, with React − Solid beside it, descriptive only.
- **Power**: the pilot's per-run sd was 6.8k (React) and 18.2k (.rx), on means near 85k; with 18 runs per arm the
  test has about 80% power for a difference of 14%. A smaller true difference can be missed.
- **Secondary, reported alongside**:
  - defects shipped (round 4's measure: build, visible, hidden and overlap tests at "done"), per arm, Fisher's exact
    test two-sided; cost per run that shipped no defect;
  - per task: cost, model calls, output tokens, `./check` and `./test` cycles;
  - the cost split: the fixed prompt (system, tools, brief, and for .rx the inline docs), reading the app, and the
    agent's own work (output and the turns it takes);
  - wall-clock time per run;
  - medians beside the means (a run that wanders off moves a mean, not a median), and the cost in API dollars at the
    prices of the day, as Claude Code reports it, so the numbers compare with other published framework cost
    benchmarks (Nolan Lawson, "The AI cost of JavaScript frameworks", 2026-10-28, which builds an app from scratch
    in 12 setups; this round changes an existing one).
- Published as is, whatever the outcome.

## Known limits

- The bases and tasks were written by the person who wrote the .rx references and the language; the briefs and tests
  are the same for both arms, but the bases are not agent-written.
- Isolation is by instruction (prompt), checked afterwards in the transcripts.
- The .rx and Solid arms carry docs in the prompt (about 3k and 2.4k tokens) and React carries none: that is the real
  cost of something newer than the model's training and stays in the measure. The Solid arm's docs are Solid's own,
  unedited, so they are not tuned to these tasks; the .rx guide was written during these rounds (without task code).
- Prices are ratios at the time of the round; a different cache price changes the weights, so raw token counts are
  published per run too.
