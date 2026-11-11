# Slice 6: the frames server (inferred server components over Solid 2's Frames)

A Rust server answers a plan v2.2 app as Solid 2's own server answers its canonical split: the t=0 document (the
inline `<solid-frame>`s, the `sc-` hydration keys, the `_$SC` references, the `sc:live`, `sc:slot:*` and `sc:deps:*`
records), every frame stream (`start`, `slot:*`, `""` with its digest, `:complete`), every data response and the
sanitized error, the CSRF 403, and the server host calls behind them, byte for byte and call for call. Solid's client
builds hydrate the Rust document in Chromium, mount the Rust frame streams and run the scenario on. The server is a
structural port of what Solid's server builds run for a frames app (`crates/runtime/src/frames/`, every ported body
with its `// Solid: file.ts:lines` comment), on top of slice 5's server port (`crates/runtime/src/ssr/`, `docs/SSR.md`).
Reference: solid-next `2105ffb8` (2.0.0-rc.21), production builds; `server.ts` is
`packages/web/server-functions/src/server.ts`, `shared.ts` its `shared.ts`, `frame-sink.ts` is
`packages/web/frames/src/frame-sink.ts`. The oracle (Solid's own server for the explicit split, Chromium) is the
frontend's: `frontend/frames/`, `frontend/docs/RESULTS.md`, "Slice 6", and `docs/SLICE6-FRAMES.md` (the design).

## Three readiness levels (kept apart)

- **Syntax we recognize.** Not this folder: the frontends and the v2.2 builder (`frontend/plan/resolve-frames.ts`,
  `placement.ts`). Every plan `frames::plan::validate` accepts reaches the server, which refuses the forms below with a
  diagnostic.
- **Verified subset.** The tracker-frames slice and the placed programs of the placement fuzz's generator (seeds
  1..3000): on every one, the R leg (this server, with Solid's build of the plan's client split) equals N (Solid's server
  for the oracle's explicit split) on the document, every frame stream, every data and error response (status, headers
  in order, body chunks as flushed), the server host log, the client request log, every frame and the DOM after every
  step, and the dev builds hydrate it with no warning (the slice). Forms the generator does not produce are not verified
  even when they render.
- **Full readiness.** Not claimed. See "Not ported" and "Next".

## Files

