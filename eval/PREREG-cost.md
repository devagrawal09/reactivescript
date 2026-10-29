# Round 5: what a change costs

Pre-registration. Everything in this file was fixed and committed before the round's first agent run.

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
  react-hooks for React; tsc strict plus eslint-plugin-solid's `v2` config for Solid. Each run keeps scratch files in its own
  `.scratch` folder and uses no messaging tools. Each run's agent is started with one line that points it to its
  `.prompt` file, which it reads first: one extra call, the same in every arm (the prompts are too long to relay
  by hand 54 times).
- **Model**: the frontier model only, at the agent harness's default effort; the model id and effort are recorded with
  the results (cost is the question; round 4's small-model runs add variance, not an answer).
- **Runs**: 3 tasks × 3 arms × 6 runs = 54. Run k of a task starts from the same base in its arm.
- **Toolchain**: Solid next @ 5e68925c (2.0.0-rc.20, `ref/SOLID_NEXT`) in all three arms, through
  `eval/package.json`; the .rx compiler and runtime from this branch at the freezing commit. All references pass all
  tests on it but one, below.
- **Not waited on**: runtime bugs. Each round so far found Solid bugs, and fixing them before each round would mean
  no round. A bug found before freezing is named here and its test sits outside the defect count; one found during
  the round is listed, and the defect results are given with and without it. Neither changes the primary measure:
  the hidden tests are never shown to the agent, so they cannot change what a run costs.

Hidden test files (round 5's and the earlier ones they import), SHA-256 at freezing:

```
bdb6830b286c16c5d28e9b7789c138954465c15a1fd37c3b9422efb02434573e  tasks/desk/hidden-overlap.mjs
fa881652fa8ea2dcd3dc9ca0edbb33c705374a4f625670c043c07d29f63da0b8  tasks/desk/hidden.mjs
cf1c1eb9e58cf2aae31a74125c4eab0edb7d8d67134a7cd74dc5a0ebe32e2fa5  tasks/labels/hidden-overlap.mjs
89be40f794261e4b42090fdabdb38c1e48a32e1dbd811ec25ae3b285cac26cf2  tasks/labels/hidden.mjs
546ac1ee33c81f2909a23cc6e2ae4de3588678318ce6aa01be987519e160733f  tasks/related/hidden-overlap.mjs
bd714cbb344aae7a6aa3a52132bd4b61fc860729d2e96e64ed8b11b69230144d  tasks/related/hidden.mjs
9dc4b040fa5e5b7c971aa1d9954d194d6dde09c1ec69f71fd872e990ad91c9ef  tasks/count/hidden-overlap.mjs
1270f72e51d84409cc83fc76299ba5d9621600312dc71c2b9664bbbf6289e42e  tasks/count/hidden.mjs
84ecb6574905d44ccdf9b4f3b68cb4be29769b32f5a6415b16307da15f695e93  tasks/desk/pages.mjs
5d3e09edb9f0c2845aba82fc43b9689c8fe1066167fefa2dd04cbb93f4711b3e  tasks/tracker/hidden-overlap.mjs
c02e80f9b64e44dd843b601713ddc67553a5f85835e36ee5d13c35fb4121d09e  tasks/tracker/hidden.mjs
532e2caf837f3effaf77c5979af2651ed4d0ec2973b496d76846035d45831403  tasks/rename/hidden-overlap.mjs
869e02eceb679c5907a67571a26f061157eefd86e8e38a1a7aec8db7d9e65fc0  tasks/rename/hidden.mjs
669c606395e539e031ca7f376304a42607d15ffccb823b291b5d616f30ddce42  tasks/close/hidden-overlap.mjs
86aebac10d51c9244504e5da3b368c356e6b8c65dfab5d9dbc35b03adb66604d  tasks/close/hidden.mjs
11dd32de3c947f059b2a84216b1ac579e84666ecaba50d8cef44a23d2d09e249  tasks/comments/hidden-overlap.mjs
25d241a2309310943ed24d72d26c2a7e638a6feecbd3397b39123ebf5e956dab  tasks/comments/hidden.mjs
5776f8888055c4f5c13261b8637e048ebbb4f919602afb6f294a78ae4339b4d2  tasks/search/hidden-overlap.mjs
1d77a1daa81d15d40045d1f4665f9fdcebbe9abb6356db5b3a6eb8b29d30d0ae  tasks/search/hidden.mjs
aa1d42209d188ea4c54220c816d0ffe718e7ebe65c2d9b9d3fbf5fa23949aade  tasks/settings/hidden-overlap.mjs
58d2a1daa4a1b8d2ea559ab56bb37ee9193dcf3d31d03e362107e25ee3b106b6  tasks/settings/hidden.mjs
```

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
- **Outside the defect count, reported alongside**: "base: retry after not found shows the issue" (related task):
  solidjs/solid#4425, filed 2026-10-29: on rc.20 an `<Errored>` recovering after a retry waits for async under a
  nested `<Loading>`. The .rx and Solid references of the related task fail it; React's passes. Also round 4's
  "a post on one issue does not show on another" (solidjs/solid#4336, fixed; kept outside for comparability).
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
