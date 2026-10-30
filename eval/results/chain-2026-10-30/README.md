# Round 7 results: maintenance chains

Pre-registration: `eval/PREREG-chain-7.md` (4d6670f). 6 chains per arm, 4 steps each (labels, open-issue count,
related help, row actions), each step a fresh agent changing the app the previous agent left. 48 runs on 2026-10-30;
each step's 12 runs launched together. Scored with `harness/score.mjs --overlap`, chained with `harness/chain.mjs`
(`chain.txt`, `chain.json`).

## Primary and secondary hypotheses: not supported, reversed

| | React | .rx |
| --- | --- | --- |
| Chains ending with a defect (H7a) | 0 / 6 | 4 / 6 |
| Runs with a new defect (H7b) | 0 / 24 | 4 / 24 |
| Runs with a regression (H7c) | 0 / 24 | 4 / 24 |
| Mean cost per chain (billed, without each run's first call) | 305,627 | 503,888 |

One-sided tests in the pre-registered direction (React worse): p = 1.0 for H7a, H7b and H7c. Cost, React − .rx: p = 1.0;
the other way (.rx costs more): p = 0.0006.

Per step:

| Step | React defects | .rx defects | React mean cost | .rx mean cost |
| --- | --- | --- | --- | --- |
| 1 labels | 0 | 0 | 76,281 | 98,802 |
| 2 count | 0 | 0 | 60,440 | 71,399 |
| 3 related help | 0 | 0 | 86,469 | 78,497 |
| 4 row actions | 0 | 4 | 82,437 | 255,190 |

All four .rx defects are at step 4 and all are regressions of the desk's own tests. The #4425 test (alongside, as in
round 5) failed in every .rx run from step 3 on, as in the references.

## What happened

**React guards did not decay.** Every React run left every earlier test passing. Step-4 React agents reused the
detail's `doAssign` / `doClose` with a `fromRow` flag; five of six read the existing guard code closely enough to find
and fix a latent flaw in it (an older assignment still out could show over a newer accepted one). The hand-written
guards were read and extended, not broken.

**.rx step 4 hit H-11.** Row actions put several guesses on `issues` at once (a row close next to a detail close, two
assignments of one issue). In .rx, guesses on one source revert together and an action's error write is held with
its change, so a declined close stays on screen and its error stays hidden until every other change on the list
settles. Every .rx agent found this with its own extra tests (5 to 10 `./check`/`./test` runs, against React's 2-3) and
worked around it:

- 5 of 6 moved closing from a whole-list guess to a per-row `closing` flag, adding fields to the list's rows;
- all 6 replaced `optimistic err := ""` and held error writes with `onFlush` writes, so errors show at once (one agent
  noted this lets a late assign error show under another issue).

That is the 3x cost of step 4 (255k against 82k).

**Three of the four defects are a Solid bug the workaround reaches.** Runs rx-2, rx-4 and rx-6 wrapped the loader to
add the flag: `source issues key id = asRows(await fetchIssues(filter), filter)`. The compiler hoists the `await` into a
memo that the optimistic store's derive reads. When that load fails, the error never reaches the list's `errored`
boundary: the list keeps showing `loading closed issues` (test "a failing list leaves the detail alone"). Plain
`source issues key id = await fetchIssues(filter)` passes the same test (checked by editing one step-3 app both ways).
In Solid at the pinned next (5e68925c), `createOptimisticStore(fn)` whose `fn` reads a failed `createMemo` swallows
the error, where `createStore(fn)` delivers it: repro `solid-optimistic-store-error.test.ts` here (runs in solid `packages/signals/tests`)
(filed as solidjs/solid#4437). rx-3, which kept the flag on the plain source, passed.

**The fourth (rx-5)** kept a separate `closing` source derived from `issues` and guessed on it; after a filter switch
and reload the list shows empty rows (`# ()`) or none. Not yet reduced; it may be the agent's design or another runtime
bug.

## Reading

The claim tested was that hand-written guards decay as fresh agents change an app again and again. In four steps they
did not: frontier agents read the guards they inherited and extended them correctly, even improved them. .rx did not
fail on guards; it failed where the language could not express what the change needed (independent guesses on one
list, an error shown while another change on the same source is out), and the agents' workarounds then met a runtime
bug. The two .rx-specific causes are a language limit (H-11, already an open decision) and a Solid bug in
`createOptimisticStore`.

## Limits

- Six chains per arm, four steps; a longer chain may still show decay.
- Step 4 was written by the same author as the references, who knew the .rx reference passes it only under the H-11
  allowance the round 5 tests already make (a declined guess may linger until the other settles). The agents were not
  told of that allowance and built for the stricter reading of the brief.
- Not run: Solid, Foldkit.

## Files

`score.json` (per run), `chain.txt`, `chain.json` (per run new defects, regressions, cost; per arm totals and tests),
`agents.txt`. Runs in `/home/claude/runs/r7` (not committed).
