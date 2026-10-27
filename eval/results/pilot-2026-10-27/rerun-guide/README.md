# Rerun of the .rx arm with `guide/async.md`

Same 6 cells as `../rerun-onflush` (tracker and settings, 3 runs each, main's spec and crate on Solid rc.19), with
one change: the run's docs include `guide/async.md` (commit 0a20dd8, written before these runs), and the prompt
says to read it first.

| | React (pilot) | .rx, spec only (pilot) | .rx, spec + onFlush | .rx, spec + guide |
| --- | --- | --- | --- | --- |
| Runs | 6 | 6 | 6 | 6 |
| Hidden tests passed | 57/57 | 57/57 | 57/57 | 57/57 |
| Save/assign written as an `action` | — | 3 of 6 | 3 of 6 | **6 of 6** |
| Runs with hand-written counters or tokens | 6 of 6 | 3 of 6 | 5 of 6 | **0 of 6** |
| Lines of app code, mean | 187 | 78 | 82 | **75** |
| Agent tokens per run, mean | 46.7k | 115.2k | 95.7k | **67.9k** |
| `./check` + `./test` cycles, mean | 2.8 | 6.5 | 5.2 | **4.7** |

(React and "spec only" columns are the pilot's tracker and settings runs; "spec + onFlush" is `../rerun-onflush`.)

**The guide did what the spec couldn't.** Every run wrote its server writes as actions with `optimistic` (and
`affects` for "saving…"), none kept a counter, and all passed every hidden test. Token cost fell by 41% against the
spec-only runs, though it's still 1.5× React's.

One new trap, which tracker-rx-1 hit and worked around: a `select` that cleared the assignment's error waited for
the assignment, because a plain write to a source an action has guessed joins its hold. The guide now says so
(section 4).