| file | what |
| --- | --- |
| `crates/runtime/src/frames/plan.rs` | plan v2.2's serde types (server hosts, server fns, components with typed props, server components with their question, slots and inline components, the placement table) and `validate` |
| `crates/runtime/src/frames/shared.rs` | `createChunk`, `textDigest`, `frameAddress`/`hashArguments`/`stableString`, base36, `JSON.stringify` of wire values (3 unit tests) |
| `crates/runtime/src/frames/hosts.rs` | the server hosts under an answer script recorded from N's server host log: each call matched to the next answer for its host (one-based, over the server's lifetime), its arguments checked, its value or plain `Error` returned, every call logged as `frames/host-table.mjs` logs it; a call the script does not answer fails the server |
| `crates/runtime/src/frames/render.rs` | a component instance's markup on the server, both faces (client components and inline server-only components; a server component's own body), islands as slot applications, the evaluator over plan expressions |
| `crates/runtime/src/frames/server.rs` | the server functions and server components (`call_server_fn`, `call_server_component`), the endpoint (`handleServerFunctionRequest`'s frames paths), `respondThrown`, the frame stream (`serverComponentResponse` over `renderServerComponent`, `createFrameSink`, `createSlotProps`) |
| `crates/runtime/src/frames/document.rs` | the t=0 document: the direct call's promise chain, `frameTransformDirectResult`, `createDocumentSlotProps`, `armDocumentLiveHoles`, `dynamicComponent`, the owned-root client stub |
| `crates/runtime/src/frames/http.rs` | a std `TcpListener` server for the harness: `/` (the document), `/_server/*` (the endpoint), `/__log` (host log, document calls, wire records), one request at a time in arrival order |
| `crates/runtime/src/bin/frames-server.rs` | `frames-server PLAN.json ANSWERS.json`: prints `{"port":N}`, then serves |
| `crates/runtime/tests/frames.rs` | 6 tests over `tests/fixtures/frames/` (below) |

Slice 5's port gained what a frames document needs (each with its `// Solid:` lines): thenable adoption of a generic
thenable (`ssr/js.rs`), a thenable result in `processResult` and `$rows` brands on `mapArray`'s output
(`ssr/signals.rs`), the derived render context, `escapeLate`'s inner flag, the live-hole engine's content positions and
`$slot` suppression (`ssr/web.rs`), the brand table (`components`, `streams`, `rows`, `slots`, keeping the branded values
alive) and the `LiveChannel` trait (`ssr/mod.rs`), the server-component scope and `NoHydration` on owners
(`ssr/owner.rs`), the stream's `live` arming and end (`ssr/stream.rs`), and seroval's `ServerComponent`,
`ReadableStream`, stream factory and constructor nodes (`ssr/seroval.rs`; the constructor and factory sources are
seroval 1.7.0's own text as Solid's server emits it, `ssr/seroval_*.txt`). None of it changes a slice 5 output: every
recorded SSR fuzz summary is byte-identical (below).

## The endpoint

`server.rs` ports `handleServerFunctionRequest` (server.ts:4480-5258) on the paths a frames app's client reaches:

- the address (`parseServerFunctionAddress`, shared.ts:632-654) `/_server/data/<id>`; the id is a server fn's or a
  server component's wire id (from the plan, which took it from Solid's `transformDirectives`); an unknown id is the
  labelled 404 (`X-Server-Function-Unknown: true`, no body), before the gate;
- the CSRF gate (`allowsServerFunctionRequest`, server.ts:4144-4192, no allowlist): `Sec-Fetch-Site: same-origin`
  admits; `none`, `same-site`, `cross-site` refuse; else `Origin`, else `Referer` must be the request's origin; none of
  the three refuses; a refusal is the bodiless 403 (`forbiddenResponse`) with `Vary: Sec-Fetch-Site, Origin, Referer`;
- POST only (405 with `Allow: POST`); the arguments (`parseArguments`, server.ts:2101-2245) in the client runtime's
  formats `1` (one string) and `8` (a JSON list), or no body;
- the result (`encodeResult`, server.ts:3767-3869): a string as format `1` (`text/plain`), other JSON-safe data as
  format `8`; a server component's result through `frameTransformResult` as a frame stream (`X-Frame-Stream: <id>`,
  `X-Content-Raw: 1`, `application/x-frame-stream`); a throw as `respondThrown` (server.ts:694-717): the generic
  `Error("Internal Server Error")` as one seroval JSON node, chunked, format `0`, status 500, the message on
  `X-Server-Function-Error`;
- `finalizeTransportResponse` (server.ts:5383-5429) on every exit: `Cache-Control: no-store`,
  `X-Content-Type-Options: nosniff`, the CSRF `Vary`; headers in Fetch `Headers` order (lowercased, sorted).

Refused with a diagnostic (the HTTP server answers it as a 500 whose body names it): the live address, `?args=`
encodings, the bare (no-JS form) address, format `0` and the other argument encodings, flight data, GET-declared
reads.

## Frame streams

