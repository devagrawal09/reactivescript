# Async action + render-effect trace

## What the generator does

- The action opens a transaction, marks it acted/open, then starts the generator’s first step; completion decrements the open count, schedules work, and resolves/rejects the action promise. (action.ts:152-163, 235-243)
- For a yielded promise, its fulfillment handler re-enters the transaction and calls `step(v)`; rejection re-enters it and calls `step(e, true)`. The single-settlement guard prevents a broken thenable from resuming twice. (action.ts:205-233)
- `step` feeds a rejection to `it.throw(e)`. Thus the generator’s own `try/catch` receives the error. If it swallows it, the generator continues and returns normally; `done` resolves (not rejects) the action promise. Only an error escaping the generator reaches the `catch` in `step` and rejects the action. (action.ts:160-163, 165-203)
- The action transaction remains open across the yield; a resumed slice joins that same transaction. The transaction wrapper flushes after its slice, so the final slice’s flush runs before the promise reaction that observes the action’s returned promise. (action.ts:27-44, 152-163, 220-233)

## Expected frames for the given clicks

1. Initial screen: `likes=0`, so `shown=0`.
2. First click: `setShown` creates the optimistic guess. Its queued render effect runs at the flush and the text hole shows **1**, while save #1 is pending. Effect runs are queued for a transaction, rather than run inline. (effect.ts:85-102; core.ts:878-883)
3. Save #1 rejects: the rejection handler throws the error into the generator; the empty catch swallows it. No `setLikes` occurs. Normal generator completion closes the transaction; its flush rolls the unmatched guess back. The text hole then shows **0**. (action.ts:160-163, 188-203, 220-233; core.ts:949-955)
4. Second click: a fresh guess shows **1** at its queued render-effect flush. (effect.ts:85-102; core.ts:878-883)
5. Save #2 resolves with 1: the fulfillment handler resumes the generator with 1; `setLikes(1)` runs in the transaction, then normal completion closes it. The settling flush publishes the actual value **1**. Since the guess was already 1, the screen remains **1**; it is now backed by committed likes, not a guess. (action.ts:205-227, 160-163; core.ts:949-955)

## Ordering note for a port

A Rust port should preserve the distinction between resuming with a value and resuming by throwing into the generator, and should drain/flush the action transaction on each resumed slice before returning to the event loop. In particular, a caught rejection is successful generator completion, but still rolls back optimistic state that had no confirming write. Promise settlement callbacks run in registration order; the action’s rejection/fulfillment callback is the one that re-enters and flushes the transaction. (action.ts:205-233; async.ts:595-615, 673-682)

