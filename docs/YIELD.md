# Yield frontend (spike): solid-yield's explicit generator dialect

A third frontend to ReactiveScript, next to RX and TSX: `yield/lower.ts` reads a module written in
[solid-yield](https://github.com/devagrawal09/solid-yield)'s explicit generator dialect, prints the Solid 2 TSX that
solid-yield itself maps it to, and lowers that TSX with the existing frontend (`tsx/lower.ts`) onto the pinned RX AST.
It reuses the Oxc parser, the whole TSX lowering and its refusals, and reaches upstream only through `tsx/rx/` (the
boundary test checks `yield/` too). A small subset is accepted; every other form is refused at its yield source.

## solid-yield and Solid

- **Commit:** solid-yield `fcc100e` ("docs(sound): compare whole-app noise results and remaining uncertainty").
  `/Users/devagr/solid-yield` is read-only. It was cloned into `../solid-yield` (push URL `NO_PUSH`), built there with
  `pnpm install --frozen-lockfile && pnpm build`, and its five packages were packed into `../solid-yield-packs`, as its README
  describes. The `0.0.0` tarball names do not identify the commit; this line does. `solid-yield` and
  `vite-plugin-solid-yield` are frontend devDependencies from those tarballs (npm overrides for `compiler-yield`),
  with `jsdom@^25.0.1`, as solid-yield's own tests use.
- **Solid:** solid-yield declares `solid-js` / `@solidjs/web` `^2.0.0-rc.11`; the pin is Solid 5e68925c (rc.20), which
  satisfies that range. The runtime bundle imports only `solid-js`, `@solidjs/web` and its own internals (not
  `@solidjs/h`, which the pinned checkout does not build). It **runs unmodified on rc.20**: the yield rule
  (`vite-plugin-solid-yield`'s `transform`), Solid's own compiler (`generate: "dom"`), and solid-yield's `render` in
  jsdom give the counter's `0`, `2`, `4` and the tracker's eight frames, equal to every RX leg. Not tried: SSR and
  hydration, the `h` dialect, native mode, lazy pages, async sources.
- **Fixtures are valid solid-yield:** `solid-yield check` (its CLI) reports 0 errors on both fixtures with a root that
  renders them, and `tsc` with `jsxImportSource: "solid-yield"` reports none; `render` accepts both roots, so their
  views are render-settled (P false, E and R empty).

## Construct mapping

| solid-yield | Solid 2 (solid-yield's own mapping) | RX | Spike |
| --- | --- | --- | --- |
| `component(function* Name(props: Props<{…}>) { setup; return view(…) })` | `function Name(props)` | `component Name(props: {…})` | lowered; `Source<T>` → `T`, `Handler<[A]>` → `(arg0: A) => void` |
| `const [x, setX] = yield* $signal(v)` | `createSignal(v)` | `source x := v` | lowered |
| `yield* x` (a read) | `x()` for an accessor; a path for a store, prop or row | a tracked read | lowered in holes, memos, events |
| `yield* $memo(function* () { const a = yield* s; return e; })` | `createMemo(() => e)` | `m = e` | lowered, synchronous only; read locals are substituted |
| `attempt(fn, onError)` | the promise awaited, the failure typed | `try { let r = await f() } catch` | lowered only in an event, absorbing handler, `if (r !== undefined)` guard, result annotated `T \| undefined` |
| `view(function* () { return <…/>; })`, holes `{yield* x}` | the JSX, reads | view markup with reads | lowered; no body, every read a hole |
| `For({ each, children: function* (item) { return view(…); } })` | `<For each>` | `for item in …` | lowered; no index, no keyed, no row setup |
| `Show({ when, fallback, children })` | `<Show>` | `if … else …` | lowered; lazy-view form, `when` a source or hole |
| `Switch` / `Match`, `Repeat`, `Loading`, `Errored` | Solid's own | `if` chains, `loading`, `errored` | refused |
| `$event(function* (…) { … })` | an `action` | `action name(…) { … }` | lowered; a bound event takes no parameters, events with parameters are called from events |
| `onClick={yield* evt}` | the action as the handler | a handler calling the action | lowered as `() => evt()` |
| events that wait (W): an `$event` reading a pending source | an action awaiting a pending read | an action awaiting a pending read | not reachable: the subset has no async sources |
| `$optimistic(v)` | `createOptimistic(v)` | question source, `optimistic x := …` | lowered |
| `$optimisticStore`, `$projection` | `createOptimisticStore`, `createProjection` | none / projections | refused |
| `$store(o)`, `yield* setX((d) => { … })` | `createStore`, a draft setter | `source x := o`, path writes | lowered |
| contexts: `createContext`, `yield* Ctx`, `Ctx.provide` | `createContext`, `useContext`, the provider | `context`, `use`, `provide` | refused |
| setup can't read | `READ_IN_SETUP` | a setup read is a snapshot (`peek`) | refused |
| `$effect(compute, effect)`, `$cleanup` | split effects, cleanups | `createRxEffect` / `effect` | refused |

## Semantic gaps, refused as #20 refuses ordinary async callbacks

Accepted yield code would behave differently from its RX lowering in these cases, so each is refused at its source:

- **A bare setter call** (`setX(v)` without `yield*`) writes nothing in solid-yield (a receipt, `UNYIELDED_WRITE`); lowered,
  it would write.
- **A read in a setup** is an error in solid-yield; RX's lowering would take a snapshot.
- **A read after an `attempt` inside an event:** in a solid-yield transaction a read gives the value from before the call;
  in the RX action it reads the value as it stands after the wait. Only the result, parameters and writes are allowed there.
- **Read after own write in an event:** solid-yield returns the pre-call value; RX's checker refuses it (AC-1d
  `STALE_OWN_READ`), so the lowered program is refused there (not exercised by a test yet). A write after a wait
  computed from a pre-wait read is refused the same way (AC-1e `STALE_WRITE_BACK`).
- **Typed failures** (`attempt` returning a `Failure`, `raise`, `Errored({ catch })`): RX's error classes and `catches`
  are not mapped yet.
- **`try`/`catch`, `throw`, `async` routines, component tags, spread props, `yield*` in call arguments**: not solid-yield
  forms (`no-try-catch`, `UNTYPED_THROW`, async refused, `no-component-tag`, `no-read-in-prop`).
- **A bound event with parameters** receives the DOM event in solid-yield; the subset does not model event objects.
- **`attempt` without the guard** is refused: the translation to `try`/`catch` is faithful only when the event continues
  inside `if (r !== undefined)`. **Unchecked gap:** it is also faithful only when the call never succeeds with
  `undefined`. The frontend takes the `T` of the `T | undefined` annotation as the result's shape and does not check it
  against the import's declaration (an annotation of `number` for a `string` import is accepted). An import resolving
  with `undefined` would run the success branch in RX, where solid-yield treats it as absorbed.

Not a gap, but a mapping: every `$event` is an action, so the yield counter is not the plain-handler TSX counter
(`tsx/fixtures/paired/counter.tsx`): its facts have an action computation, and the test asserts that difference. A
synchronous event's writes commit by the next microtask in solid-yield; frames are compared after settling.

## Static analysis: P / E / W / R and RX's checks

| solid-yield color | RX check | Agree in principle | Differ |
| --- | --- | --- | --- |
| **P**, may be pending; `render` refuses `PENDING_ROOT` | CN-3d `ASYNC_OUTSIDE_LOADING_BOUNDARY` (and `CLIENT_QUESTION_UNHELD` for served pages) | a pending read needs a `Loading` / `loading` above it | P is a type-level fold through calls, reported at the root; RX checks each reader over the static application tree, statically only for a client-only first load and otherwise at run time |
| **E**, may fail with these failure classes; the explicit root may re-throw | `UNHANDLED_FAILURE` (R-f-5, CN-6a), `UNCAUGHT_ACTION_FAILURE` (R-f-6) | a failure is handled by a boundary or caught | E is a set of nominal `Failure` classes from `attempt` handlers; RX error classes; solid-yield's explicit root may re-throw an unhandled failure, RX refuses statically; a bound event's failure goes to the nearest `Errored` in solid-yield, an RX action's must be caught |
| **W**, binds an event that may wait on a pending read (lint `no-unshown-wait`, a warning) | `PENDING_ASYNC_UNTRACKED_READ` (an unguarded snapshot of a value with no committed answer) | an event reading data that may be pending is flagged | W is admitted and only warned about; RX refuses the unguarded read |
| **R**, requires contexts without defaults (`NO_PROVIDER` at the root) | `CONTEXT_NOT_FOUND` (RG-7b) | a context without a default must be provided above its readers | R is a type-level fold reported at the root; RX checks the static application tree |
| (none: every `$event` is a declared transaction, holding by design, D-081) | `HELD_WRITE` (AC-1c) applies to inferred actions only | yield events lower to declared actions, which hold on purpose | `HELD_WRITE` cannot arise from yield code |
| reads in a transaction give pre-call values | `STALE_OWN_READ` (AC-1d), `STALE_WRITE_BACK` (AC-1e) | | solid-yield accepts with defined semantics; RX refuses, so the yield frontend refuses |

The subset exercises none of P, E, W or R (no async sources, no typed failures, no contexts): the fixtures are
render-settled, which both checkers accept.

## Evidence

`yield/paired.test.ts` (in `verify:subset` and the manifest): for the counter and the issue tracker in
`yield/fixtures/*.yield.tsx`, canonical facts equal to the handwritten RX (`*.rx`) and to the Solid TSX twin (`*.tsx`),
a detected fact change, and identical exact frames on five legs: solid-yield's runtime, compiled and interpreted RX
lowered from yield, compiled and interpreted handwritten RX. The tracker's `$optimistic` claim, success commit,
failure rollback and empty fallback match on all five; no action or optimistic difference was found for these forms.
A refusal matrix checks each refused form's diagnostic and location.

The yield tracker is not `tsx/fixtures/demo/tracker.tsx`: `$optimistic` takes only a value, so the optimistic copy of
the list the TSX demo uses would be `$optimisticStore` (refused). It claims with a scalar `$optimistic(0)` shown as "me".

## What blocks going further

- `$optimisticStore` / `createOptimisticStore`, async `$memo`s with `Loading`, typed failures with `Errored`, and
  contexts all need lowerings in the TSX frontend (or a direct yield-to-RX lowering) and, for P/E/R, a mapping of
  solid-yield's colors onto RX's static checks.
- Translating to TSX keeps one lowering but couples the yield frontend to the TSX frontend's subset; a direct lowering
  would need the TSX lowering's JSX and statement pieces exported as reusable functions.
- The reference leg runs solid-yield in jsdom with the DOM compiler; its server and hydration paths are untested here.
