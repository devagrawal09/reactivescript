# 10 — The server

**Status: OPEN (2026-10-24).** A program can be rendered on a server and
streamed to a browser, which then takes it over. This document says what
the server computes, what the browser shows while the stream arrives, what
crosses from server to client, how the client takes over, and what state a
request owns. The same modules run on both sides — views lowered by Solid's
own compiler (`@solidjs/compiler`, `generate: "ssr"` and `"dom"`,
hydratable), the reactive lowering over `ref/compile/rt-server.ts` and
`ref/compile/rt-web.ts` — on Solid's `next` branch built from source
(`ref/SOLID_NEXT`). `ref/ssr/run.ts` serves every
scenario to Chromium, hydrates it, and drives the rest of its rows in the
browser. `S-server-1` covers what no other scenario does.

Rulings (2026-10-24): SSR is the client's mount, streamed; module state is
per request on the server; full hydration first (partial hydration later);
failures are sent to the client and panics are redacted. The rest is taken
by default — see the list at the end.

---

## SV-1 — The served page is the mount

- **SV-1a.** A request renders the entry module's mount (MO-1c) and
  streams it. The first chunk — the shell — is the **mount frame**: what
  the client would show at instant 0. A later chunk is a **landing** of a
  `loading` region: its readers' flights have answered and the region's
  content replaces its fallback. The page the browser shows from the stream
  goes through the client's frames for the mount and its landings, in
  order.
- **SV-1b (Coalescing).** A frame may be skipped, never invented: two
  landings that reach the server within one flush arrive as one chunk, and
  an answer that arrives before the shell is sent is in the shell (the
  client would have shown the fallback first; the browser never does). The
  browser never shows a frame the client would not show at some instant of
  the same mount — DV-9 is Solid's exception.
- **SV-1c (What streams).** Only a `loading` region's landing streams as
  HTML: the stream fills a hole the shell left. An answer the shell already
  painted around — a first paint (`-> v`, R-7), a lane reader (H-7) — has no
  hole: it travels as data, and the client draws it when it takes over
  (S-app-cart: the catalogue lands on the server, the browser keeps the
  empty first paint, and the client draws the rows at hydration). That is
  SV-1b's skipped frame, not an exception.
- **SV-1d (Held mount).** A reader whose `pending` no `loading` region
  catches holds the mount (H-2, CN-3c): the shell waits for it. On the
  server that is the right behaviour — the page arrives complete, with no
  skeleton — which is why CN-3c does not make it an error.
- **SV-1e (Streams).** A question over a stream (`await*`, ST-6b) is served
  with its first landing; the response stays open, and its later landings
  travel to the client as data, which applies them as landings once it has
  taken over (SV-3). A plain `await` takes one answer, so its question
  closes when it lands.

## SV-2 — What runs on the server

