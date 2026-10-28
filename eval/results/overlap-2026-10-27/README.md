# Round 3 result: overlapping writes

Pre-registration: `../../PREREG-overlap.md` (commit 82176b6, before any run). 36 fresh runs: 3 tasks × 2 arms × 2
models (the frontier model, and Haiku as the small one) × 3 runs. No run had to be repeated. Two runs ended without
sending their report and were asked for it once; neither changed its app after being asked.

## Primary result: H1 not supported

| Defects shipped | React | .rx | Fisher, two-sided |
| --- | --- | --- | --- |
| All (pre-registered test) | 4 / 18 | 5 / 18 | p = 1.0 |
| Frontier model | 0 / 9 | 3 / 9 | p = 0.21 |
| Small model | 4 / 9 | 2 / 9 | p = 0.62 |
| Without solidjs/solid#4329 (pre-registered recount) | 4 / 18 | 2 / 18 | p = 0.66 |

A defect is a failed build or any failed visible, hidden or hidden-overlap test (`score.mjs --overlap`). Per task:
search 0/6 vs 0/6, settings 1/6 vs 0/6, tracker 3/6 vs 5/6.

Neither direction is significant. The frontier model wrote correct React for every overlap case. Every .rx failure
it shipped is the same Solid runtime bug.

## Every failure, classified

| Run | Test failed | Class | Cause |
| --- | --- | --- | --- |
| React small settings-1 | a later save failing while an earlier one is out | wrong revert | the failed save reverts to the last confirmed settings, dropping the earlier save still in flight |
| React small tracker-1 | two issues assigned at once | wrong revert | declining #3 also reverts #1 |
| React small tracker-1 | list loads while an assignment is out | lost guess | the reloaded list overwrites the optimistic row |
| React small tracker-2 | list loads while an assignment is out | lost guess | same |
| React small tracker-3 | list loads while an assignment is out | lost guess | same |
| .rx frontier tracker-1 | list loads while an assignment is out | runtime bug | #4329 |
| .rx frontier tracker-2 | list loads while an assignment is out | runtime bug | #4329 |
| .rx frontier tracker-3 | list loads while an assignment is out | runtime bug | #4329 |
| .rx small tracker-2 | list loads while an assignment is out | runtime bug | #4329 |
| .rx small tracker-2 | (hidden) a new assignment clears the previous error | error lost | the old error stays up through the new assignment |
| .rx small tracker-2 | (hidden) selecting after not found shows loading | stale error | `errored` sits outside `loading on(selected)`, the same trap as round 2's one defect |
| .rx small tracker-1 | two issues assigned at once | wrong revert | a whole-list guess (`optimistic overrides := …`) makes both assignments one change (H-11), so the declined row stays until the other ends |

**The runtime bug.** The four "runtime bug" runs write exactly the guide's idiom: `let i = indexOf(issues, …)`,
`optimistic issues[i].assignee := who`, `await assign(…)`, `refresh issues`. By the spec the guess holds until the
action ends (AC-3, D-34; Ryan's ruling of 2026-10-27). In rc.19, a list answer that lands while the action is
pending drops a per-key guess from the screen (solidjs/solid#4329). The failure message matches the issue's repro
(the row shows the server's old assignee). Confirmed on 2026-10-28: with Solid next @ ac28157a (the #4329 fix,
solidjs/solid#4330), all four runs pass that test, and small tracker-2 still fails its two hidden tests. The
pre-registered result stands as above; the recount without #4329 is what the fixed runtime gives.

**The same race, both arms.** "A list that loads while an assignment is out" is the one case both arms failed.
3 of 3 small-model React apps failed it in their own code (the refetch overwrote the optimistic cache). 0 of 3
frontier React apps failed it. 4 of the 6 .rx apps failed it with code that is correct by the spec. The other two
did not use a per-row guess and passed it.

## Reported alongside

| Mean per run | React, frontier | .rx, frontier | React, small | .rx, small |
| --- | --- | --- | --- | --- |
| Agent tokens | 46.6k | 65.7k | 53.9k | 87.3k |
| `./check` + `./test` cycles | 2.0 | 4.0 | 2.2 | 6.7 |

- Guide uptake: 5 of 6 .rx tracker runs used the per-row guess with `indexOf`. Small tracker-1 used a whole-list
  guess. Small tracker-3 reports that its per-row guess "left the list unchanged" in its own tests, and replaced it
  with an `onFlush`-written overlay. That report is not checked: the frontier runs show the per-row guess rendering.
- No .rx run hand-rolled a request counter. React runs guarded stale answers with sequence numbers or query keys, as
  in round 2.
- App size is in `runs/` (about 60 lines .rx, 140 React). It is not evidence for either arm.

## Known limits, as found

- **A leak between runs through a shared scratch folder.** Three frontier .rx runs backed up `tests/visible.mjs` to
  the session's scratch folder (outside their run directories) before adding tests of their own. Big search-rx-1 and
  big settings-rx-1 did this at the same time, and search-rx-1 restored the settings task's `visible.mjs` into its
  own directory. Scoring uses the task's own test files, so no score changes; the search run never saw settings
  code beyond what it copied back. The next round should give each agent its own scratch folder.
- The overlap tests were written after exploratory probes (`probes/`) on round 2's apps.
- 18 runs per arm detects a large effect only.

## What this means

Overlapping writes did not separate the arms either. The frontier model handled every overlap case in React. The
small model's React failed overlap cases in 4 of 9 runs, the .rx guide's idiom avoided them in code, and the runtime
then lost the guess in the one case it was meant to hold. Until #4329 is fixed, the idiom the guide teaches ships a
bug in that case.

## Files

- `results-big.json`, `results-small.json`: `score.mjs --overlap` output.
- `runs/<model>/<run>/`: each agent's own source files and its `./check`/`./test` log.
- `usage.txt`: agent tokens per run.
