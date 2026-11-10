# Slice 5: server rendering, hydrated by Solid

A Rust server renders a plan app to HTML that is byte for byte the HTML Solid 2's own `renderToString` renders for
the plan's TSX twin, and, for an app with async data (plan v2.1), streams it chunk for chunk as Solid 2's own
`renderToStream` streams it, under the same host answers; Solid's client build hydrates the HTML and each stream and
the scenario runs on. The renderer is a structural port of what Solid's server builds run (`crates/runtime/src/ssr/`),
plus a lowering of the plan into the calls Solid's compiler emits in `{ generate: "ssr", hydratable: true }` mode.
Reference: solid-next `2105ffb8` (2.0.0-rc.21), production builds, and seroval 1.7.0 (the serializer Solid's web
package uses). The oracle (Solid's server renders, Chromium hydration) lives in the frontend (`frontend/ssr/`, its
`docs/RESULTS.md`, "Slice 5" and "Slice 5: async data"). Async data has its own section below: "Async data and
streaming".

## Three readiness levels (kept apart)

- **Syntax we recognize.** Not this folder: the frontends and the v2/v2.1 emitter (`frontend/plan/`). Every plan
  `plan_v2::validate` accepts reaches the server renderer, which refuses the forms below with a diagnostic.
- **Verified subset.** For plan v2: the plans of the plan fuzz's generator, seeds 1..3000, and the tracker and like.
  For each, the Rust HTML equals Solid's server HTML of the twin byte for byte, and Chromium hydrates both with Solid's
  client build (production builds, and the Rust HTML again on the dev builds) without a mismatch and replays the
  scenario recorded on native Solid, frame for frame. For plan v2.1: the tracker-async slice under four server answer
  scripts, and the plans of the async plan fuzz's generator, seeds 1..3000, under the SSR fuzz's server answers (below).
  A form the generators do not produce is not verified even when it renders.
- **Full readiness.** Not claimed. See "Not ported" and "Next".

## Files

