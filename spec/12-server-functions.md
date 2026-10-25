# 12 — Server functions, and code that runs on one side

**Status: executable, 2026-10-24** — SF-1–SF-6 by S-sf-1, SF-5b's client
questions (10 SV-7b) by S-server-3, on all four runners; after hydration
each call is an HTTP request to Solid's server-function handler (SF-7b). Some code must run only on the server (it
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

## SF-1 — Declaring a server function (one form; ruled 2026-10-24)

- **SF-1a.** `server fn f(params) { … }` declares a function that runs on
  the server. Its body is a statement block (imperative scope, 01) that may
  `await` and ends in `return v`.
- **SF-1b (io is inferred).** A server fn is `io` when its body calls `io`
  — JS declared io (a database write), `log`, or a server fn that is — and
  not otherwise. The row is the body's, as an `.rx` export's rows are its
  declaration's (MO-3); nothing is written at the declaration. There is no
  second form: what Solid's ecosystem splits into `query` and `action` is
  how the function is *called* (SF-2), and whether that call is allowed is
  the row.
- **SF-1c.** A server fn may be `export`ed; an importer sees it in the
  module's signature (MO-3) with its io row and its rejections. A JS
  module's own `"use server"` functions are ordinary JS here: a `.d.rx`
  declares them like any export (`export pure fn load(id)`, `export fn
  save(x)`), and their wire is the JS side's. (`server` in a `.d.rx` means
  SF-5a's server-only JS, which a client cannot call at all.)

## SF-2 — Calling one: the call site decides

- **SF-2a (Always remote).** A call to a server function is a request to
  the server; its result is always a promise, so it is always awaited.
- **SF-2b (In reactive scope, a question).** `user = await loadUser(id)` is
  an ordinary question (R-1, V-9): asked when `id` changes, held, refreshed
  (AC-4), one request per arguments while it stands, and — in a served
  page — answered on the server during the mount, with the answer sent to
  the client like any other (SV-3b). A question may be asked again, so an
  `io` server fn here is `IO_IN_REACTIVE` (R-io-3), and the message names
  the call in its body that made it io.
- **SF-2c (In imperative scope, a request).** `let r = await save(form)`
  inside an action (AC-1) is one request per call — two calls with the same
  arguments are two requests — and the action is one change across it, as
  across any awaited work. Any server fn may be called here, io or not.

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

- **SF-7a (Lowering).** A server fn is emitted at module level as a
  `"use server"` function, and the module's lowered JS goes through Solid's
  `transformDirectives` (`@solidjs/compiler`), exactly as a TSRX module does
  after `transform()`: the server build keeps and registers it, the browser
  build replaces it with a reference that calls the server. Solid's rule
  for that extraction is lexical — the function may name only its
  parameters, its locals and module-level bindings — and SF-3 is what
  makes it always satisfiable: everything a body may name (imports, error
  classes, other server fns) is module-level, so the compiler emits it
  there, and nothing reactive can be among it. A module's error classes are
  the module's (one class however many apps), so the class a body throws is
  the class a caller's catch tests. The call site keeps its own wrapper
  (SF-2: question or request).
- **SF-7b (In `ref/`).** The client runners (interpreter, oracle,
  compiled) have no network: the body runs in place behind a wire that
  copies arguments and result (SF-6a) and redacts undeclared failures
  (SF-6b), so a scenario observes the remote semantics. The server runner
  is the real thing: during the mount the server calls the function
  directly inside the page's request event; after hydration — and on a
  page the browser renders alone — each call is an HTTP request to
  Solid's `handleServerFunctionRequest` (`@solidjs/web/server-functions`),
  run in a request of its own (SV-4), and the runner checks that no server
  body is in the browser bundle. (S-sf-1: four requests after hydration.)
---

## Diagnostics this document adds

| code | bin | rule |
| --- | --- | --- |
| `SERVER_CAPTURE` | S | SF-3: a server function names reactive state |
| `SERVER_WRITE` | S | SF-4: a server function writes a source (99) |
| `SERVER_ONLY` | S | SF-5a: `server` JS called outside a server function |
| `CLIENT_IN_SERVER` | S | SF-5c: `client` JS reached from a server function |
| `CLIENT_QUESTION_UNHELD` | S | SV-7b: a client question read where nothing holds it |
| `CLIENT_NOT_AWAITED` | S | SF-5b: `client` JS called for its value in reactive scope |
| `WIRE_VALUE` | R | SF-6a: a value the wire cannot carry |

## Decisions taken by default (veto here)

1. **Spelling**: `server fn`, not a directive string; `server`/`client` as
   import and `.d.rx` modifiers beside `pure`.
2. *(Ruled 2026-10-24: one form.)* A server fn's io row is inferred from
   its body (SF-1b), and the call site decides question or request (SF-2).
   An earlier draft had `server fn` (a loader) and `server action` (io);
   the split said nothing the row and the call site do not.
3. **Capture is by kind** (SF-3), not by lexical position.
4. **Every server call can fail with `Error`** (SF-6b).
