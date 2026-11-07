# Action + scheduler trace (Solid rc.21)

Sources read: packages/signals/src/core/action.ts, packages/signals/src/core/scheduler.ts, packages/signals/src/core/lanes.ts, packages/signals/src/signals.ts.

## Control flow and transaction
- Calling the returned action invokes the generator, creates a non-lane transaction, sets _open = 1 and _acted = true, and gives this invocation a question id. The first generator slice runs synchronously; its writes ride the scheduled flush. (action.ts:152-174)
- A step calls it.next(v) or it.throw(e). A yielded thenable gets fulfillment/rejection handlers; either handler re-enters inTransaction(t,q,...) and steps the same iterator with the value or by throwing the rejection. Thus it is the same still-open t across the yield, not a new transaction. (action.ts:188-204, 213-250)
- When iterator is done, done decrements the resolved transaction open count and schedules a flush; an uncaught body error rejects the action Promise. A yielded Promise rejection is thrown into the generator, so a surrounding catch can consume it and let the iterator finish normally. (action.ts:160-164, 188-206, 217-250)
- A non-lane transaction starts with empty node/effect queues and is tracked as live. Actions set its open count; while open it cannot land. (scheduler.ts:330-347; action.ts:154-159; scheduler.ts:1093-1115)

## Optimism in the given program
- createOptimistic(() => likes()) creates a computed node and gives its setter optimisticWrite. (signals.ts:461-475)
- That setter applies updater functions to the currently guessed value, queues a guess with the current question, and schedules work; the truth node is not directly written. At the seam, a guess becomes a lane under its parent frame/transaction. Lanes end when that parent lands: an unconfirmed guess reverts; a guess superseded by the truth lands. (lanes.ts:186-209; scheduler.ts:350-362)
- First click: +1 is shown as a guess while its parent action transaction remains open. Reject resumes the generator in catch {}; this is not an uncaught action failure. The body finishes without setLikes, closes its parent transaction, and its unconfirmed guess reverts to likes=0. Second click makes a fresh action/question and a fresh guess; resolve with 1 resumes the same transaction, writes truth=1, then completes. The lane ends with its parent, with the guess confirmed by that truth; shown ends at 1. (action.ts:154-164, 217-250; lanes.ts:350-356)

## Flush / effects
- The first slice joins its action transaction; flushes while the generator body is on-stack are refused. Writes are staged in the flush, and if the transaction is still open its work is held rather than exposed. (action.ts:172-174, 239-250; scheduler.ts:371-376, 1608-1614)
- At the seam, lane seams run, then unblocked transactions are landed and their lanes ended. Effect callbacks are ordered: lane work first, then this flush runs, then runs held from earlier flushes that landed now. A still-parked frame runs remain with it. (scheduler.ts:1093-1115, 1130-1137)
- For this example: initial guess/derived work; no committed action effects while the action is open; on completion, lane reveal/revert and landed-frame work in the seam order above. A Rust port should preserve the open transaction and defer the generator continuation into it, rather than commit/restart at each yield. (action.ts:154-164, 217-250; scheduler.ts:1130-1137)