A server component's response (`serverComponentResponse`, frame-sink.ts:2976-3097, over `renderServerComponent`
1020-1063 and `frameStream` 1076-1230): `start` with the response's version; the synchronous render pass under
`serverOwned` (`NoHydration`, frame-sink.ts:175-184) and `serverComponentScope` (a transparent owner), whose slot
applications (`createSlotProps`, frame-sink.ts:2646-2950) mint occurrences (`occurrenceId`, 1295-1302), send each
`slot:<K>#<n>` record with its scalar arguments and return the marker range (`slotRange`, 1232-1237); the batch flushed
(`flush`, 442-449; `put`, 450-468); the shell's root record with its digest over the skeleton (`shell`, 621-659,
`textDigest`); `:complete` (`end`, 800-812); each message as `createChunk` (`;0x<8 hex>;JSON`, shared.ts:1243-1255).
The render has its own derived context with the live-hole engine on (`ctx.liveHoles`, mode 2), so every hole inside a
server-component `For` row carries its `<!--lr-->` row marker as Solid's does. A server component's body awaits its
question and then renders synchronously (v1: no `Loading` inside a server component, M8), so the stream has exactly
these four kinds of message.

## The t=0 document

`document.rs` renders the canonical split's client module under `renderToStream(() => createComponent(App, {}), {
plugins: [ServerComponentPlugin] })`, with `transformDirectResult: frameTransformDirectResult`, inside the harness's
page (`frontend/frames/leg-server.ts`: `<!doctype html><html><head>` + `generateHydrationScript()` + `</head><body><div
id="app">` + the stream + `</div></body></html>`):

- **The direct call** (`createServerReference`'s `apply`, server.ts:1448-1580): the body as an async function, then the
  five reactions its promise takes (`reportDirectFailure`, `provideEventOnce`, `directEnvelopeValue`, the deferred-body
  binding, the direct transform), one microtask each, so the document's chunks interleave with other async work as
  Solid's do. A server fn's body is `let x = await h(…)`… `return e` over the hosts' answers; a server component's body
  awaits its question, binds its memos as `const`s and returns the component.
- **`frameTransformDirectResult`** (frame-sink.ts:2368-2436): the wrapped component and its brands, `documentSiteId`
  (2083-2098), the `<solid-frame data-fid data-fa>` element (`frameElementOpen`, 2053-2058), `serverOwned`,
  `armDocumentLiveHoles` (2171-2333: the `sc:live` channel, a `ReadableStream` the hydration data serializes, and its
  end), the derived context, `serverComponentScope`.
- **`createDocumentSlotProps`** (frame-sink.ts:1561-2039) for scalar slot arguments: the declared `sc:slot:` record,
  the fill rendered under `Hydration` with `sc-<frame>-<occurrence>-` keys, the marker range, the `sc:deps:` batches
  (`noteDeps`, 1576-1602; `packOccurrences`, 1455-1476).
- **`dynamicComponent`** (solid `src/server/dynamic.ts:48-176`): its factory, value and render memos; the sunk roots'
  frames are created in the entry's body after its memos, as the split declares them.
- **Owned roots.** An owned question's site is its client stub `<C>$frame(props)` (the split's spelling, `plan/split.ts`):
  under the site's owner (a server `createComponent` is a plain call), a memo calling the server component with the
  site's wire props (getters over the site's arguments), `dynamicComponent` over it, the frame applied with the slot
  fills. So the question belongs to the component instance, as on the all-client twin (a site under a `Show` that is
  hidden asks nothing).
- **Seroval.** `ServerComponentPlugin`'s node for a server component reference, the `ReadableStream` node with seroval's
  stream factory and constructor, `iterate_async` for the `sc:live` channel, and the bootstrap once per serialize.

## Tests and fixtures

`tests/frames.rs` replays `tests/fixtures/frames/*.json` without Node. The fixtures are written by the frontend's
`scripts/frames-corpus.ts` from runs of N on Solid's server wiring: the tracker-frames slice's scenario plus a request
without fetch metadata (403), and placement-fuzz programs with server roots, one per seed that adds a site recipe
(record, record with an inline component, structured or reactive island arguments, count, owned, top lists with
stateless and stateful islands, pair, static, boundary). Each holds the plan, the answer script recorded from N's
server host log, every request (method, target, header pairs, body) with Solid's response, N's host log and its
document's outermost server calls.

1. Every fixture's requests, in arrival order, get Solid's responses byte for byte (status, headers, chunks), the
   script answers every host call, and the host log and the document's calls are N's (10 fixtures, 59 exchanges: 10
   documents, 11 frame streams, the data, error and 403 responses).
2. The slice's fixture covers every response kind: 200, 500 (the sanitized throw) and 403; HTML, frame stream, JSON
   and text bodies.
3. A script whose answers do not match fails the server closed instead of answering.
4. A changed byte in Solid's response is a difference (the comparison is not vacuous).
5. The CSRF gate admits same-origin requests only, by each of the three signals, and refuses with the exact 403.
6. The endpoint's refusals: the labelled unknown-id 404, the 405, and diagnostics for the bare, live and `?args=`
   addresses.

Beside them, `src/frames/shared.rs` has 3 unit tests (`createChunk`'s byte lengths, `textDigest` of the empty string,
`frameAddress`/`hashArguments`/base36 by hand, `JSON.stringify`'s spelling). `cargo test`: 175 (166 before, none deleted).

The page side runs in the frontend: `slices/tracker-frames.test.ts` (R against N: document, frame streams, data and
error responses byte for byte; frames, requests, host log, DOM; the dev builds; the 403) and the placement fuzz's R leg
(`frontend/frames/fuzz/run.ts`), whose results are in `docs/frames-fuzz/` and below.

## Placement fuzz, the R leg

The fuzz (`frontend/scripts/frames-fuzz.ts --rust …/frames-server`) runs R on every program the builder places,
against N, with the answer script recorded from N's own run. Summaries: `docs/frames-fuzz/summary-1-1000.json` and
`summary-1001-3000.json` (copies of the frontend's `.out/frames-fuzz/run-*/summary.json`).

| seeds | programs the legs ran | R = N | R differs |
| --- | --- | --- | --- |
| 1..1000 | 891 | 889 | 2 (675, 932) |
| 1001..3000 (held out) | 1790 | 1788 | 2 (1595, 2077) |
| 1..100 (gate) | 93 | 93 | 0 |

"R = N": the document, every frame stream, data and error response byte for byte, and the frames, frames seen within
steps, requests, server host log and DOM after every step, on every program the legs ran, the ones where Solid's split
diverges from the all-client twin included (R is then compared with N's own run). The four that differ are
timing-dependent in Solid's client, on N itself: replayed on the same steps, N ends differently from run to run (seed
675 after issue 9's `NotReadyError`; 1595 and 932 diverge from the twin in some replays and not others; 2077 like 675),
and R's run took the other branch (`frontend/docs/RESULTS.md`, "Slice 6"; the wire records of those runs differ because the
client sent different requests).

## Not ported (refused with a diagnostic, or unreachable in the subset)

- Structured slot arguments (the `data`-record path of `createSlotProps`), regions, parked fills, a live hole that
  re-emits, a dynamic source returning a thenable: refused (v1 restrictions, `docs/SLICE6-FRAMES.md` 4.4).
- The live-hole engine's bindings and sweeps: every server component's data has landed before it renders and fills
  are mint-suppressed, so holes stay settled; the plain-signal naming of dependency edges (every `sc:deps:` batch is
  `{}`, or `!` for a fill with async holes).
- Single-flight mutations (`applyFlightResponse`), `live()` server functions and the wire tier, GET server functions,
  no-JS forms, `?args=`: refused at the endpoint.
- Streaming inside a server component (`Loading` in its body), the shell gate: v1 places no boundary on the server
  (M8).

## Next

- Structured slot arguments (port the `data`-record path) and `props.children`/JSX-valued props (both refused by the
  v2.2 builder today).
- The U legs: plan v2.2 with its placement ignored, on `solid-plan.ts` and `plan-trace` (components, props, server-fn
  requests as scenario-settled requests).
- Repin when Solid's frames move (`8138dabe` changes `frame-sink.ts`); the recorded bytes stay at rc.21 until then.
