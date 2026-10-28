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
  six earlier tasks in one app. .rx 315 lines in 6 files, React 570 lines in 9 files. Both pass the desk's 90 tests on
  the round's toolchain.
- **Tasks** (`tasks/<task>/brief-plain.md`; none names a race):
  - labels: add and remove the selected issue's labels (`fetchLabels`, `addLabel`, `removeLabel`), straight away,
    reverted if declined. A feature inside one page.
  - related: the selected issue's related help (`search` on its title); clicking one opens the help page on it. A
    change across pages.
  - count: the open-issue count on the issues tab, live through closes, kept on other pages. State lifted out of a
    page.
- **Tests**: per task `visible.mjs` (the desk's 19 plus 2 or 3 new), `hidden.mjs` (the desk's hidden tests as
  regressions plus 6 to 8 new) and `hidden-overlap.mjs` (the desk's overlap tests plus 3 to 5 new). References
  (`reference/<task>/<arm>`, not subjects) pass all of them in both arms.
- **Prompt**: `harness/prompt-change.md`; the .rx arm with `--inline-docs`. Each run keeps scratch files in its own
  `.scratch` folder and uses no messaging tools.
- **Model**: the frontier model only (cost is the question; round 4's small-model runs add variance, not an answer).
- **Runs**: 3 tasks × 2 arms × 6 runs = 36. Run k of a task starts from the same base in its arm.
- **Toolchain**: Solid next at the pin in `ref/SOLID_NEXT` at freezing (must include the solidjs/solid#4379 fix: on
  6b792a9 the .rx base fails one desk test, "a list that loads while an assignment is out keeps the new assignee").

## Hypothesis and test

- **H1**: changing the desk costs less in .rx than in React.
- **Primary measure**: billed cost per run, from the run's transcript (`node harness/cost.mjs <agents.txt> <dir>`):
  input × 1 + cache write × 1.25 + cache read × 0.1 + output × 5, in uncached-input-token units (the API's price
  ratios), over all of the run's model calls. One number per run, pooled over tasks (18 runs per arm).
- **Primary test**: one-sided permutation test on the difference of means (React − .rx), 100,000 relabellings,
  α = 0.05. H1 holds if .rx's mean is lower and p < 0.05. A higher .rx mean is reported as plainly.
- **Power**: the pilot's per-run sd was 6.8k (React) and 18.2k (.rx), on means near 85k; with 18 runs per arm the
  test has about 80% power for a difference of 14%. A smaller true difference can be missed.
- **Secondary, reported alongside**:
  - defects shipped (round 4's measure: build, visible, hidden and overlap tests at "done"), per arm, Fisher's exact
    test two-sided; cost per run that shipped no defect;
  - per task: cost, model calls, output tokens, `./check` and `./test` cycles;
  - the cost split: the fixed prompt (system, tools, brief, and for .rx the inline docs), reading the app, and the
    agent's own work (output and the turns it takes);
  - wall-clock time per run.
- Published as is, whatever the outcome.

## Known limits

- The bases and tasks were written by the person who wrote the .rx references and the language; the briefs and tests
  are the same for both arms, but the bases are not agent-written.
- Isolation is by instruction (prompt), checked afterwards in the transcripts.
- The .rx arm carries its docs in the prompt (about 3k tokens) and React carries none: that is the real cost of an
  unfamiliar language and stays in the measure.
- Prices are ratios at the time of the round; a different cache price changes the weights, so raw token counts are
  published per run too.
