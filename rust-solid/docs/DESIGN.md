# Design

## Scope and reference

This is a runtime-port spike, not a completed Solid 2 implementation. M1 requires full async; that milestone is **not complete**. There is no ReactiveScript integration and no renderer.

Oracle: @solidjs/signals 2.0.0-rc.21 production dist from the read-only checkout at ../solid-next, commit 2105ffb8ca2fced55f5fac0763177fc93f97c2c2. RX spec 05-holds (H-2, H-11) and 06-stores (AC-1 family, same-tick adoption and same-slot joining) were read for context. Solid, including its surprising behavior, wins comparisons.

## Graph

Runtime<T> owns an Rc<RefCell<State<T>>>. Signal<T> uses a Weak handle into it. T is homogeneous within a runtime and must implement Clone + PartialEq; the differential driver uses i64. This is smaller than a heterogeneous UI graph and is an intentional public-API limitation, not JS number/object equality parity.

Nodes keep committed/last values, value and status revisions, ordered dependency/subscriber links, compute closures, and owner IDs. Value and pending/error changes have separate revisions. Status-only propagation can avoid calling a downstream body. Dynamic tracked dependencies are replaced after each compute; untrack suppresses collection. Custom comparator closures or an always-false comparator are supported.

Writes are staged until flush. The queue uses computation height and insertion order. Memos compare values; split effects do not suppress successful body runs just because their result equals the prior result. Render applies precede user applies. Effects have separate previous-applied values and apply cleanups. Refresh queues another computation. Lazy nodes release unused dependencies at flush while keeping their last value as the next compute's previous value.

Owners contain children and reverse-order cleanups. Recompute disposes the previous computation-owned children. Disposal is idempotent, unlinks dependencies, and clears closures. Plain signals outlive the owner that created them. Error values can reach an effect handler or walk to a Rust owner handler. This is not Solid's full error-boundary/queue-halt implementation.

## Controlled executor

There are no threads, timers, Tokio, or JavaScript calls inside the Rust runtime. An async compute returns Computation::Await(flight_id). Tests call settle(id, Ok(value)) or settle(id, Err(error)). Completion queues continuations; drain runs pending reactive work and completion work until quiescent. Returning an already-completed flight still suspends until drain. A newer flight supersedes the old one, and disposed computations ignore replies.

ActionBody is a stateful Rust closure returning Yield(flight), Done, or Fail(error), a coroutine-style equivalent of a generator. Its next call receives the yielded result or rejection. The public closure can catch a rejection and compensate; the JSON driver currently tests uncaught rejection. Multi-yield closures are possible. This is **not** a general std::future::Future executor, and promise reaction order across shared memo/action flights is not yet proven.

Transactions keep held writes, optimistic bases, and open-action counts. Same-tick actions merge; writes to an already held slot join its hold. A transaction commits ordinary intent when all its action bodies finish, including failure. Optimistic plain signals revert to their covered base at close. These mechanisms exist, but action speculative computation and optimistic lanes are incomplete; differential action traces fail.

## Native event-loop host

Keep one Runtime on the UI thread. Event handlers enqueue writes/actions, then schedule one end-of-turn drain. A network/task adapter does work elsewhere and posts a message containing a flight ID plus value/error to the UI thread; only there does it call settle. has_work tells the host whether reactive/continuation work remains. A render effect's apply callback can update native widgets, with cleanup releasing listeners/resources. Do not send Runtime or its Rc handles between threads.

A production adapter needs bounded work budgets, a wake callback, generational handles, cancellation policy, and allocation reclamation. Current arenas retain slots and settled flight results for the runtime lifetime. The current 1000-pass flush guard is not a production livelock policy. User panics are not converted to reactive errors and can leave ambient scope state unusable; use ReadError for expected computation failures.

## Important gaps

- Full served-reader holds, joins, committed/staged graph snapshots, optimistic lanes, and born-held owners/effects. These are the largest async risks; a transaction map alone cannot reproduce them.
- Optimistic memo/source reconciliation, source truth confirmation, authoritative refresh, and nested/overlapping lane behavior. Only plain optimistic signals have a Rust API here.
- Loading/Errored boundary trees, reveal/attachment queues, error halting/reset, and runtime diagnostics.
- Async iterable streams, arbitrary Future polling, cancellation tokens and settled callbacks.
- Writable memos, tracked effects, reactions, context APIs, stores and heterogeneous JS values.
- Exhaustive dynamic-owner creation/disposal during computation; the Rust ownership primitives exist but the generator does not construct subgraphs inside expression bodies.
- Some lazy lifetime and scheduling cases still diverge; see STATUS and reduced replays.

Unsupported APIs are not generated. Partially implemented APIs remain in the generator and their bugs count as failures. Compute logs are compared too; the runner never ignores speculative reruns or sorts effect logs to improve the score.
