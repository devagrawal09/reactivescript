# 11 — The compiler

**Status: RULED 2026-10-24.** Where the production compiler lives and what it
reuses. `ref/` is the executable spec, not the product; this document says
what the product is so that `ref/` is built to be its conformance suite.

Ruling: **a separate Rust crate on top of Solid's `solidjs-compiler` crate.**
ReactiveScript owns parsing, checking and modules; Solid's crate owns the
JSX lowering. The alternative considered and declined: an `.rx` front end
inside `@solidjs/compiler`, beside TSRX. Earlier messages in the design
record argued each way; this is the decision.

---

## CP-1 — Two crates, one seam

- **CP-1a (ReactiveScript's crate).** Parses `.rx` and `.d.rx` (07), loads
  the module graph (09), checks the program (02–06, 08: rows, failures,
  regions, signatures, contexts), and lowers it: the reactive declarations
  to calls on the runtime helpers (`__rt`, the API `ref/compile/rt*.ts`
  defines) and the views to JSX — as an `oxc_ast::Program` in an Oxc
  `Allocator`, never as text.
- **CP-1b (Solid's crate).** `solidjs-compiler` lowers that program for a
  target — `dom`, `ssr`, `universal`, `dynamic`, hydratable or not — with
  the shared back ends every Solid source goes through. Hydration keys,
  marker regions, which holes are scoped and which fragment entries are
  memos (`documentation/hole-owner-id-matrix.md` on `next`) are its
  decisions; ReactiveScript makes none of them.
- **CP-1c (The seam).** One entry point Solid's crate does not yet export:
  compile from a `Program` instead of source text. `compile_inner` in
  `packages/compiler/src/compiler.rs` already has the shape — the TSRX
  route hands a lowered `Program<'a>` into the same `match options.generate`
  the text route reaches after `parse_program` — so the entry is that
  function with the parse step split off:

  ```rust
  pub fn compile_program<'a>(
      allocator: &'a Allocator, program: Program<'a>, source: &str, options: &CompileOptions,
  ) -> Result<CompileOutput, CompileError>
  ```

  `source` is the authored `.rx` text, which the back ends only use for
  spans; ReactiveScript's lowering keeps authored spans on the nodes it
  clones and leaves generated nodes unspanned, as the TSRX front end does
  (`frontend-notes.md`, "Stage 3"), so source maps and diagnostics come out
  on `.rx` positions. This is the only change the ruling asks of Solid; it
  is additive and shared with any other front end that produces an AST.

- **CP-1d (Styles: a second seam).** Scoped styles (07 §6b) are TSRX's
  engine, `compile_style` in `packages/compiler/src/tsrx/style/`, which
  "deliberately has no dependency on the TSRX/Oxc frontend; the frontend
  only needs to translate its template into `Element` values". It is a
  private module today. The second additive change asked of Solid is to
  export it (`compile_style`, `StyleInput`, `Element`, `StyleOutput`), so
  ReactiveScript's crate hands it a `.rx` view's elements and gets back the
  stylesheet, its hash and the elements to annotate — the same bytes a
  `.tsrx` file gets. (`ref/` reaches the engine by compiling a synthetic
  `.tsrx` fragment of the view.)

## CP-2 — Why not inside `@solidjs/compiler`

- `transform()` is Solid's public contract: one source module in, one
  module out, no state between calls. ReactiveScript's checks are whole-
  program — a signature is computed from the exporting module (MO-3), a
  failure is discharged through an imported component's summary (R-f-5),
  cycles are refused (MO-5), `.d.rx` files declare JS modules (MO-8). A
  per-module slot beside TSRX cannot hold them without a second,
  multi-module contract inside Solid's compiler, which would exist for one
  front end.
- TSRX fits that slot because it has no semantic layer: it is syntax that
  desugars to Solid's control flow and leaves every binding as authored.
  ReactiveScript is the semantic layer; the compiler is most of the
  language.

## CP-3 — Why not text

- `ref/compile/jsx.ts` emits JSX text and calls `transform()`. That is the
  right cost for the spec and the wrong one for the product: Solid's own
  runtime compilation moved off text projection ("no generated Solid-JSX
  text is parsed", `frontend-notes.md`) because a projection loses
  positions. A diagnostic on a `.rx` line and a source map to it need the
  AST route.

## CP-4 — The runtime

- **CP-4a (The package).** The reactive helpers ship as a small runtime
  package over `@solidjs/signals` and `solid-js`, in a client and a server
  build — `ref/compile/rt-web.ts` and `rt-server.ts` are their reference
  (`rt.ts` is the client's over the test renderer). Each build exports
  `createApp(options)`; a compiled module's default export is a function of
  the app (`main(__rt)`, or `module(__rt)` for a dependency, MO-1), so the
  helpers below are properties of `__rt`. The two builds create the same
  owners in the same order (10, Implementation); where the client creates
  one the server has no counterpart for, the server reserves its ids. A
  value-level catch primitive that Solid provided on both sides would
  retire the last of those reservations. Nothing in it adds run-time
  behaviour beyond Solid: each helper is a Solid primitive, a composition of
  them, or plain JavaScript the compiler would otherwise inline.
- **CP-4b (The names, pinned 2026-10-26).** What compiled code calls. The
  Rust crate emits exactly these; a change is a change to both.

  | `__rt.` | lowers | over |
  | --- | --- | --- |
  | `source(name, init)` | `source x := e` (ST-1, ST-2a) | `createSignal`; structured: `createStore` behind a signal slot |
  | `question(name, fn, opts, mode, key?)` | `source x = e` (ST-5), with a guess (AC-3) or path writes | `createSignal(fn)`, `createOptimistic`, `createStore(fn)`, `createOptimisticStore` |
  | `memo(name, fn, opts)` | an equation (E-1), a hoisted `await` (R-1) | `createMemo` |
  | `deferred(name, fn, opts)` | `deferred x = e` (H-1) | `createDeferred` |
  | `keyed(name, key, fn)` | `x key k = e` (ST-4) | `createMemo` + `createProjection` |
  | `draft(seed, body)` | `x = draft(pre x -> s) { … }` (ST-3) | `createProjection` |
  | `pre(get)`, `preOr(v, init)` | `pre y -> i` of another node (C-2) | `createMemo` |
  | `firstPaint(f)` | `await e -> v` (R-7) | the `loadingValue` option |
  | `clientQuestion(opts)` | an awaited call into `client` JS (SV-7b) | the `ssrSource: "client"` option |
  | `awaited(v)` | `await e` — the flight the memo returns or the action yields | identity on a promise |
  | `hoisted(name, get)` | an equation's hoisted awaits, which `refresh` re-asks with it | — |
  | `effect(n, inputs, apply)` | `effect (…) { … }` (EF, E-12) | `createEffect(compute, { effect, error })` |
  | `action(gen)` | `action f(…) { … }` (AC-1, AC-7) | `action` over a generator |
  | `refresh(name, get)`, `affects(get)`, `until(p)` | AC-4, AC-5, AC-6 | `refresh`, `affects`, `until` (`until`: client build only) |
  | `snapshot(get)` | an imperative read (H-10, R-f-7) | `untrack` |
  | `untrack`, `latest`, `isPending` | `peek` (E-5), `latest` (R-12), `pending?` (R-9) | the same |
  | `eq(a, b)`, `fmt(v)` | `==` through a store (ST-2), a template part | — |
  | `errorClass(name, params, msg)`, `isA(e, classes)`, `PANIC` | `error C(…)` (R-f-1), a typed catch, `Panic` (R-f-10) | a subclass of `Error` |
  | `throw(e)` | `throw` as an expression (R-f-3) | — |
  | `catchMemo(f, match, alt)` | `x = await … catch …` (R-f-4 over an equation's flight) | `createErrorBoundary` |
  | `catchRead(f, match, alt)` | `e catch …` in reactive scope (R-f-4) | `createErrorBoundary` |
  | `tryCatch(f, match, alt)` | `e catch …` in imperative scope | `try` |
  | `context(name, dflt)`, `provide(c, entry)`, `use(c, owner)`, `useGet(c, owner)`, `owner()` | contexts (RG-7) | `createContext`, `setContext`, `getContext`, `getOwner` |
  | `module(key, factory)` | an `.rx` dependency, once per app (MO-1) | — |
  | `serverRef(name, fn)`, `serverCall(name, gen, args)` | a server fn as the client calls it, and its body (12 SF-2, SF-6, SF-7) | Solid's `"use server"` functions |
  | `show(v)`, `scopedClass(v, hash)` | `{e}` (a value formatted, a view inserted), a dynamic class with the view's scope (CSS-2) | — |
  | `TypedErrored`, `Portal` | `errored fallback(e: A)` (R-f-4), `portal` (RG-8) | `Errored`, `Portal` |
  | `B` | the language's built-in functions (`len`, `str`, `map`, `filter`, `sum`, `every`) and `log` | — |

  The app itself: `mount(view, hydrating)` in the client build, `stream(view,
  sink)` in the server's.
- **CP-4c (The harness's, not the package's).** `reg`, `lookup`, `dget`,
  `dset` (a scenario's `handler` rows reach any live binding by name),
  `api` and `jsError` (`./api` and its declared errors as test flights,
  where a program imports the real module), `B.fetch` and `B.fail` (the
  scenario prelude), and `flights`, `lastKey`, `log`, `asyncError`,
  `frame` (what the runners observe). Compiled code calls them only in a
  conformance build — the compiler's option for running `scenarios/`
  (CP-5); `ref/compile/emit.ts` always emits one.

## CP-5 — `ref/` is the conformance suite

- The Rust crate is correct when it passes `scenarios/` through the
  runners that execute compiled code — the compiled runner's string-tree
  renderer, and the server runner's served, hydrated and browser-only
  tables — and through the types runner (13), with its checker's verdicts
  equal to `ref/src/check.ts`'s on every program and rejected variant.
  `ref/` has five runners: those, plus the interpreter and the oracle,
  which the crate is diffed against rather than run through. `ref/` keeps the
  TypeScript implementation as the specification of each pass and as the
  oracle the crate is diffed against; it is not the thing being shipped.

## Decisions taken by default (veto here)

1. **The helper API is CP-4b's** (pinned 2026-10-26, taken by default —
   veto here). Renamed from the reference's first names, so that a name says
   which rule it lowers: `qsource` → `question`, `prevOf` → `pre`, `orInit`
   → `preOr`, `lv` → `firstPaint`, `cq` → `clientQuestion`, `cls` →
   `scopedClass`, `snap` → `snapshot`, `aw` → `awaited`, `raise` → `throw`
   (07 decision 11), `catchAcc` → `catchMemo`, `caughtRead` → `catchRead`.
   The rest kept their names, most of them Solid's.
2. **`compile_program` is proposed upstream as the seam** rather than
   vendoring Solid's back ends. If upstream declines, the fallback is a
   pinned fork exposing the same function — not a reimplementation.
