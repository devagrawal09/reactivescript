# Solid rc.21 graph views

## Slots and read rules

A node’s `_value` is committed truth, `_pendingValue` is a transaction’s staged future, and `_x._lane` is the lane value (a written guess or a derivation); `_shown` records whether the lane has revealed. The screen uses the lane value only after `_shown`; direct reads can see it before then, while authoritative reads see truth beneath a guess. [core/lanes.ts:10-17]

`display` returns the lane slot only when the lane is shown, else committed `_value`. [core/lanes.ts:125-135] `laneValueOf` prefers `_pendingValue` for non-guesses, else lane slot when present (or uninitialized), falling back to `_value`. [core/truth.ts:18-29] `truthRead` returns lane value only if the guess is truth; otherwise staged value then committed value. For a guess, `truth()` checks equality of lane and pending values; an override is truth only if its dependencies are truth too. [core/truth.ts:30-55]

## How a guess and lane settle

Optimistic writes are held as `pendingGuesses` until a seam decides the frame’s verdict; a committed frame with no hold means nothing was applied. [core/lanes.ts:137-143] An updater composes on an unflushed guess, else the lane value, else committed truth. [core/lanes.ts:144-151,186-193] The lane is a sub-frame of the action’s transition: it shows its guess while parent work waits, and ends with the parent—reverting to covered truth or landing as superseding truth. [core/lanes.ts:1-8]

`createOptimistic(fn)` constructs a computed and uses `optimisticWrite` as its setter; its own recompute is truth—equal confirms silently, different corrects at transition commit. [signals.ts:443-475; core/lanes.ts:186-210] A computed derived from `likes()` therefore is not a second, independent committed signal: its lane pass stores a derived lane value; when source truth changes it can be re-derived for the lane. Lane work goes to the lane slot, or to staging after reveal. [core/lanes.ts:19-25; 393-407]

## Supplied sequence and action transaction

An action generator’s slices run in its transaction. `yield` suspends and resumes inside that transaction; writes are not committed until the action transaction returns. [core/action.ts:29-47,67-75] So first click’s `shown` guess is visible while save #1 is pending; rejection ends the transition without the source write, and the guess reverts to its covered truth. On second click, the updater composes from the then-visible/committed base; when save #2 resolves with 1 and `setLikes(1)` runs, source truth is staged and then committed by the transaction. The derived `shown` pass must reconcile against that source truth: it confirms if equal or is corrected by recomputation at commit, rather than keeping the old guess. [core/lanes.ts:137-151; signals.ts:443-475; core/action.ts:67-75; core/truth.ts:43-55]

**Porting point:** keep committed, transaction-staged, and lane values distinct; reveal based on lane state; and settle/recompute the derived optimistic node with the parent transaction.
