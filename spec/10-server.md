# 10 — The server

**Status: OPEN (2026-10-24).** A program can be rendered on a server and
streamed to a browser, which then takes it over. This document says what
the server computes, what the browser shows while the stream arrives, what
crosses from server to client, and what state a request owns.
`ref/compile/rt-server.ts` is the server runtime the compiled modules run
against (solid-js 2.0's server build); `ref/ssr/run.ts` serves every
scenario's mount to Chromium and checks the frames. `S-server-1` covers it.

Rulings (2026-10-24): SSR is the client's mount, streamed; module state is
per request on the server; full hydration first (partial hydration later);
failures are sent to the client and panics are redacted. The rest is taken
by default — see the list at the end.

---

## SV-1 — The served page is the mount

- **SV-1a.** A request renders the entry module's mount (MO-1c) and
  streams it. The first chunk — the shell — is the **mount frame**: what
  the client would show at instant 0. Each later chunk is a **landing**: a
  `loading` region whose readers' flights have answered. The page the
  browser shows from the stream goes through the client's frames for the
  mount and its landings, in order.
- **SV-1b (Coalescing).** A frame may be skipped, never invented: two
  landings that reach the server within one flush arrive as one chunk, and
  an answer that arrives before the shell is sent is in the shell (the
  client would have shown the fallback first; the browser never does). The
  browser never shows a frame the client would not show at some instant of
  the same mount. (The one exception is DV-9, below.)
- **SV-1c (Held mount).** A reader whose `pending` no `loading` region
  catches holds the mount (H-2, CN-3c): the shell waits for it. On the
  server that is the right behaviour — the page arrives complete, with no
  skeleton — which is why CN-3c does not make it an error.
- **SV-1d (Streams).** A question over a stream (`await*`, R-1) is served
  with its first landing; the response stays open, and its later landings
  travel to the client as data, which applies them as landings once it has
  taken over (SV-3).

## SV-2 — What runs on the server

- **SV-2a.** The server computes what the mount frame needs: source
  initializers, equations (their awaits included), contexts and provisions,
  and the view. It runs nothing that belongs to an instant after the
  mount: no effect (neither half), no action, no handler, no cleanup. No
  source is written on the server, so every source holds its initializer
  (or its question's answer) for the whole request.
- **SV-2b.** So the served frame is the mount **before** any effect's
  writes. A program whose effects write at the mount (an effect chain,
  EF-5) shows the pre-effect frame from the server and the effect's frame
  once the client has taken over and run the effect — S-region-7 serves
  `0 valid` and the client goes on to `2 invalid`. Both are client frames
  (SV-1b holds); the second simply comes after hydration.

## SV-3 — Hydration (ruled: full hydration first)

- **SV-3a.** The client takes over the served page by running the same
  mount against the HTML instead of building it: every element and text the
  view would create is adopted from the page. The whole tree hydrates
  (partial hydration — leaving static parts unhydrated — is later).
- **SV-3b (Answers cross).** Every question the server answered is answered
  on the client with the server's answer, sent in the stream; it is not
  asked again. A question still pending when the client takes over
  continues: its landing streams to the client. A failure crosses as SV-5
  says.
- **SV-3c (Determinism).** Everything else is recomputed on the client
  from those answers and the initializers, and must come out the same.
  Inside `.rx` it does: there is no io in reactive scope (R-io-3), so an
  equation is a function of its inputs. The JS boundary is the exception —
  a `pure` import is the author's assertion (CN-5), and a `pure` function
  that is not deterministic (the time, a random number) yields a different
  frame on each side: `HYDRATION_MISMATCH`, a runtime diagnostic (bin R).
- **SV-3d.** After hydration the client is an ordinary client: effects run
  their first instant (SV-2b), handlers are attached, and every later
  instant is the client's.
- **SV-3e (Input before hydration — taken by default).** An event the
  user causes before the client has taken over is replayed after it, in
  order (Solid's delegated-event replay).

## SV-4 — State is per request (ruled)

- **SV-4.** On the server, an app is a request. Each request instantiates
  every module once (MO-1b) — its module-level sources, equations and
  contexts — and nothing in them is shared with another request. A
  cross-request cache is a JS module's business, behind an import, never a
  `.rx` module's state. The compiler emits each `.rx` module as a factory
  the runtime runs once per app (09, Implementation), so no module state
  exists at JS module scope. (S-server-1: a second request, in flight at
  the same time, keeps its own shell while the first one's questions land.)

## SV-5 — What crosses: failures sent, panics redacted (ruled)

- **SV-5a.** A failure whose class is declared — `error C(…)` in a `.rx`
  module (R-f-1) or `export error C` in a `.d.rx` (MO-8) — that reaches a
  boundary or a catch on the server is sent to the client as it is: its
  class, its message and its fields. The client reconstitutes it as that
  class, so a typed boundary or catch decides the same on both sides.
- **SV-5b.** Anything else that reaches a boundary is sent as the generic
  error: an `Error` whose message is Solid's `Internal Server Error`. That
  is every panic (R-f-3), and a rejection of an undeclared class — a JS
  import without a declaration rejects with plain `Error` (R-f-8). The
  generic error is an `Error`, so the boundary that discharges it is the
  one that would discharge the original (`Error` or untyped, R-f-10): the
  static failure check is unchanged by where the program runs. Only the
  message and the fields stay on the server.
- **SV-5c.** So what may leave the server is decided by declarations: to
  send a JS module's failure, declare its class in the module's `.d.rx`
  (MO-8); to redact one of the program's own, throw a panic or a JS
  `Error` instead of a declared class.

## SV-6 — A failed boundary is served drawn

- **SV-6.** A boundary that takes a failure during the server render — in
  the shell or in a later chunk — is streamed with its fallback rendered:
  the browser shows the client's frame (`no user 7`, S-server-1 instant 1).
  **DV-9:** Solid 2.0 (rc.16) does not; see below.

---

## Divergences from Solid's server render (`ref/ssr/`)

- **DV-9 (a failed boundary on the server) — open, reproduced
  2026-10-24** (`ref/oracle/repros/dv9-ssr-after-shell.mjs`). Outside a
  server component, Solid renders no error fallback on the server. A
  boundary that fails before the shell is empty in the HTML; one that fails
  after it is streamed as an empty fragment, which replaces the loading
  fallback with nothing. In both cases the error is serialized for the
  client, which draws the fallback when it hydrates — so the browser shows
  a frame no client instant shows (`Profile` where the client shows
  `Profile no user 7 error: …`), until hydration. Inside
  `runInServerComponentScope` the fallback is rendered on the server and
  every frame is the client's: `SV_SCOPE=1 npm run -s ssr` shows all
  scenarios passing without the `server` divergences. Recorded as `server`
  divergences in S-server-1, S-hold-5, S-solid-38 and S-ai2-settings.
  Question for Solid: is the client-only fallback intended for client
  components (it keeps a fallback that needs the client — a reset handler —
  correct), and could the server render the fallback and let hydration
  adopt it?

## Diagnostics this document adds

| code | bin | rule |
| --- | --- | --- |
| `HYDRATION_MISMATCH` | R | SV-3c: a `pure` JS function computed differently on the two sides |

## Implementation

- `ref/compile/rt-server.ts` implements the `__rt` API the compiled
  modules call, over the server build of `solid-js` and `@solidjs/web`
  (`ssr`, `escape`, `renderToStream`). The same compiled modules run on
  both sides; only the runtime differs. Effects, actions, `refresh` and
  `affects` are inert or refused there (SV-2); a declared class's instances
  are marked with Solid's `markSafeError`, which is how Solid decides what
  `ssrSanitizeError` lets through (SV-5); module factories are cached per
  app (SV-4).
- `ref/ssr/run.ts` (`npm run -s ssr`) serves each scenario's program over
  HTTP to Chromium (Playwright) and lands its flights as the rows say,
  reading the browser's visible text after the shell and after each
  landing. For every table it serves the rows up to the first handler and
  checks SV-1 against the client's frames (every row of an effect chain is
  a candidate, SV-2b; a panic's message may be redacted, SV-5b). A
  `## Server frames` table is checked row by row, and alongside it a second
  request for the same page is rendered concurrently and must keep its
  shell (SV-4).
- **Not executable yet:** hydration (SV-3) — the client runtime renders
  through `@solidjs/universal`, which builds and does not adopt; and the
  client side of SV-5a, reconstituting a sent failure as its class. Solid
  serializes an error subclass as `Object.assign(new Error(msg), { name })`
  plus its own fields, which loses the class; and two modules may declare
  classes of the same name, so the identity sent must be the declaration's
  (module and name), not `name`.

## Decisions taken by default (veto here)

1. **Plain `Error` is redacted** (SV-5b). The ruling sends failures; a
   rejection from an undeclared JS import is a failure of class `Error`
   for the checker (R-f-8), but its message is whatever the JS library put
   there (a database error, a path), so it is sent as the generic error.
   Declaring the class (MO-8) is how to send it.
2. **No effect runs on the server** (SV-2), not even the compute half, and
   the served frame is the pre-effect mount.
3. **Input before hydration is replayed** (SV-3e).
4. **A stream question keeps the response open** (SV-1d) and sends its
   later landings as data.
