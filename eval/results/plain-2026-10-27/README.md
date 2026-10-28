# Round 2 result: briefs that don't name the races

Pre-registration: `../../PREREG-plain.md` (commit 9c38a3f, before any run). 36 runs: 3 tasks × 2 arms × 2 models
(the frontier model, and Haiku as the small one) × 3 runs. No run had to be repeated.

## Primary result: H1 not supported

| Defects shipped | React | .rx | Fisher, two-sided |
| --- | --- | --- | --- |
| All (pre-registered test) | 0 / 18 | 1 / 18 | p = 1.0 |
| Frontier model | 0 / 9 | 0 / 9 | |
| Small model | 0 / 9 | 1 / 9 | |

With the race sentences removed from the brief, **every React run still passed every hidden test**, at both model
sizes. The agents guarded stale answers without being told to: a sequence number per request, or TanStack Query keyed
by the query, filter or id. Their own reports say so ("a late answer to an older search … is ignored").

## The one defect (.rx, small model, tracker)

`runs/small/tracker-rx-1/main.rx` fails 2 of 11 hidden tests. Both failures are .rx traps:

- **A new assignment clears the previous error at once:** fails. The action clears the error with a plain write
  (`assignError := ""`), and that write is held until the server answers (AC-1). This is the first trap
  `guide/async.md` names. The agent had read the guide and still wrote it.
- **Selecting after not found shows loading, not the old message:** fails. The agent put `errored` *outside*
  `loading on(selected)`. A new selection resets the loading boundary but not the error boundary above it, so the old
  `not found` stays up. The guide's advice ("put `loading on(k)` above the `errored`") was given for retry, not
  for a new selection.

## Reported alongside

| Mean per run | React, frontier | .rx, frontier | React, small | .rx, small |
| --- | --- | --- | --- | --- |
| App lines (non-blank, non-comment) | 154 | 58 | 140 | 61 |
| Agent tokens | 47.1k | 68.5k | 55.0k | 91.3k |

- .rx apps are about 40% the size of the React apps, at both model sizes.
- .rx runs cost about 1.5× (frontier) and 1.7× (small) the tokens. They read the guide and parts of the spec.
- By their own reports, 13 of the 18 .rx runs wrote extra failure-path tests (in `tests/visible.mjs` or a scratch
  copy) and removed them afterwards. No React run reported doing this. In every run, `tests/visible.mjs` at the end is
  byte-identical to the task's.

## What this means

On these three apps, React is not a source of race bugs for current models, even when the brief doesn't name the
races. A defect gap has to come from somewhere else. What the agents' own reports flag as unsure, and the hidden tests
don't probe: overlapping mutations (two assignments or two saves in flight), an optimistic write racing a refetch of
the same list, and changes to code that already exists. See the PR or the thread for the proposed next round.