| file | what |
| --- | --- |
| `crates/runtime/src/ssr/owner.rs` | the server's lean owner runtime: `formatChildId`, `materializeId`, `nextChildIdFor`, `getNextChildId`, `createOwner`/`allocateOwner`, `runWithOwner`, `onCleanup`, `disposeOwner`, `resetOwnerForRerun`, `createRoot` |
| `crates/runtime/src/ssr/signals.rs` | the server's primitives: `createSignal`, `createMemo`, `createSyncMemo`, `createOptimistic`, `createStore`, `action`, `ssrScope`, `mapArray`, and `@solidjs/web`'s `memo` |
| `crates/runtime/src/ssr/flow.rs` | `Show`, `For` |
| `crates/runtime/src/ssr/web.rs` | `@solidjs/web`'s server runtime: `escape`, `escapeLate`, `ssr`, `tryResolveFunctionHole`, `tryResolveString`, `resolveSSRNode`, `resolveSSRSync`, `tryJoinPlainSSRArray`, `getNextContextId`, `getHydrationKey`, `ssrHydrationKey`, `renderToString`, `generateHydrationScript` |
| `crates/runtime/src/ssr/plan.rs` | the plan lowering (the compiler's SSR output for the canonical twin, `Loading`/`Errored`, async memos, `isPending`/`latest`), the static types that decide the twin, the evaluator over the server's plain values, and the server's hosts under an answer script (`render_string`, `render_stream`) |
| `crates/runtime/src/ssr/js.rs` | the JS host async data runs on: promises with ECMAScript's semantics (resolving functions, thenable adoption, reaction jobs, `Promise.resolve`/`reject`/`all`/`allSettled`/`race`, `await`), the microtask queue, Node's `setImmediate` queue, Solid's `createDeferredPromise`, web's `queue` |
| `crates/runtime/src/ssr/boundary.rs` | `<Errored>` (`createErrorBoundary`), `<Loading>` (`createLoadingBoundary`, `ssrLoadingBoundary`), `ErrorContext` and `runWithBoundaryErrorContext`, `ssrHandleError`, fragment containers, `ssrSanitizeError` and its verdicts |
| `crates/runtime/src/ssr/stream.rs` | `renderToStream` piped to a sink (the shell, fragments, the coalesced writes, `registerFragment`, `scheduleFlush`, `flushEnd`, the serialize channel: `guardChannel`, `trackSerialized`, the stub batch), and the hydration serializer (`createHydrationSerializer`, `createKeyedSerializer`) |
| `crates/runtime/src/ssr/seroval.rs` | seroval's `crossSerializeStream` for the values a plan app serializes (the stream parser, promise watching, the cross serializer) |
| `crates/runtime/src/ssr/value.rs` | the JS values the server passes around: data, `{ t }` templates and `{ t, h, p }` suspended results, functions, promises, error objects (`Error`, `NotReadyError`); thrown values |
| `crates/runtime/src/bin/ssr.rs` | `ssr PLAN.json` prints `{"html": …}` (and the host `requests`, for v2.1) or `{"error": …}`; `ssr PLAN.json --stream ANSWERS.json` prints `{"chunks", "events", "requests"}`; `ssr --hydration-script` |
| `crates/runtime/tests/ssr.rs` | 5 tests (below) |
| `crates/runtime/tests/fixtures/ssr/*.json` | 13 programs with Solid's HTML: the tracker and like (canonical twins) and 11 generated programs covering every plan node kind and every lowering form; written by the frontend's `scripts/ssr-corpus.ts` |
| `crates/runtime/tests/ssr_async.rs` | 6 tests of async data (below) |
| `crates/runtime/tests/fixtures/ssr-async/*.json` | 14 v2.1 programs with Solid's stream event log, its realized server answers, and its renderToString HTML and requests: tracker-async under four scripts, and 10 generated programs covering the stream forms; written by `scripts/ssr-corpus.ts --async` |

Every ported function carries a `// Solid:` comment with its file and lines. In `ssr/`, `signals.ts`, `flow.ts` and
`shared.ts` are `packages/solid/src/server/*.ts`, `server.ts` is `packages/web/src/server.ts`.

## What runs, and what is ported

V8 function coverage of the production server builds while `renderToString` renders the tracker, like and the 176
programs the emitter accepts among seeds 1..200 (frontend `.out/ssr-study/cov-many.ts`, not kept):

- `solid/dist/server.js`, 35 functions: `For`, `Show`, `mapArray`, `createMemo` (`update`, `run`, `read`),
  `createSyncMemo` (`pull`, its read), `processResult`, `isThenable`, `runWithObserver`, `createSignal`,
  `createOptimistic`, `createStore`, `storeSetter`, `action`, `ssrScope`, `createOwner`, `allocateOwner`,
  `createRoot`, `disposeOwner`, `unlinkOwner`, `resetOwnerForRerun`, `formatChildId`, `nextChildIdFor`,
  `getNextChildId`, `getNextContextId`, `getOwner`, `ownerId`, `onCleanup`, `runWithOwner`, `getContext`. All are
  ported. `getContext` is only read for `NoHydrateContext`, whose default (`false`) the port reads; `ownerId` is a dev
  assertion around a field read; `runWithObserver` sets an observer that only async reads consult; `isThenable` is
  false for every plan value.
- `web/dist/server.js`, 45 functions. Ported: `renderToString`, `ssr`, `escape`, `escapeLate` (and its wrapper),
  `tryResolveFunctionHole`, `tryResolveString`, `resolveSSRNode`, `resolveSSRSync`, `tryJoinPlainSSRArray`,
  `getHydrationKey`, `ssrHydrationKey`, `memo`, `claimRenderRoot`/`renderRoots` (a root cleanup with no output),
  `assembleDocument` and `withShellEnd` (their body-only path: the HTML passes through), `resolveSSRSelectValues`
  (inactive: no `<select value>`). Run but not ported, because they write nothing a body-only render without async data
  can see: the hydration serializer (`createHydrationSerializer`, `createKeyedSerializer`, `close`, plugin and feature
  resolution, `serializeFragmentAssets`: nothing is serialized, so no script is emitted; ported since for async
  data, "Async data and streaming", where a v2 plan still serializes nothing), head and asset tracking
  (`createAssetTracking`, `applyAssetTracking`, `registerEntryAssets`, `createHeadRegistry`, `renderShellHead`,
  `commitHeadBoundary`, `resolveHead`: nothing registers), the trace context (`traceFor`, `records`, `randomHex`,
  `randomTraceId`, `randomSpanId`, `formatTraceparent`, `traceMetaMarkup`, `timeDocument`: its meta tag only reaches a
  document with a `</head>`), `peekRequestEvent` (no request), `normalizeNonce`, `createHydrationWriter`. A render
  whose HTML contains `</head>` or `<!--xs-->` is refused, so the dropped splices can never apply.

## How the server differs from the client

Solid's server build reimplements reactivity (`solid/src/server/signals.ts`); it is not `@solidjs/signals`, which the
client port in `slice1/` follows. The differences a plan app meets:

- **Owners** are a forward-only list with an id, a child counter, a pending scope slot and cleanups. No queue, heap,
  flags, zombies or snapshots. Their only job is hydration ids: every owner a memo creates takes the next child id of
  its parent (`formatChildId`: base 36, with a length letter from 36 on), and `ssrHydrationKey()` takes one from the
  current owner. The client allocates the same ids in the same order; nothing else ties the two together.
- **Signals and stores are plain values.** A store is its object, with no proxy and no tracking. Setters write inert
  data; optimistic setters do nothing; actions are their function and never run. Nothing re-renders.
- **Memos compute once**, eagerly (unless `lazy`), under their own owner, and cache their value or error. `createMemo`
  (user memos, `createOptimistic(fn)`, `Show`'s condition) and `createSyncMemo` (`Show`'s branch, `mapArray`, the
  compiler's `_$memo`) differ only on async paths.
- **`Show`** creates its condition memo as a real memo (the client's child slot 0), burns one id for the client's
  non-keyed condition memo, then a sync memo picks the branch.
- **`mapArray`** creates one row owner and rewrites its id per row (`formatChildId(rowOwnerId, i)`) instead of an owner
  per row, then sets its counter to the row count. The `each` getter runs inside the memo, as on the client.
- **`ssrScope`** reserves one id slot when a hole is registered and swaps it in when the hole is evaluated (the client
  scopes the hole's insert effect).
- **Escaping** happens where the compiler puts `_$escape` (below); `escape` on a function defers to the call
  (`escapeLate`). Adjacent text values in a list are separated by `<!--!$-->`, which the client's hydration walk
  removes (`stripTextSeparators`, `claimChildNodes` in `web/src/client.ts`).

## The canonical twin

A plan does not record whether a TSX text hole was written `{x()}` or `{"" + x()}` (PLAN-V2.md, fallback 8: the
emitter drops the coercion). On the client both insert the same text. On the server they are different programs: the
compiler scopes a hole that could return hydratable content (`_$scope(() => _$escape(x()))`, one id slot) and leaves a
provably primitive one alone (`() => "" + _$escape(x())`, no slot), so every hydration key after the hole differs.

The renderer therefore renders one twin per plan, the plan fuzz generator's: **a text hole whose value is an integer,
or a conditional, is coerced; any other hole is written as is.** Integers are coerced so that the hole inserts the
string the plan inserts (the generator's reason), conditionals so that TSX keeps them a text hole (TSX lowers a raw
`{c ? a : b}` child to control flow). The integer test is a static type inference over the plan (seed literals,
record fields, array element types, operator result types); a hole whose type it cannot decide is refused.

- The tracker's idiomatic `<b>{unassigned()} open</b>` is not the canonical twin: Solid renders its rows `_hk=8000`,
  `8010`, `8020`; the canonical `{"" + unassigned()}` renders them `7000`, `7010`, `7020`, and that is what Rust
  renders. Nothing else differs (`frontend/ssr/ssr.test.ts` pins both). Each HTML hydrates only under the client
  build of its own twin: the canonical HTML under the idiomatic client is a hydration mismatch, which the oracle
  reports (the same test).
- Like's `{shown()}` is its button's only child and no id follows it: both twins render `<button _hk=1>0</button>`.

## The lowering (compiler `src/ssr/transform.rs`)

- **Templates.** An element in a component position (the markup, a Show branch, a For row) is a template: `<tag`, the
  hydration key hole, `>`, its children, `</tag>` (no closing tag for a void element). Nested elements join their
  root's template; static text is inlined raw (the compiler inlines `trimWhitespace(raw)` unescaped). When an element
  has more than one child, each hole is boxed in `<!--$-->` … `<!--/-->`.
- **Order.** A template's key and holes are evaluated in document order (the compiler's `var _v$ = …` list), then
  `_$ssr(_tmpl$, …)` resolves them. A Show or For runs when its hole is evaluated, so its rows render before later
  holes are registered.
- **Text holes.** Escaped in place (`escape_expression_in_place`: a binary expression escapes both operands, a
  conditional its branches, `&&` its right side; a literal or `!` stays; anything else is wrapped). A hole with a call
  or member access is a thunk evaluated by `ssr()`, scoped when it can return hydratable content; other holes are
  computed when registered. The value must pass the plan's ToString (a string or an integer).
- **Show and For** are `_$escape(Show(new _P$(…)))` inside an element and raw in a component position, with getters
  for `when`, `fallback` (absent with no fallback views), `children` and `each`, and a one-argument row function.
- **Condition memos.** A conditional or logical `when`/`each` is rewritten as the compiler's
  `transformCondition(…, inline)` rewrites a dynamic prop: `_$memo(() => test)()` in the getter, which takes an id
  under whichever owner runs the getter.
- **Events** produce nothing on the server; handlers and actions never run.

## Refused (explicit diagnostics, before anything renders)

- A text hole Solid's compiler folds to static text (Babel's confident evaluation), as the emitter refuses it.
- An uncoerced text hole whose `||` spine reaches an `&&` with two dynamic sides: the compiler hoists a condition memo
  there (an IIFE before the scope), which is not ported. The emitter refuses the same TSX hole.
- A text hole whose type the inference cannot decide (for example a row field of an empty seeded list).
- Static text with no unique raw JSX spelling: `&`, `<`, `>`, `{`, `}`, a line break, a tab or other non-space
  whitespace, a run of spaces, or empty; and adjacent static texts (JSX has one text there).
- A void element with children; `script`, `style` (raw-text children), `head`, `html`, `body` (the document shell).
- An eval site anywhere in the plan (slice 3, frontend `docs/EVAL.md`: a markup `eval` view, a value `eval`
  expression in a memo, seed, action or handler) and an evaluated code's own plan (`bindings`, `value`): the live
  evaluator has no server twin here, so the whole app is refused before rendering (`refuse_evals` in
  `src/ssr/plan.rs`), never rendered without its eval subtree. Added when slices 3 and 5 were integrated.
- A thrown error (a value outside the plan's types) fails the render, as `renderToString` rethrows. Where JS would
  render a missing field as nothing, the plan's evaluator throws: fail closed, never a guess. (Under an `<Errored>`,
  such an error is caught as Solid's would be.)
- Plan v2.1's own refusals: "Async data and streaming", "Refused (async)".

## Results

| check | result |
| --- | --- |
| tracker plan (`tracker.plan.json`) | Rust HTML = Solid's HTML of the canonical twin, byte for byte (389 bytes, 4 keys) |
| like plan (`like.plan-v2.json`) | Rust HTML = Solid's HTML of either twin: `<button _hk=1>0</button>` |
| hydration script | `ssr --hydration-script` = `generateHydrationScript()` |
| tracker in Chromium | Rust HTML and Solid HTML each hydrated by Solid's client (prod and dev builds): every element adopted, no key left unclaimed, the HTML unchanged but for the `<!--!$-->` separators the client removes, no console error or warning, and all 13 scenario frames equal |
| like in Chromium | the Rust HTML (Solid's is the same bytes), prod and dev builds: the same checks; frames `0 1 0 1 1` |
| fail-closed check | the canonical tracker HTML under the idiomatic client fails: server keys left unclaimed, and the dev build warns "Hydration key miss" |

**SSR fuzz** (frontend `scripts/ssr-fuzz.ts --dev`): every program of the plan fuzz's generator; Solid renders its
TSX twin, Rust its plan; then Chromium hydrates the Rust HTML (prod and dev builds) and the Solid HTML (prod) and replays
the scenario native Solid recorded.

| seeds | agree | HTML differs | hydration fails | Rust refused | refused (emitter) | invalid | generator bug |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1..1000 | 869 | 0 | 0 | 0 | 131 | 0 | 0 |
| 1001..3000 (held out) | 1713 | 0 | 0 | 0 | 287 | 0 | 0 |
| 1..100 (gate) | 85 | 0 | 0 | 0 | 15 | 0 | 0 |

The agreeing programs render 445,065 HTML bytes with 4,758 hydration keys (1..1000) and 876,977 bytes with 9,330 keys
(held out); 2,607 and 5,139 hydrations each replay the whole scenario (9,766 and 20,189 steps over the 869 and 1,713
scenarios). The emitter's refusals are the generator's `outside` family (1..1000: 43 `*`, 49 `-`, 39 constant holes;
held out: 89, 91, 107). Every program the emitter accepts agrees, including the 8 and 19 whose compiled RX differs from
native Solid in the plan fuzz (those differences are RX's, not the plan's). The summaries are in `docs/ssr-fuzz/`
(copies of the frontend's `.out/ssr-fuzz/run-*/summary.json`).

**Tests** (`crates/runtime/tests/ssr.rs`, 6; and 4 unit tests in `src/ssr/`):

- `the_corpus_renders_as_solid_renders_it`: the 13 fixture programs, byte for byte;
- `the_corpus_covers_the_server_forms`: markers, separators, keys, Show with and without fallback, a For row of two
  views, and/or/cond;
- `an_integer_hole_takes_no_id_and_a_string_hole_takes_one`: the canonical twin, pinned on two HTMLs recorded from
  Solid (`_hk=30` against `_hk=40`), and escaping;
- `refusals_are_diagnostics`: constant holes, the hoisted `&&`, static texts, void children, the document shell;
- `errors_propagate_and_handlers_never_run`;
- `eval_sites_are_refused` (added at integration): every app in `fixtures/eval/` (the eval slice and the eval fuzz
  corpus) and every evaluated plan in their eval tables is refused with the eval diagnostic;
- unit: `formatChildId` (including the length letter), content escaping, a scoped hole, a refused static text.

## Async data and streaming (plan v2.1)

A plan v2.1 app has async memos (`createMemo(() => host(…))`), `<Loading>` and `<Errored>`, and `isPending`/`latest`
probes (frontend `plan/docs/PLAN-V2.md`, "v2.1: async data"). On the server its async memos call the server's hosts
during the render. The renderer runs both of Solid's server renders of it:

- **`renderToString`** does not wait: an async read under a `<Loading>` suspends the boundary, which renders its
  fallback and serializes `"$$f"` under its id; the host's promise is never awaited. The document is the HTML and one
  `<script>` with the serialized data (`(self.$R=self.$R||{})[""]=[];_$HY.r["200"]="$$f";`).
- **`renderToStream`** streams: the shell (each suspended `<Loading>`'s fallback inside its placeholder
  `<template id="pl-ID"></template>…<!--pl-ID-->`, and a script with the hydration data so far: each async memo's
  pending answer as a seroval promise under the memo's id, and each fragment's `ID_fr` promise), then, as answers land,
  each settled boundary's `<template id="ID">` with its content and the scripts that swap it in (`$df`, with Solid's
  `REPLACE_SCRIPT` the first time) and resolve the serialized promises (`$R[n]($R[m],value)`), then the end. A boundary
  whose read failed streams what the nearest `<Errored>` drew for it (`<template id="ID" e>`), and the error crosses
  sanitized (`new Error("Internal Server Error")`, the production builds' wire error) under the `<Errored>`'s id.
  Answers that land before the shell is flushed are inlined: the content replaces the placeholder and the shell is the
  only chunk.

### The server's host answers

A server render needs its host calls answered. An **answer script** (frontend `ssr/stream-core.ts`, `ServerAnswer`)
lists, for each request (host, call number per host, arguments), its value or error and when it settles:

- `now`: the host returns a settled promise (`Promise.resolve(value)`, `Promise.reject(new Error(error))`);
- `idle`: the host returns a pending promise, settled when the render is idle (no microtask and no timer left), one
  per idle point, in the order of `at`. An `idle` answer without `at` was never needed (its reader was discarded: the
  boundary failed first); it stays pending.

`ssr PLAN --stream ANSWERS` renders under a script and prints the chunks, the event log (each chunk, each settlement
`host#n`, the end) and the requests. It refuses, before or while rendering, a script that does not fit: a request with
no answer, other arguments than the script's, an answer the render never asked for, an idle answer left over when the
stream ends, a value outside the host's declared type. The frontend's oracle runs Solid's `renderToStream` under the
same model (the timers Solid schedules are counted by wrapping `setTimeout`/`setImmediate` before Solid loads; nothing
in Solid changes), and in the SSR fuzz a seeded chooser answers each request as it arrives; the answers Solid's render
realized are the script Rust replays.

### The JS host (`js.rs`)

The chunk boundaries and the byte order inside a chunk follow the order of microtasks: writes are coalesced into one
chunk per `setImmediate` (`coalesceWrites`), the shell waits for eight microtask turns after the fragment registry last
changed and then one `setImmediate` of grace (`scheduleFlush`), a fragment settles two `queue` turns after its content
(`registerFragment`), and seroval emits a promise's resolution in the reaction to it. So the port has an explicit
event loop: a microtask queue, Node's immediate queue, and promises with ECMAScript's semantics (§27.2: the resolving
functions with `[[AlreadyResolved]]`, adoption of a thenable through `NewPromiseResolveThenableJob` (two more jobs),
`PerformPromiseThen` and reaction jobs, `Promise.resolve`/`reject`/`all`/`allSettled`/`race`, and `await` as
`PerformPromiseThen` with no derived promise). Every `.then`, `Promise.resolve`, `queueMicrotask`, `queue` and `await`
of the ported code goes through it, one for one, with the callback's return value (a returned promise is adopted, which
costs the queue two jobs). `microtasks_run_in_v8s_order` pins the order Node 24 prints for a mixed program. Not
modelled: `setTimeout` (Solid reaches it only in `scheduleFlush`'s no-progress retry, which no render here took; a
render that schedules one fails closed), rejection tracking, subclassing.

### What runs, and what is ported (async)

V8 block coverage of the production builds while Solid renders the async generator's programs 1..1000 under three
answer policies each (all idle, all now, mixed; `renderToStream` and `renderToString`): `solid/dist/server.js` 100
named functions, `web/dist/server.js` 132, `seroval/dist/index.js` 92 (frontend `.out/ssr-async-study/`, not kept).
The port follows the covered blocks; an uncovered branch is ported where it is cheap and refused with a diagnostic
where it is not (below).

- **solid server** (`signals.ts`, `hydration.ts`, `flow.ts`): `createMemo` with `armDispose`, `run`, `update` and the
  read; `processResult`'s thenable branch (the slot record of the render context, `createDeferredPromise`,
  `settleServerAsync`, `refuseRenderedLanding`/`isRenderedOutput`, the serialize of the deferred under the memo's id)
  and its synchronous tail; `subscribePendingRetry`; `createSyncMemo` with `latchNotReady`/`clearNotReadyLatches`;
  `ssrScope` with its resume of a suspended chain; `isPending`, `latest`; `createErrorBoundary` (`resolve`,
  `resolveIn`, `handleError`, `serializeError`, `renderFallback`, `renderOutcome`, `escalated`, `drawFallback`'s
  synchronous path, the pull); `runWithBoundaryErrorContext`, `ErrorContext` on owner context records
  (`getContext`/`setContext`, copied on write); `ssrHandleError`; `createLoadingBoundary`, `ssrLoadingBoundary`
  (`runDiscovery`, `runLoadingPhase`, `resolveIn`, `commitBoundaryState`, the `bufferedCtx` and its serialize buffer,
  `errorOutcome`, `failFragment`, `failOpen`, `finalizeError`, `abandon`, `checkBudget`, the async resume loop),
  `setFragmentContainer`/`fragmentContainer`; `Loading`, `Errored`; `ssrSanitizeError`, `verdictOf`.
- **web server** (`server.ts`): `ssr` with suspended holes (`{ t, h, p }`), `resolveSSRNode`, `pushSSRAsyncHole`,
  `buildAsyncWrap`, `tryResolveString`/`tryResolveFunctionHole` with their bail, merge and wrap results,
  `appendResolvedNode`, `mergeTemplateInto`, `resolveSSRSync`, `escape`/`escapeLate` (with `$lhSkip`);
  `renderToString`'s serializer and context; `renderToStream`: the context's `serialize` (`guardChannel`,
  `borderForm`, `verdictNow`, `trackSerialized`, the stub batch), `registerFragment` and its settle (inline before the
  shell flush, `sink.fragment` after; `waitForFragments`, children spliced with `replacePlaceholder`;
  `abandonSubtree`), `pushTask`, `emitTask`, `writeTasks`, `coalesceWrites`, `guardSink`, `doShell`, `flushEnd`,
  `onDone`, `scheduleFlush`, `allSettled`, `pipe`, the failure path (`failRender`/`abandon`); `queue`, `deferFlush`;
  `getLocalHeaderScript`; `createHydrationSerializer`, `createKeyedSerializer`, `serializeKey`, and
  `rejectUnserializedKey`'s index counter.
- **seroval** (`crossSerializeStream`): the stream parser (`startStreamParse`, `parseSOS`, `parseObject`,
  `parseArray`/`parseItems`, `parsePlainObject`/`parseProperties`, `parseError`/`getErrorOptions`, `parsePromise`,
  `watchPromise`, `handlePromise`, `parseEvent`, `wrapPromiseResult`, `parseSpecialReference`,
  `createIndexForValue`, `getNodeForIndexedValue`, `push`/`popPendingState`, `drainOutput`, `checkStreamParse`,
  `stopStreamParse`), the cross serializer (`serializeTopCross`, `serializeCross`, `serialize$1`,
  `serializeAssignable`, `serializeArray`, `serializeObject`/`serializeProperties`/`serializeProperty`,
  `serializeError`/`serializeDictionary`/`serializeWithObjectAssign`, `serializePromiseConstructor`,
  `serializePromiseResult`, `getConstructor`, `assignIndexedValue`, `resolveAssignments`, `getKeyKind`,
  `isValidIdentifier`, `serializeString`), `getCrossReferenceHeader`, and the promise constructor, success and failure
  functions' source text.
- **Run but not ported**, because they write nothing these renders can see: head and asset tracking
  (`createAssetTracking`, `applyAssetTracking`, `registerEntryAssets`, `createHeadRegistry`, `renderShellHead`,
  `headShellReady`, `commitHeadBoundary`, `flushHeadFragment`, `adopt`/`dropHeadBoundary`, `resolveHead`,
  `serializeFragmentAssets`, `collectStreamStyles`, `propagateBoundaryStyles`: nothing registers), the trace context
  (`traceFor`, `randomHex`, `timeDocument`, `records`: its meta tag only reaches a `</head>`), `peekRequestEvent`,
  `normalizeNonce`, `createHydrationWriter`, `claimConsumer`, `resolveRootHoles` (no root holes),
  `resolveSSRSelectValues` (inactive), `assembleDocument`/`withShellEnd` (the script is appended to a body-only
  render), seroval's plugin resolution and the web plugins' `test`s (no plain value matches one), its `marked` sets
  (cross mode assigns every index), `toBorderForm`/`rewriteTree` (the identity on plain data: the port keeps the
  `then` it costs), `runWithObserver`, `stampThrower` and `reportServerError` (they feed only a server error hook),
  the observe-tier `record`.

### Hydration of a stream (the frontend's oracle)

The page is `<!doctype html>`, the import map onto Solid's dist files, `generateHydrationScript()`, and `<div id="app">`,
served as a streaming HTTP response: the harness writes each chunk, byte for byte, followed by a script that removes
itself and records that the chunk was parsed and its scripts ran (the DOM is as if it were not there), and waits for it
before the next step. The client is Solid's hydratable DOM build of the TSX twin. Two orders: **hydrate after the
shell** (the realistic one: later chunks reveal into a hydrated page through `_$HY.f`) and **hydrate after the last
chunk**; production builds, and the dev builds (which report mismatches on the console) after the shell. The client's
host requests continue the server's numbering per host: a request the server answered and serialized is one the client
adopts, so the client's next `loadIssues` is #2. Then a continuation runs (a fixed one, or one recorded with the
program's chooser), each step's frame (the text of `#app`, scripts and templates excluded) observed.

Solid's own stream is the **control**: each mode is run on Solid's stream first, and the Rust stream's run of the same
mode must observe the same frames, the same hydrated DOM, the same elements the client created instead of claiming
(every element created through `createElement`/`cloneNode`/`importNode` is marked) or left unclaimed (`_$HY.completed`),
and the same console messages. A control run that fails (a page error, a step that cannot run, a request left pending)
is an oracle failure (`invalid`), not agreement. The comparison is needed because Solid's client is not uniform here:

- hydrated after the shell, a streamed failure's `<Errored>` fallback is rendered fresh by the client (by design: the
  template is marked `e`, `server.ts` `sink.fragment`, #4287); hydrated after the last chunk, it is claimed;
- an `<Errored>` over two `<Loading>`s, one failing and one landing after it, ends differently by when the client
  hydrates: after the shell the page shows the second boundary's content and no fallback; after the last chunk, the
  fallback (async SSR fuzz seeds 28 and 58 of 1..100). Both runs are recorded on Solid's stream and both are replayed
  on Rust's; this looks like a Solid rc.21 bug and is reported in the notes, not filed.

A renderToString HTML is one chunk; nothing async is serialized, so the client asks for its data itself (its numbering
starts at 1) and replays the scenario native Solid recorded from mount.

### Results (async)

| check | result |
| --- | --- |
| tracker-async, four server answer scripts (`idle`, `now`, `idle-reject`, `now-reject`) | Rust's stream = Solid's, event for event (2, 1, 2 and 1 chunks); renderToString HTML = Solid's |
| tracker-async in Chromium (`idle`, `now`) | Rust's stream hydrated after its shell and after its last chunk (prod) and after its shell (dev): clean (nothing created, nothing unclaimed, nothing on the console), stream frames `Loading issues…` then step 1's, and steps 2..17 of the scenario with the recorded frames; the renderToString HTML hydrates and replays all 18 steps from mount |
| tracker-async, rejected first load | the stream's failure fragment carries the `<Errored>` fallback; hydrated, `retry` asks the client's `loadIssues #2` and shows the issues |
| fail-closed checks | a changed key in a chunk: fresh rows and an unclaimed key, "Hydration key miss" on the dev build; a changed text: a frame differs; a changed byte: the stream comparison |

**SSR fuzz v2.1** (frontend `scripts/ssr-fuzz.ts --async --dev`): every program of the async plan fuzz's generator;
Solid renders its TSX twin (renderToStream under the server chooser, renderToString), Rust its plan under the answers
Solid realized; then Chromium hydrates both streams in the three modes and both HTMLs.

| seeds | agree | stream differs | HTML differs | hydration differs | Rust refused | refused (emitter) | invalid | generator bug |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1..1000 | 878 | 0 | 0 | 0 | 0 | 122 | 0 | 0 |
| 1001..3000 (held out) | 1747 | 0 | 0 | 0 | 0 | 252 | 1 | 0 |
| 1..100 (gate) | 84 | 0 | 0 | 0 | 0 | 16 | 0 | 0 |

The agreeing programs stream 1,950,289 bytes in 1,685 chunks (629 streams of two chunks or more, 106 failure
fragments, 201 server rejections; 5,351 hydration keys) and render 180,607 renderToString bytes (1..1000); held out,
3,958,861 bytes in 3,427 chunks (1,309 multi-chunk, 228 failure fragments, 386 rejections; 10,657 keys) and 359,378
bytes. 7,024 and 13,976 hydrations run (eight per program: Solid's and Rust's stream in three modes, Solid's and Rust's
HTML), with 16,146 and 32,186 continuation steps and 17,015 and 33,502 steps from mount. The emitter's refusals are the
`outside` family (1..1000: 64 `*`, 58 `-`; held out: 134, 118). The one invalid program, seed 1916, is Solid's: its
renderToString HTML, hydrated by Solid's client, does not replay native Solid's scenario (a `Show` toggled off and on
around `Errored` > `Loading` > `Loading` after a rejected request: the hydrated page shows nothing where native Solid
shows `ready` and the inner fallback); Rust's HTML, byte for byte the same, fails exactly the same way (the oracle
runs Rust's HTML against a failing control too, and requires the same failure). Notes on Solid's
own runs (every Rust run observed the same), 1..1000 / held out: the dev builds log caught errors in 203 / 419
programs; after the shell the client rendered a streamed failure's fallback fresh in 106 / 214; the continuation after
the last chunk differs from the one after the shell in 16 / 42 (the timing-dependent `Errored` above), and the dev
build's after the shell from the production build's in 2 / 7. The summaries are `docs/ssr-fuzz/summary-async-*.json`
(copies of the frontend's `.out/ssr-fuzz/run-async-*/summary.json`).

**Tests** (`crates/runtime/tests/ssr_async.rs`, 6; and unit tests in `src/ssr/js.rs` and `src/ssr/seroval.rs`):

- `the_async_corpus_streams_as_solid_streams_it`: the 14 fixture programs, event for event, and their requests;
- `render_to_string_of_the_async_corpus_is_solids`: their renderToString HTML and requests;
- `the_async_corpus_covers_the_stream_forms`: placeholders, failure fragments, `$df`, `_$HY.r`, `_fr` promises, the
  wire error, the promise success and failure functions, a `$$f` marker, three-chunk streams, an idle answer never
  settled, every v2.1 plan form;
- `tracker_async_streams_its_fallback_then_its_content_or_its_failure`;
- `an_answer_script_that_does_not_fit_the_render_is_refused`;
- `an_async_read_outside_every_loading_is_refused` (a root hole);
- unit: `microtasks_run_in_v8s_order`, `immediates_run_after_the_microtasks_they_follow`,
  `strings_and_keys_escape_as_serovals`, `values_serialize_with_cross_references`.

`tests/plan_v21.rs`'s `the_server_renderer_refuses_plan_v21` (which pinned the old refusal) is now
`the_server_renderer_renders_plan_v21_to_a_string`, pinned on Solid's renderToString HTML of tracker-async.

### Refused (async), each with a diagnostic

An async read outside every `<Loading>` (a root hole: `renderToStream` would retry it before its shell); `<Loading
on>`; reveal groups; a deferred-stream read; an `<Errored>` fallback that suspends or throws; an `<Errored>` drawing
its fallback into an enclosing open fragment (`container.region`); an iterable answer (`processResult`'s iterator
branches); a value seroval cannot serialize (a `NotReadyError`, a function); a `setTimeout`; an answer script that does
not fit (above). A render error no boundary takes ends the stream as Solid's does (`failRender`) and is reported
(`renderErrors`).

## Next (not ported, not claimed)

- **Async beyond the verified subset**: root holes and `scheduleFlush`'s timer retry, `deferStream`, reveal groups
  (`<Reveal>`), `<Loading on>`, client holes (`ssrSource: "client"`), async iterables and live sources, server
  components, the server error hook (`onError`, `configureServerErrors`), streamed fallbacks that themselves suspend,
  the awaited form (`await renderToStream(…)`, its stable key order), `pipeTo`/`readable`, abort signals and client
  disconnects.
- **The rest of the document**: `</head>` splices (head tags, assets, the trace meta tag, the serializer's script at
  `<!--xs-->`), nonces, `NoHydration`/`Hydration`, a document shell with `HydrationScript` and the shell-end marker.
- **Attributes, spreads, `ref`, classes and styles, `<select value>`, link claims, raw-text elements**: plans have none.
- **Groups (`$g`), live holes and frame renders.**
- **Eval sites on the server** (slice 3): refused today. A server twin would render `createEval`'s keyed `Show` over
  the compiled component (its hydration ids and the `Show` marker), with the host's eval table on the server.
- **Hydration itself** is Solid's client, not ported: the Rust side only renders. A Rust client that hydrates (For's
  hydrating `create()`, the `insertExpression` claim pass, the adoption of serialized values and streamed fragments,
  event replay) is slice 4/5 follow-up work.

## Reproduce

```sh
cargo test --test ssr --test ssr_async
cargo run --bin ssr -- crates/runtime/tests/fixtures/tracker.plan.json
cargo run --bin ssr -- crates/runtime/tests/fixtures/tracker-async.plan.json   # renderToString of a v2.1 plan
# in ../frontend (Node 24, Chromium on PATH or $CHROMIUM):
RUST_SSR=$PWD/../rust-solid/target/debug/ssr node --experimental-strip-types --conditions=browser --conditions=development --test ssr/ssr.test.ts
npm run ssr-fuzz -- --seeds 1000 --start 1 --dev --rust ../rust-solid/target/debug/ssr
npm run ssr-fuzz -- --seeds 2000 --start 1001 --dev --rust ../rust-solid/target/debug/ssr
npm run ssr-corpus -- --start 1 --seeds 300 --max 16 --out ../rust-solid/crates/runtime/tests/fixtures/ssr
RUST_SSR=$PWD/../rust-solid/target/debug/ssr node --experimental-strip-types --conditions=browser --conditions=development --test ssr/ssr-async.test.ts
npm run ssr-fuzz -- --async --seeds 1000 --start 1 --dev --rust ../rust-solid/target/debug/ssr
npm run ssr-fuzz -- --async --seeds 2000 --start 1001 --dev --rust ../rust-solid/target/debug/ssr
npm run ssr-corpus -- --async --start 1 --seeds 3000 --max 16 --out ../rust-solid/crates/runtime/tests/fixtures/ssr-async
```
