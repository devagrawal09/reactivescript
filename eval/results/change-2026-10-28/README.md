# Round 4 result: changing an existing app

Pre-registration: `../../PREREG-change.md` (commit 4ba4c71, before any run). 36 fresh runs: 3 tasks (rename, close,
comments) × 2 arms × 2 models (the frontier model, and Haiku as the small one) × 3 runs, each starting from round 3's
frontier-model tracker app of its arm. No run had to be repeated. Six small-model runs ended without sending their
report and were asked for it once; none changed its app after being asked.

## Primary result: H1 not supported

| Defects shipped | React | .rx | Fisher, two-sided |
| --- | --- | --- | --- |
| All (pre-registered test) | 0 / 18 | 3 / 18 | p = 0.23 |
| Frontier model | 0 / 9 | 0 / 9 | p = 1.0 |
| Small model | 0 / 9 | 3 / 9 | p = 0.21 |

A defect is a failed build or any failed visible, hidden or hidden-overlap test (`score.mjs --overlap`), except the
one test reported alongside (below). Per task: rename 0/6 vs 1/6, close 0/6 vs 1/6, comments 0/6 vs 1/6. No run in
either arm broke a base-app test.

Neither direction is significant. The frontier model shipped no defect in either arm. All three defects are .rx
apps written by the small model.

## Every failure, classified

| Run | Test failed | Class | Cause |
| --- | --- | --- | --- |
| .rx small close-1 | two closes at once: a declined one does not undo the other | lost update | `let before = closedIds` before the await, then `closedIds := [...before, id]` after it: an accepted close writes a list from before the other close, so the declined row stays hidden |
| .rx small comments-2 | two posts at once: a declined one does not take the other with it | lost update | the same shape: `let before = comments`, then `comments := [...before, accepted]` after the await, which keeps the other post's `(sending…)` row |
| .rx small comments-2 | comments that load while a post is out keep the post | lost update | that write overwrites the comments source with the list from before the post, dropping the reloaded answer |
| .rx small rename-1 | an earlier rename declined after a later one was accepted keeps the later title | missing refresh | `optimistic detail := …` with `refresh issues` but no `refresh detail`: when the guess ends, the heading shows the title it fetched before the rename |

Two of the three defects are one pattern: a value read before an `await` and written back after it. It compiles
and passes the checker. In React the same shape is the classic stale-closure bug; no React run wrote it.

**Not counted: rename-1's missing refresh also shows on a single accepted rename.** An exploratory probe (not
pre-registered) renames once, lets the server accept, and checks the heading: small rename-rx-1 shows the old title,
the other 17 rename runs pass. No pre-registered test covered that case, so it does not change any count.

## Reported alongside, outside the count

"A post on one issue does not show on another" (solidjs/solid#4336): .rx comments runs failed it in 4 of 6 (frontier
1 of 3, small 3 of 3); React 0 of 6. The four apps make the whole-list guess the guide describes; the guess stays on
screen after the selected issue changes, until the post settles. The two frontier .rx runs that pass keep pending
posts in a list of their own (`sending`, `outbox`) beside the fetched comments.

| Mean per run | React, frontier | .rx, frontier | React, small | .rx, small |
| --- | --- | --- | --- | --- |
| Agent tokens | 47.8k | 56.0k | 56.7k | 68.8k |
| `./check` + `./test` cycles | 2.2 | 3.6 | 2.2 | 2.7 |

- **PR #17 (inferred actions, AC-1b/1c/1d)** was merged after the runs' toolchain was frozen. Rechecked on main
  (e25b81b + #14): all 18 .rx apps pass the new checker, and rescoring them with main's compiler and runtime gives the
  same 3 defects. Every .rx run used an explicit `action`; the lost-update writes come after the await from a read
  made before it, which neither HELD_WRITE nor STALE_OWN_READ covers.
- How the .rx close and comments runs held a pending write: the frontier model guessed per key (`hidden[id]`,
  `rowStates[i].closed`) or kept pending posts in a list of their own (`sending`, `outbox`) in 4 of 6, and guessed the
  whole list in 2. The small model guessed the whole list or id set in 5 of 6; small close-rx-3 hid the row with a
  plain write in the click handler and undid it in the action on a decline. Most React runs extended the base app's
  own pending entries and sequence numbers to the new write.

## Known limits, as found

- **Run agents could reach the project thread's reply tools.** Two small-model runs (rename-rx-1, comments-react-3)
  posted a short version of their final report into the thread with them. Their tool calls were checked:
  no run read the thread, the project chat or any message, so nothing reached the runs. Several runs also called
  `no_reply_needed`, and one small run read a documents guide; neither carries anything about the tasks.
- Six small-model runs needed a reminder to send their report (above).
- The bases are frontier-model apps; the small model changes code it would not have written.
- The new tests were written after round 3's results were known, and tuned on the references.
- 18 runs per arm detects a large effect only.

## What this means

Changing an app did not separate the arms either. The frontier model made all three changes correctly in both
languages. The small model did so in React, and in .rx shipped one pattern twice that the checker does not see: a
read before an await written back after it. A static check for it (a write after an `await` whose value depends on
a read of the same source taken before the `await`) is a candidate, not adopted here.

## Files

- `results-big.json`, `results-small.json`: `score.mjs --overlap` output (`failedAlongside` holds the #4336 test).
- `runs/<model>/<run>/`: each agent's own source files and its `./check`/`./test` log.
- `usage.txt`: agent tokens per run.