- **SV-2a.** The server computes what the mount frame needs: source
  initializers, equations (their awaits included), contexts and provisions,
  and the view. It runs nothing that belongs to an instant after the
  mount: no effect's apply half, no action, no handler, no cleanup. No
  source is written on the server, so every source holds its initializer
  (or its question's answer) for the whole request. An effect's compute
  half is reactive scope — whether the server computes it is unobservable
  (Solid's server does; an input's failure is an answer there too, E-12).
- **SV-2b.** So the served frame is the mount **before** any effect's
  writes. A program whose effects write at the mount (an effect chain,
  EF-5) shows the pre-effect frame from the server and the effect's frame
  once the client has taken over and run the effect — S-region-7 serves
  `0 valid` and the client goes on to `2 invalid`. Both are client frames
  (SV-1b holds); the second simply comes after hydration.

## SV-3 — Hydration (ruled: full hydration first)

- **SV-3a (Adoption).** The client takes over the served page by running
  the same mount against the HTML instead of building it: every element and
  text the view would create is adopted from the page, and where the client
  draws what the server drew, it builds nothing. The whole tree hydrates
  (partial hydration — leaving static parts unhydrated — is later).
- **SV-3b (Answers cross).** Every question the server answered is answered
  on the client with the server's answer, sent in the stream; it is not
  asked again. A question still pending when the client takes over
  continues: its answer streams to the client. A question whose input
  changes on the client is a new question, and the client asks it — DV-11
  is Solid's exception. A failure crosses as SV-5 says.
- **SV-3c (Determinism).** Everything else is recomputed on the client
  from those answers and the initializers, and must come out the same.
  Inside `.rx` it does: there is no io in reactive scope (R-io-3), so an
  equation is a function of its inputs. The JS boundary is the exception —
  a `pure` import is the author's assertion (CN-5), and a `pure` function
  that is not deterministic (the time, a random number) yields a different
  frame on each side: `HYDRATION_MISMATCH`, a runtime diagnostic (bin R).
- **SV-3d.** After hydration the client is an ordinary client: effects run
  their first instant (SV-2b), handlers are attached, and every later
  instant is the client's. A client may take over at any point of the
  stream — right after the shell, or after the last landing — and the
  frames from then on are the client's frames.
- **SV-3e (Input before hydration).** An event the user causes before the
  client has taken over is recorded and replayed after it, in order,
  through the handlers the client has just attached (Solid's hydration
  bootstrap and delegated-event replay). Each replayed event is **its own
  instant**, as it would have been live: a program cannot tell a replayed
  click from a user's, so two clicks on a counter are two bumps
  (S-server-2). DV-14 is Solid's exception.

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
  class, its message and its fields. The client gives it back its class,
  so a typed boundary or catch decides the same on both sides (S-server-1:
  the `NotFound` boundary takes the `NotFound` the server sent). A class is
  identified by its declaration, not its name: two modules that each
  declare `NotFound` declare two classes (as two contexts, MO-7).
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
- **SV-5d.** A panic is redacted where it happens. If the client takes over
  first and computes the same panic itself, its own boundary shows its own
  message — nothing came from the server (S-server-1 hydrated after the
  shell: `error: db password is hunter2`, computed in the browser).

## SV-6 — A failed boundary is served drawn

- **SV-6.** A boundary that takes a failure during the server render — in
  the shell or in a later chunk — is streamed with its fallback rendered:
  the browser shows the client's frame (`no user 7`, S-server-1 instant 1),
  and the client adopts it and keeps tracking the failed content, so it
  recovers like any boundary (D-39). DV-9 and DV-12 are Solid's.

---

## Divergences from Solid's server render and hydration (`ref/ssr/`)

Each has a standalone repro with nothing of ReactiveScript in it — one
`app.jsx` compiled by `@solidjs/compiler` for both sides — in
`ref/oracle/repros/`, re-run on `next` @ `2a0da2f`.

- **DV-9 (a failed boundary on the server) — reproduced 2026-10-24**
  (`dv9-ssr-after-shell.mjs`, `dv9-hydrate/`). Outside a server component,
  Solid renders no error fallback for a failure that reaches a `<Loading>`
  through an async read. A boundary that fails before the shell is empty in
  the HTML; one that fails after it is streamed as an empty fragment, which
  replaces the loading fallback with nothing — so the browser shows a frame
  no client instant shows (`Profile` where the client shows `Profile no
  user 7 error: …`). The error is serialized, but when the client hydrates
  it renders that boundary from scratch: it asks the question again and
  shows the loading fallback, never the failure it was sent. Inside
  `runInServerComponentScope` the fallback is rendered on the server and
  every served frame is the client's (`SV_SCOPE=1 npm run -s ssr`).
  Recorded as `server` divergences in S-server-1, S-hold-5, S-solid-38 and
  S-ai2-settings; their hydrations after the failure are reported `≠ DV-9`.
  (A failure thrown synchronously in content the server renders is drawn —
  S-hold-6 serves `item 4 not found`.)
- **DV-11 (the hydration window) — reproduced 2026-10-24**
  (`dv11-hydrate/`). Until the server has finished a node's answer, Solid's
  client keeps the node on the server's answer even when its inputs change
  on the client: a `<Loading>` whose content the server is still streaming
  stays on its fallback after the client's own new answer lands (S-solid-24
  hydrated after the mount: `1 loading` where the rule says `1 1`), and a
  stream (an async iterable) is read from the server until it ends — the
  new question is never asked, and the old stream's landings show
  (S-store-5: `a3 -` where the rule says `a2 p`; S-ai-feed). Recorded as
  `hydrated` divergences.
