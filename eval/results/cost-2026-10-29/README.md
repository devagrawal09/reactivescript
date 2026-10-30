# Round 5 results: what a change costs

Pre-registration: `eval/PREREG-cost.md` (frozen at 782d83e, prompt start clarified at 5656a1f). 54 runs, 2026-10-29:
3 tasks (labels, related, count) × 3 arms (.rx, React, Solid 2 TSX) × 6, each changing the issue desk. Frontier model
at the agent harness's default effort (the id is in the session record, not in the repo). Toolchain: Solid next
5e68925c (2.0.0-rc.20).

## Primary: billed cost (H1 not supported)

Billed units = input × 1 + cache write × 1.25 + cache read × 0.1 + output × 5, per run (`cost.txt`, `cost.json`).

| Arm | n | Mean | Median | sd | API $ / run |
| --- | --- | --- | --- | --- | --- |
| React | 18 | 101,219 | 101,678 | 22,425 | 0.51 |
| .rx | 18 | 131,212 | 119,450 | 53,926 | 0.66 |
| Solid 2 TSX | 18 | 134,953 | 126,145 | 33,779 | 0.67 |

- **H1** (.rx cheaper than React): .rx cost 30% more (React − .rx = −29,992). One-sided permutation p = 0.989.
  H1 does not hold; the difference runs the other way.
- **H2** (.rx cheaper than Solid): .rx 2.8% cheaper (Solid − .rx = 3,742), p = 0.42. No difference shown.
- React − Solid (descriptive): Solid cost 33% more than React, about what .rx did.

## Per task (`secondary.txt`)

| Task | React | .rx | Solid | calls R / rx / S |
| --- | --- | --- | --- | --- |
| labels | 123,827 | 158,986 | 170,648 | 6.8 / 10.3 / 11.3 |
| related | 96,730 | 99,658 | 108,303 | 8.0 / 8.7 / 8.7 |
| count | 83,101 | 134,991 | 125,908 | 6.3 / 10.2 / 10.8 |

Means. One .rx run each in labels (labels-rx-6, 303k, 22 calls: it tried and backed out of reverting each in-flight
label on its own) and count (count-rx-1, 224k) wandered; without them .rx's median is still above React's.

## Where the cost goes

- **Not output**: output tokens per run are the same in React and .rx (4,658 vs 4,633; Solid 5,564).
- **Not the source**: the .rx base is the smallest (15 KB of source vs React's 24 to 28 KB), and every arm read it in
  one or two calls.
- **Turns**: .rx and Solid runs took 9.7 and 10.3 model calls against React's 7.1. Each extra call re-reads the
  whole context from cache, so turns are what cost.
- **What the extra turns were**: reading the language's semantics. 16 of 18 .rx runs went into `docs/` (grepping
  `spec/` for how an effect behaves under a guess, 2.2 doc calls per run); 13 of 18 Solid runs read
  `node_modules/solid-js` docs (1.0 per run); React runs read none. Several .rx and Solid runs also wrote and removed
  their own extra tests to confirm a timing they could not get from the docs. React agents trusted what they know.
- **Inline docs**: the .rx prompt is 15 KB, React's 1.8 KB, Solid's 11 KB. About 3k extra tokens, carried through
  every call: roughly 6 to 7k billed units per .rx run, a fifth of the gap.
- `./check` + `./test` calls: React 2.2, .rx 3.3, Solid 3.7 per run.
- Wall-clock (median seconds): React 158, .rx 116, Solid 175.

## Secondary: defects (`score.json`)

0 of 18 runs shipped a defect in each arm (visible, hidden and overlap tests at "done"). Nothing for Fisher's test to
compare; cost per defect-free run is the cost per run above.

Alongside (outside the count, as pre-registered): "base: retry after not found shows the issue" fails in all 6 .rx and
all 6 Solid related runs and in no React run: solidjs/solid#4425, the runtime bug named in the pre-registration. No
other runtime bug showed during the round.

## Checks

- No run used a messaging tool (`mcp` column, 0 calls in all 54 transcripts).
- Every agent reported `./check` and the visible tests green at "done"; scoring agrees (21/21 or 22/22 everywhere).

## Reading

Changing an app the model already knows how to write (React) is cheaper than changing one in a framework it has to
look up, and .rx is in the second group with Solid 2: the agent's cost is set by how sure it is of the semantics, not
by how short the code is. .rx's smaller source did not show up in the bill at this app size (≈15 to 28 KB), because
reading source is a small, one-time part of a run. The pilot's 9% advantage did not replicate.

## Files

- `agents.txt`: run → transcript id.
- `cost.txt`, `cost.json`: primary measure per run, `harness/cost.mjs`.
- `secondary.txt`, `secondary.json`: per task and arm, `harness/cost-split.mjs`.
- `score.json`: defects per run, `harness/score.mjs --overlap` (run one run at a time, merged).
- The run directories are in `/home/claude/runs/r5` of the session that ran them, not committed (as in round 4).
