# Solid rc.21 observations

Reference: local @solidjs/signals 2.0.0-rc.21, production build.

- Setters stage writes. An immediate ordinary read returns the old value, even in the same imperative function. Flush makes writes visible. There is no exported Solid 1-style batch primitive in this core; a turn already batches writes.
- A user effect computes on creation but applies at flush. A render effect also applies on creation. Both use compute/apply callbacks. Returning a non-function truthy value from apply is unsafe: it is treated as a cleanup.
- Pending on first load is not the same as isPending: an async memo without a committed value throws NotReadyError on read but isPending returns false. A later request keeps the committed value and reports pending.
- Pending/error status can flow through a previously tracked edge without running the downstream computation body. An independent changed input can still cause that body to run.
- An effect error callback does not automatically run its previous successful apply cleanup. The JS error callback receives a cleanup function; the simple fuzzer callback deliberately does not call it.
- Refresh is queued. An ordinary immediate read after refresh can still return the old value.
- lazy means more than delayed creation: an unobserved memo releases its dependencies at a turn boundary and recomputes on the next read, while retaining its last committed value as the next previous-value argument.
- Actions begun in one tick merge. Writes before the call can be adopted into that hold. Later actions touching an already held slot join it too.
- Action rejection does NOT roll back ordinary writes. Those are intent and commit when the hold closes. Optimistic guesses are provisional and revert. A plain optimistic signal reverts on success too; success is not automatically an authoritative replacement. A source-backed optimistic memo can confirm or correct against its real result.
- During an action hold, ordinary signal reads keep the committed value; latest can see the held proposal after flush. A plain optimistic guess is visible ahead but does not by itself make isPending true.
- Split effects can compute multiple speculative values during an optimistic action while applying only a committed/visible value. Compute traces are part of this spike's comparison, not discarded as implementation details.

- Returning the identical already-settled promise again does not necessarily reenter pending. Returning a different settled promise still schedules a continuation.
- A visible error can outlive the start of a new request: ordinary read throws the old error, latest returns the last good value, and pending is true until the replacement succeeds.
- The fuzzer found reference failures too. A reduced lazy-refresh/read program times out in root teardown. Another hits a TypeError in deleteFromHeap during dormant-node sweeping. Their saved oracle logs and programs are retained, not converted into passing cases or used to change the oracle. See the full results and repros in STATUS.

These are compatibility targets, not suggestions to change Solid. RX AC-1 and H-2/H-11 describe the action/hold intent; RX's broader automatic async scope is not the JS generator API.
