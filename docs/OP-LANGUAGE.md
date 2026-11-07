# Differential program format

A program is a JSON array of operations. The Rust driver reads one array per stdin line and writes one observation array per stdout line. IDs are strings. Values in this spike are signed integers kept small enough for exact JS arithmetic.

## Operations

- signal: id, value, optional equals (default/parity/never), optimistic boolean.
- memo: id, expr, optional owner (root by default), lazy, equals, flight prefix, loading integer.
- effect: id, expr, optional owner, render, defer. Both compute and apply are logged; apply returns a logged cleanup. User effects install a logged error callback.
- write: id, value. Several writes without flush are one imperative turn.
- read: id, optional label. latest and pending: id.
- flush: explicit reactive flush, not an arbitrary wait.
- owner: id, optional parent. cleanup: owner, label. dispose: owner.
- refresh: id (memo). The JS promise is handled so reference errors do not become Node unhandled rejections.
- action: id, slices. Each slice has writes (id/value pairs) and an optional flight to yield. The final slice normally has no flight. Rejection escapes the generated action; Rust's public action closure can implement catching separately.
- resolve: flight, value. reject: flight, message. These settle once, then drain controlled microtasks. Repeated settlement has no effect but the turn still drains.

A memo with a flight prefix evaluates its expression to an integer key and returns the promise named prefix:key. Two requests for the same key reuse the same promise. Refreshing such a memo deliberately exercises already-resolved promise handling. Flight names supplied to actions are used literally.

## Expressions

An expression is an integer literal or an object with op:

- read: id
- add: a, b (expressions)
- mod: a (expression), b (nonzero integer)
- choose: test, yes, no (expressions, nonzero means true)
- untrack: expr
- fail: message
- prev: fallback (integer)

Expressions do not create nodes or perform writes. There are no stores, JS objects, arbitrary code strings, streams, or native widgets in this language.

## Observations

Logs are arrays tagged compute, flight, effect, effect_cleanup, error, cleanup, action, read, latest, or pending. Missing previous values and successful action errors are represented by null. Read errors are objects with an error field: pending for NotReadyError, otherwise the error message. Initial loading is observed through pending reads/errors and optional loading values; there is no invented JS isLoading API.

A program's root is disposed after the last op, and teardown logs are included. For isolation, the JS runner then closes orphan flights/actions left by reduction, outside the recorded trace. This cannot turn a failing trace into a passing one by removing in-program logs.

## Generation and reduction

Mulberry32 uses a numeric seed. Six families exercise eager graphs, lazy graphs, async memo requests, same-tick actions, later overlapping actions, and error recovery. Random graph bodies cover branching, untrack, equality cuts, multiple writes, refreshes, and observations. Async programs also vary loading seeds, refresh, and rejection. This is structured fuzzing, not unrestricted arbitrary-program generation.

The runner counts op kinds only in original seed programs, not reducer attempts. It writes one full failure per seed. Failures are bucketed by family and the first different log tag pair. These are mechanical buckets, not claims of independent root causes. The reducer removes chunks and individual ops, preserving basic reference validity and any exact-log mismatch, with a bounded search budget. It can reduce to a different mismatch class; inspect the saved reduced logs. It does not claim globally minimal programs.

Commands: node fuzz/run.mjs --seeds N [--start S] [--out DIR] [--no-reduce]; node fuzz/run.mjs --replay PATH. SOLID_SIGNALS_URL can override the reference module URL.
