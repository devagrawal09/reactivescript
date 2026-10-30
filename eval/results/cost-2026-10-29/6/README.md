# Round 6 results: Foldkit

Pre-registration: `eval/PREREG-cost-6.md` (5db7809). 18 Foldkit 0.170 runs on 2026-10-29, the same three changes to the
issue desk as rounds 5 and 5b. Baselines: round 5's React and Solid runs, 5b's .rx runs.

## Primary: billed cost without the first call (H6a supported)

| Arm | n | Mean | labels | related | count |
| --- | --- | --- | --- | --- | --- |
| React (5) | 18 | 76,289 | 77,925 | 82,286 | 68,656 |
| .rx (5b) | 18 | 100,342 | 152,579 | 75,566 | 72,882 |
| Solid 2 (5) | 18 | 110,031 | 124,784 | 93,853 | 111,457 |
| Foldkit (6) | 18 | 124,770 | 130,410 | 138,847 | 105,052 |

(`cost-warm.json`, `harness/cost-warm.mjs`; one-sided permutation tests, 100,000 relabellings, seed 5.)

- **H6a** (Foldkit costs more than React): Foldkit − React = 48,481, p < 0.0001. Supported: 64% more.
- **H6b** (Foldkit costs more than .rx 5b): Foldkit − .rx = 24,427, p = 0.048. Supported, narrowly.
- Foldkit − Solid = 14,739, p = 0.029 (descriptive).

Raw billed cost (all 18 runs started with a cold cache, as 5b's did): mean 168,963, median 175,624, about $0.84 per
run (`cost-raw.txt`).

## Where the cost goes

- **Not turns.** Foldkit runs took 8.3 model calls, fewer than .rx (9.4) or Solid (10.3), close to React (7.1). Its
  `./check` + `./test` calls: 2.4 per run, the fewest after React.
- **Output and context.** Foldkit runs wrote the most (6.5k output tokens per run; React 4.7k, .rx 4.4k), and every
  call carries a bigger app: the Foldkit desk is 42 KB of source against React's 20 KB and .rx's 11 KB, read in full
  and then re-read from cache on each call.
- **Little doc lookup.** Runs that opened `docs/foldkit` or the packages: labels 1 of 6, count 2 of 6, related 6 of 6
  (all looking up `OutMessage` and the `Update` helpers, to pass the hit from the issues page to the help page).
- Foldkit agents reported almost no uncertainty about framework timing; their doubts were about the brief.

## Defects (`score.json`)

2 of 18 Foldkit runs shipped a defect, both labels: "labels that load while an add is out keep the add" (an add made
while the issue's labels are still loading is lost when they land, or adding is blocked until they load). React,
Solid and .rx: 0 of 18 each. Fisher's exact test, Foldkit vs React: p = 0.49 (two-sided). Foldkit's references pass
the #4425 test; no Foldkit run failed it.

## Reading

Foldkit gives the agent explicit structure and no reactive timing to look up, and its agents did take few turns. It
still cost the most of the four, because each change is more code to write and every call carries a larger app. The
cost of a change follows two things: how sure the agent is of the semantics (turns) and how much code the change and
the app need (tokens per turn). .rx with the effects guide is short on both for related and count; Foldkit is low on
turns and high on tokens; React is low on both.

## Limits

- The Foldkit bases were written for this round by someone new to Foldkit. One base flaw showed up in agents'
  reports: `retry` on the detail also discards a comments answer still in flight (comments share the detail's
  request number), so `loading comments` can stick. No test covers it; three agents fixed it in passing.
- No lint in the Foldkit arm (its oxlint plugin is not on npm).
- Not concurrent with the baselines; compared on the cache-neutral measure.

## Files

`agents.txt`, `agents-all.txt` (React 5, Solid 5, .rx 5b, Foldkit 6), `cost-raw.txt`, `cost-warm.json`,
`secondary.txt`/`.json`, `score.json`.
