# Rerun of the .rx arm with `onFlush` in the spec

After the pilot, PR #10 added `onFlush` (02 EF-8) and handler-form `onSettled` (EF-7). These 6 runs repeat the .rx
arm of `tracker` and `settings`, the two tasks where agents fell back to plain handlers. Everything else is the
same: the prompt (with the scratch-file line), the tasks, the tests, one fresh agent each. The spec (`docs/spec`) and
the crate are now main's (merge 7749fda), still on Solid rc.19.

| Run | Hidden | Cycles | `action` | `optimistic` | `onFlush` | Hand-written sequencing |
| --- | --- | --- | --- | --- | --- | --- |
| settings-rx-1 | 8/8 | 4 | yes | yes | no | no |
| settings-rx-2 | 8/8 | 6 | no | no | no | yes (save counter) |
| settings-rx-3 | 8/8 | 4 | load only | no | yes, to show `Loading settings…` on retry | yes (save counter) |
| tracker-rx-1 | 11/11 | 3 | no | no | no | yes (assign handler) |
| tracker-rx-2 | 11/11 | 6 | yes | yes | no | yes (error tied to its selection) |
| tracker-rx-3 | 11/11 | 8 | yes | no | yes, to show pending assignments now | yes (pending list, counter) |

**Still no defects, and `onFlush` didn't bring agents back to actions.** Two of six found `onFlush`, and both used it
as the spec describes, to get a write out of a hold. Both also kept hand-written bookkeeping around it. Three of
six still wrote the save or the assignment as a plain handler, the same share as the pilot on these two tasks
(3 of 6). Five of six kept counters or tokens of their own, including one that used `action` and `optimistic`.

The reasons agents gave:

- "the plain handler's timing is easier to predict" (settings-rx-2), and "so a slow assignment doesn't hold up the
  rest of the page" (tracker-rx-1). Both are about the hold of an async action (AC-1, H-2).
- tracker-rx-3 started with `optimistic` and dropped it: with two assignments in the air, a declined one went back
  only after the other finished. Guesses from two actions on one source join one change and revert together
  (H-11). That is the model, but the agent read it as a bug and rebuilt the guesses by hand.

So the obstacle isn't a missing tool: the language has the tools (`optimistic`, `affects`, `onFlush`). What's
missing is a short account an agent reads first of when an action holds, and which tool keeps a write out of it.
