# Pilot, 2026-10-27: .rx vs React 19 on Solid rc.19

18 runs as pre-registered in `../../README.md` (commit 0584c31): 3 tasks × 2 arms × 3 runs, one fresh agent each,
the session's frontier Claude model. `results.json` is `harness/score.mjs`'s output; `runs/<run>/` keeps each
agent's sources and its `./check`/`./test` log.

## Result: no difference in defects; .rx cost more to get there

| | React | .rx |
| --- | --- | --- |
| Runs with a shipped defect (headline) | 0 of 9 | 0 of 9 |
| Hidden tests passed | 93 of 93 | 93 of 93 |
| `./check` + `./test` cycles, mean (range) | 2.6 (2–5) | 6.4 (5–11) |
| Cycles until the visible tests first passed, mean | 2.0 | 3.1 |
| Agent tokens per run, mean | 46.6k | 110.8k |
| Agent time per run, mean | 1.0 min | 3.3 min |
| Lines of app code, mean (range) | 168 (126–222) | 73 (62–85) |
| Runs that added their own edge-case tests | 0 of 9 | 9 of 9 |

Tokens and times are as the agent runner reported them at the end of each run.

**The benchmark did not discriminate.** Every React run handled every adversarial order the hidden tests play:
all nine guarded against stale answers by hand (request ids, sequence numbers, cancellation flags; 7 of 9 used no
data library). The naive drafts in `mutants/` fail 3–5 hidden tests each, but a frontier model doesn't write them
when the brief says, as these briefs do, that "answers can arrive in any order" and "only the answer for the
current query may ever show". The briefs named the race, so the model guarded it.

**What .rx did show:**

- Less than half the code (73 vs 168 lines), with no request bookkeeping in 6 of 9 runs: stale answers were
  impossible to show, not guarded against.
- 2.4× the tokens and 2.5× the cycles. The agents learnt the language from a 35k-word spec, and every one of
  them wrote extra tests to confirm what the spec's async rules would do. React agents wrote none.

**Findings about the language** (from the runs, the agents' notes, and validating the references):

1. **Async actions push agents back to hand-written sequencing.** 3 of 9 .rx runs (settings-rx-2, settings-rx-3,
   tracker-rx-3) avoided `action`/`optimistic` and wrote plain click handlers with sequence numbers, the React
   pattern .rx is meant to remove. All three gave the same reason: a plain write in an action that awaits is held
   until the action ends (AC-1), so "clear the old error at once" doesn't happen. The tracker reference hit the
   same thing before any agent ran. The idiom that works (`optimistic x := …` on a question source) is in the spec
   but not where an agent looks.
2. **`errored` around a search hides the next `pending?`.** search-rx-2 tried an `errored` boundary for search
   failures and found `pending?` never turned true for the next query after a failure; it turned the failure into
   a value with `catch` instead. Same family as DV-8.
3. **DV-8 is still live in rc.19**: `results key id = …` reports no `pending?` on re-ask (validation, before runs).
4. **Check passes, build fails.** settings-rx-3's first version passed `rxc check` and then failed in
   `rxc compile`: "`await` outside an equation's result position is not lowered yet". The checker should refuse
   what the lowering can't do.

## Deviations from the pre-registration

- After 11 runs, the prompt for the last 6 runs added "keep any scratch files inside it [the run directory]":
  settings-rx-1 reported keeping a copy of its test file in a shared scratch folder that another run overwrote.
  Scoring uses the task's own visible tests, so no score depends on an agent's copy.
- Agents edited `tests/visible.mjs` to add tests and put it back; scoring reads `tasks/<task>/visible.mjs`.
