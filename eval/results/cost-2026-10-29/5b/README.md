# Round 5b results: the guide's effects section

Pre-registration: `eval/PREREG-cost-5b.md` (a7aa866, b8aefe2). 18 .rx runs on 2026-10-29 with `guide/async.md` §6
(effects) added. Everything else is as in round 5; React and Solid are round 5's runs.

## Primary, as pre-registered (H1b not supported)

| | n | Mean billed | Median |
| --- | --- | --- | --- |
| React (round 5) | 18 | 101,219 | 101,678 |
| .rx (round 5) | 18 | 131,212 | 119,450 |
| .rx (5b) | 18 | 146,228 | 125,939 |
| Solid (round 5) | 18 | 134,953 | 126,145 |

- H1b (.rx 5b below React): React − .rx 5b = −45,009, p = 0.9998. Not supported.
- H3 (.rx 5b below .rx 5): .rx 5b is 15,016 higher, p = 0.78. Not supported.
- Solid − .rx 5b = −11,275 (p = 0.73).

## A measurement artifact the pre-registration missed: the prompt cache

Every run's first model call is the same text (system prompt, tools, the one-line start), about 36.4k tokens.
Whether that call reads it from the prompt cache or writes it depends on whether a run just before warmed the cache,
not on the arm:

- Round 5's labels batch started cold in all three arms (36.4k written).
- Round 5's related and count batches started warm in all three arms (9.1k written, 27.3k read).
- All 18 of 5b started cold: the session's tool list had changed since round 5, so the prefix was new.

A cold start costs 27.3k × (1.25 − 0.1) ≈ 31k billed units more. Round 5's comparisons are fair, because each task's
batch ran all three arms at once and so had the same cache state in every arm. 5b against round 5 is not fair: every
5b run carries ~31k that the related and count runs it is compared with don't. Post hoc, `harness/cost-warm.mjs`
drops each run's first call (the same text in every run) and compares the rest (`cost-warm.json`):

| Mean billed without call 1 | labels | related | count | all |
| --- | --- | --- | --- | --- |
| React | 77,925 | 82,286 | 68,656 | 76,289 |
| .rx (round 5) | 113,122 | 85,208 | 120,540 | 106,290 |
| .rx (5b) | 152,579 | 75,566 | 72,882 | 100,342 |
| Solid | 124,784 | 93,853 | 111,457 | 110,031 |

- .rx 5b − React = 24,053, p = 0.028 (one-sided, .rx higher). .rx 5 − React = 30,001, p = 0.0015.
- .rx 5 − .rx 5b = 5,947, p = 0.39.

This is not the pre-registered measure, and it is reported as a correction found after the runs.

## What changed, by task

- **count**: the guide answered what agents had gone to the spec for. Runs that touched `docs/spec` or
  `docs/guide` from a tool call: 6 of 6 before, 1 of 6 after; model calls 10.2 → 7.0. Cost without call 1:
  120.5k → 72.9k, against React's 68.7k. The gap there is gone.
- **related**: 75.6k against React's 82.3k, .rx's lowest; no doc lookups.
- **labels**: worse (113k → 153k; labels-rx-1 alone 350k, 25 calls). 5 of 6 runs read `spec/05-holds` and
  `06-stores` (H-11, AC-3, H-7). All six report the same thing: two adds (or removes) in flight share one
  pending-items source, so when the server declines one, it stays on screen until the other ends (H-11). The guide
  says to keep pending items in their own source and not to rebuild guesses by hand, and gives no way to guess each
  pending item on its own; agents spent turns looking for one, and two tried per-row guesses and backed out. Their
  apps pass every hidden test, so the tests don't cover two overlapping adds with one declined.

## Defects (`score.json`)

0 of 18. The #4425 test fails in all 6 related runs, as in round 5 (alongside, outside the count).

## Reading

The effects section did what it was for: count, where every round 5 run had gone to the spec, now costs about what
React does. Related is level or better. What's left is labels, and that isn't a guide gap. The language has no way to
guess each item of a growing list on its own: append guesses in one source revert together (H-11). That costs turns,
because agents look for a way out, and it leaves a behavior every .rx labels app shares. A per-item guess for
appends, like the per-row guess `todos[i].done` already has (AC-3), is the language change this points to.

## Files

`agents.txt`, `cost-rx.txt`, `cost-h1b.json`, `secondary.txt`/`.json`, `cost-warm.json` (with `agents-all.txt`:
round 5 and 5b runs, .rx arms renamed rx5 and rx5b), `score.json`. Combined lists for the tests: `agents-h1b.txt`
(React 5 + .rx 5b), `agents-h2b.txt` (Solid 5 + .rx 5b), `agents-h3.txt` (.rx 5 as "react" + .rx 5b).
