# Slice 5: server rendering, hydrated by Solid

A Rust server renders a plan v2 app to HTML that is byte for byte the HTML Solid 2's own `renderToString` renders for
the plan's TSX twin, and Solid's client build hydrates that HTML and runs the scenario on. The renderer is a structural
port of what Solid's server builds run (`crates/runtime/src/ssr/`), plus a lowering of the plan into the calls Solid's
compiler emits in `{ generate: "ssr", hydratable: true }` mode. Reference: solid-next `2105ffb8` (2.0.0-rc.21),
production builds. The oracle (Solid's server render, Chromium hydration) lives in the frontend
(`frontend/ssr/`, its `docs/RESULTS.md`, "Slice 5").

## Three readiness levels (kept apart)

- **Syntax we recognize.** Not this folder: the frontends and the v2 emitter (`frontend/plan/`). Every plan
  `plan_v2::validate` accepts reaches the server renderer, which refuses the forms below with a diagnostic.
- **Verified subset.** The plans of the plan fuzz's generator, seeds 1..3000, and the tracker and like. For each, the
  Rust HTML equals Solid's server HTML of the twin byte for byte, and Chromium hydrates both with Solid's client build
  (production builds, and the Rust HTML again on the dev builds) without a mismatch and replays the scenario recorded
  on native Solid, frame for frame. A form the generator does not produce is not verified even when it renders.
- **Full readiness.** Not claimed. See "Not ported" and "Next".

## Files

| file | what |
| --- | --- |
| `crates/runtime/src/ssr/owner.rs` | the server's lean owner runtime: `formatChildId`, `materializeId`, `nextChildIdFor`, `getNextChildId`, `createOwner`/`allocateOwner`, `runWithOwner`, `onCleanup`, `disposeOwner`, `resetOwnerForRerun`, `createRoot` |
| `crates/runtime/src/ssr/signals.rs` | the server's primitives: `createSignal`, `createMemo`, `createSyncMemo`, `createOptimistic`, `createStore`, `action`, `ssrScope`, `mapArray`, and `@solidjs/web`'s `memo` |
| `crates/runtime/src/ssr/flow.rs` | `Show`, `For` |
| `crates/runtime/src/ssr/web.rs` | `@solidjs/web`'s server runtime: `escape`, `escapeLate`, `ssr`, `tryResolveFunctionHole`, `tryResolveString`, `resolveSSRNode`, `resolveSSRSync`, `tryJoinPlainSSRArray`, `getNextContextId`, `getHydrationKey`, `ssrHydrationKey`, `renderToString`, `generateHydrationScript` |
| `crates/runtime/src/ssr/plan.rs` | the plan lowering (the compiler's SSR output for the canonical twin), the static types that decide the twin, and the evaluator over the server's plain values |
| `crates/runtime/src/ssr/value.rs` | the JS values the server passes around: data, `{ t }` templates, functions |
| `crates/runtime/src/bin/ssr.rs` | `ssr PLAN.json` prints `{"html": …}` or `{"error": …}`; `ssr --hydration-script` |
| `crates/runtime/tests/ssr.rs` | 5 tests (below) |
| `crates/runtime/tests/fixtures/ssr/*.json` | 13 programs with Solid's HTML: the tracker and like (canonical twins) and 11 generated programs covering every plan node kind and every lowering form; written by the frontend's `scripts/ssr-corpus.ts` |

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
  resolution, `serializeFragmentAssets`: nothing is serialized, so no script is emitted), head and asset tracking
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
  render a missing field as nothing, the plan's evaluator throws: fail closed, never a guess.

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

## Next (not ported, not claimed)

- **Async data on the server.** Plan v2 cannot express it: hosts are awaited only inside actions, and sources and
  memos are synchronous, so no plan app has an async memo, a resource or a `Loading` boundary, and nothing is
  serialized (`assignIssue` is only called by `claim`, which never runs on the server). Porting it needs, first, a
  plan form for an async source; then `processResult`'s thenable branch, `NotReadyError` and the latches, `Loading`
  boundaries (`createLoadingBoundary`), `renderToStream` with its fragments and reveal scripts, the hydration
  serializer (seroval) and `_$HY.r`, and the client's adoption of serialized values while hydrating.
- **The rest of the document**: `</head>` splices (head tags, assets, the trace meta tag, the serializer's script),
  nonces, `NoHydration`/`Hydration`, `renderToStream`.
- **Attributes, spreads, `ref`, classes and styles, `<select value>`, link claims, raw-text elements**: plans have none.
- **Async holes, groups (`$g`), live holes and frame renders.**
- **Eval sites on the server** (slice 3): refused today. A server twin would render `createEval`'s keyed `Show` over
  the compiled component (its hydration ids and the `Show` marker), with the host's eval table on the server.
- **Hydration itself** is Solid's client, not ported: the Rust side only renders. A Rust client that hydrates (For's
  hydrating `create()`, the `insertExpression` claim pass, event replay) is slice 4/5 follow-up work.

## Reproduce

```sh
cargo test --test ssr
cargo run --bin ssr -- crates/runtime/tests/fixtures/tracker.plan.json
# in ../frontend (Node 24, Chromium on PATH or $CHROMIUM):
RUST_SSR=$PWD/../rust-solid/target/debug/ssr node --experimental-strip-types --conditions=browser --conditions=development --test ssr/ssr.test.ts
npm run ssr-fuzz -- --seeds 1000 --start 1 --dev --rust ../rust-solid/target/debug/ssr
npm run ssr-fuzz -- --seeds 2000 --start 1001 --dev --rust ../rust-solid/target/debug/ssr
npm run ssr-corpus -- --start 1 --seeds 300 --max 16 --out ../rust-solid/crates/runtime/tests/fixtures/ssr
```