- **DV-14 (replay is one instant) — reproduced 2026-10-24**
  (`dv14-replay-instant/`). `runHydrationEvents` runs the recorded queue in
  one microtask with no flush between events, so handlers replayed together
  share an instant: two clicks whose actions each write `n := n + 1` both
  read `n` = 0 (H-10) and the counter reads 1 where a live user would have
  read 2. A flush between replayed events would make each its own instant.
  Recorded as a `hydrated` divergence in S-server-2's `## Before
  hydration` table.
- **DV-12 (a boundary hydrated in its error state) — reproduced
  2026-10-24** (`dv12-hydrate/`). The client hydrates an error boundary the
  server drew by throwing the server's error in place of running its
  content, so the boundary reads nothing: when the failed content's inputs
  change and a good answer lands, the boundary keeps the failure (the
  question is asked and answered; nothing is listening). The same page
  rendered by the client recovers. S-hold-6 hydrated: `item 4 not found`
  where the rule says `loading…`, then `pear`. Recorded as a `hydrated`
  divergence.

Questions for Solid: is the client-only fallback (DV-9) intended for client
components, and could the server draw the fallback and the client adopt it?
DV-11 and DV-12 look like bugs: a hydrated node should follow its inputs
once they change, and a hydrated error boundary should track the content it
did not run.

## Diagnostics this document adds

| code | bin | rule |
| --- | --- | --- |
| `HYDRATION_MISMATCH` | R | SV-3c: a `pure` JS function computed differently on the two sides |

## Implementation

- **Views are Solid's compiler's.** The emitter writes each view as JSX
  (text as string children, `{e}` as `{__rt.show(e)}`, control flow as
  `Show` / `For` / `Loading` / `Errored`), and `@solidjs/compiler` lowers it:
  hydration keys, marker regions, which holes are scoped and which fragment
  entries are memos, all as `documentation/hole-owner-id-matrix.md` on
  `next` specifies. (Before 2026-10-24 the runtimes built views by hand,
  copying the compiler's output; that copy is gone.)
- **The reactive lowering, one call sequence.** Hydration finds the
  server's answers by owner id, so `rt-server.ts` and `rt-web.ts` implement
  the same `__rt` API with the same solid-js primitives in the same order,
  and where the client creates an owner the server has no counterpart for
  (a value-level error boundary for `e catch …` takes two ids, a typed
  boundary's unwrapping memo one), the server reserves its ids. A context's
  default is created at its declaration, on both sides, rather than at its
  first use (which happens at different times on the two). A value-level
  catch that Solid provided on both sides would retire the reservations.
- **Failures.** A declared class's instances are marked with Solid's
  `markSafeError` (which is how `ssrSanitizeError` decides what to send) and
  carry their declaration's identity in a `$class` field, assigned in
  declaration order — the same on both sides. Solid serializes an error as
  `Object.assign(new Error(msg), { name, …fields })`, which loses the
  class; the client's class test gives it back by `$class`.
- **The runner** (`npm run -s ssr`): for every table, (1) serves the rows up
  to the first handler and checks the browser's frames against the
  client's (SV-1); (2) hydrates after the last landing and (3) right after
  the shell, then drives every remaining row in the browser — handlers, and
  landings of flights on whichever side asked them — checking the client's
  frames (SV-3d); at each hydration, that no element was rebuilt where the
  frame did not change and that no question was asked again (SV-3a,
  SV-3b; Solid traces a hydrated computation under a mocked `fetch` and
  `Promise`, which the harness recognises and does not count), with the
  client on Solid's dev build, whose key-miss, tag-mismatch and
  unclaimed-node reports fail the table; (4) with
  `CSR=1`, also mounts the same bundle on an empty page — the baseline that
  separates a hydration difference from a renderer one. A `## Server frames`
  table is checked row by row, with a concurrent second request (SV-4).
  A `## Before hydration` table drives the served page as a user would —
  `click "<selector>"`, `input "<selector>" "<text>"` — before a `hydrate`
  row takes it over, then checks each frame (SV-3e).
- **Not exercised yet:** `HYDRATION_MISMATCH` (no scenario imports a
  nondeterministic `pure` function).

## Decisions taken by default (veto here)

1. **Plain `Error` is redacted** (SV-5b). The ruling sends failures; a
   rejection from an undeclared JS import is a failure of class `Error`
   for the checker (R-f-8), but its message is whatever the JS library put
   there (a database error, a path), so it is sent as the generic error.
   Declaring the class (MO-8) is how to send it.
2. **No effect's apply half runs on the server** (SV-2), and the served
   frame is the pre-effect mount.
3. **A replayed event is its own instant** (SV-3e). Solid's replay is one
   instant (DV-14); the rule is what a live user would have caused.
4. **A stream question keeps the response open** (SV-1e) and sends its
   later landings as data.
