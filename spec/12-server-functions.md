# 12 — Server functions, and code that runs on one side

**Status: OPEN (2026-10-24).** Some code must run only on the server (it
reads a database, holds a secret) and some only in the browser (it reads
storage, measures the window). This document gives each a row, `server`
or `client`, and says what may cross between the two. It is the companion
of 10: there the whole mount runs on both sides and must agree (SV-3c, and
SV-7 below); here a piece of the program runs on one side only, and the
language makes the seam explicit instead of leaving it to a directive
string and a lexical extraction rule.

Solid's model, for reference: a `"use server"` function is extracted from
its lexical position, so it may reference only its parameters, locals,
module top-level bindings and globals; a module-level `"use server"`
makes every export a server function (`@solidjs/compiler`'s
`transformDirectives`). The rules below keep its runtime — the same pass
runs over the lowered output — and replace its lexical rule with a row
rule the checker can state precisely.

---

## SF-1 — Declaring a server function

- **SF-1a.** `server fn f(params) { … }` declares a function that runs on
  the server. Its body is a statement block (imperative scope, 01) that may
  `await` and ends in `return v`. It is a **loader**: like `fn`, it is not
  `io` (R-io-2) — its body may call `pure` and `server pure` JS (SF-5),
  other server `fn`s, and value functions, and nothing `io`. So it is safe
  to ask again, and a question may be built on it (SF-2b).
- **SF-1b.** `server action f(params) { … }` declares an action that runs
  on the server: the same block, and `io` — its body may call `io` and
  `server` JS (a database write). It is called only from imperative scope
  (R-io-3).
- **SF-1c.** Either may be `export`ed. In a `.d.rx` the signature is
  `export server fn f(a) rejects(C)` / `export server action f(a)` (MO-3,
  MO-8).

## SF-2 — Calling one

- **SF-2a (Always remote).** A call to a server function is a request to
  the server; its result is always a promise, so it is always awaited:
  `await f(x)` in imperative scope, or in an equation's tail (R-1).
- **SF-2b (A server `fn` is a question).** `user = await loadUser(id)` is an
  ordinary question (R-1, V-9): it is asked when `id` changes, held,
  refreshed (AC-4), and — in a served page — answered on the server during
  the mount, with the answer sent to the client like any other (SV-3b). On
  the server the call is a direct call; in the browser it is a request.
- **SF-2c (A server `action` is an action's await).** `let r = await
  save(form)` inside an action (AC-1): the action is one change across it,
  as across any awaited work.

## SF-3 — What a server body may name

- **SF-3 (Capture).** A server function's body may name its parameters and
  locals, and these module-level declarations: other server functions,
  value `fn`s, error classes, types, and imports (JS or `.rx`) whose rows
  allow it. It may **not** name reactive state — a `source`, an equation,
  a context, a component, a client action — wherever it is declared:
  `SERVER_CAPTURE` (bin S), naming the binding. A server function runs in
  its own request (SV-4): a module's sources there are that request's,
  holding their initializers, never the client's values; reading one would
  compile and quietly read the wrong world. What a server function needs
  from the client is an argument.

  (Solid's rule is lexical because a directive has no other information:
  module top-level is allowed, closures are not. Here the checker knows
  each binding's kind, so the line is drawn by what the binding is, not
  where it is written.)

## SF-4 — A server function does not write client state

- **SF-4 (`SERVER_WRITE`).** A write to a source in a server function's
  body is a compile error (bin S, 99 `SERVER_WRITE`). SF-3 already refuses
  naming the source; the write gets its own message because it is the
  mistake people make: *return the value, and write it in the action that
  awaited the call* — `let saved = await save(form); status := saved.status`.
  Nothing new is needed for this: an action's writes are its change (AC-1).

## SF-5 — Rows at the seam: `server` and `client` JS

- **SF-5a (`server` JS).** A JS export declared `export server pure fn
  q(…)` or `export server fn q(…)` in a `.d.rx` (MO-8), or imported with
  `import server pure { q }`, runs only on the server — it is not in the
  client bundle. It may be called only in a server function's body;
  anywhere else is `SERVER_ONLY` (bin S).
- **SF-5b (`client` JS).** A JS export declared `export client pure fn
  r(…)` (or imported with `import client pure { r }`) runs only in the
  browser. In imperative scope it is unremarkable — handlers, actions and
  effects run only in the browser (SV-2). In reactive scope it may only be
  awaited, and an equation that awaits it is a **client question**
  (SV-7b): the server never asks it, and the browser asks it once it has
  taken the page over.
- **SF-5c.** `server` and `client` are rows like `io` (R-io-1): inferred
  upward through `.rx` functions and components that call them, carried in
  signatures, and checked at each call. A `server` row reaching client
  code, or a `client` row reaching a server body, is the error at the call
  that crossed.

## SF-6 — What crosses the wire

- **SF-6a (Arguments and result).** A server function's arguments and its
  result cross between the two sides as data: copied, never shared
  (mutating a received object changes nothing on the other side), and only
  values the wire carries — no functions, no reactive accessors, no
  instances of undeclared classes. While types are text to the checker
  (07 §2), this is checked at run time (`WIRE_VALUE`, bin R, naming the
  function and the argument); with types, statically.
- **SF-6b (Failures).** A failure thrown in a server function reaches the
  caller as SV-5 says: a declared class with its class and fields, anything
  else as the generic `Error`. A call can also fail in transit, so every
  server function's row includes `fails(Error)` — a caller discharges it
  like any other `Error` (R-f-4).

## SF-7 — Where it runs in `ref/` (and in the product)

- **SF-7a.** The compiler lowers a server function to Solid's server
  function runtime: the `.rx` module's lowered JS goes through
  `transformDirectives` (`@solidjs/compiler`) with the function marked
  `"use server"`, exactly as a TSRX module does after `transform()`.
- **SF-7b.** The client runners of `ref/` (interpreter, oracle, compiled)
  have no network: a call runs the body in place, behind a wire that
  copies arguments and result (SF-6a) and redacts undeclared failures
  (SF-6b), so the semantics a scenario observes are the remote ones. The
  server runner calls it directly during the mount and over HTTP after
  hydration.

---

## Diagnostics this document adds

| code | bin | rule |
| --- | --- | --- |
| `SERVER_CAPTURE` | S | SF-3: a server function names reactive state |
| `SERVER_WRITE` | S | SF-4: a server function writes a source (99) |
| `SERVER_ONLY` | S | SF-5a: `server` JS called outside a server function |
| `CLIENT_IN_SERVER` | S | SF-5c: `client` JS reached from a server function |
| `CLIENT_QUESTION_UNHELD` | S | SV-7b: a client question read where nothing holds it |
| `WIRE_VALUE` | R | SF-6a: a value the wire cannot carry |

## Decisions taken by default (veto here)

1. **Spelling**: `server fn` and `server action`, not a directive string;
   `server`/`client` as import and `.d.rx` modifiers beside `pure`.
2. **A server `fn` is a loader** (not `io`, re-askable), a server `action`
   is `io`: the read/write split Solid's ecosystem draws between `query` and
   `action`.
3. **Capture is by kind** (SF-3), not by lexical position.
4. **Every server call can fail with `Error`** (SF-6b).
