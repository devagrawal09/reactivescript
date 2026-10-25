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

- The reactive helpers (`__rt`: sources, question sources, the optimistic
  layer, actions as generators, effects with the error arm, typed
  boundaries, value-level catches, contexts, module factories) ship as a
  small runtime package over `@solidjs/signals` and `solid-js`, in a client
  and a server build — `ref/compile/rt-web.ts` and `rt-server.ts` are their
  reference. The two builds create the same owners in the same order (10,
  Implementation); where the client creates one the server has no
  counterpart for, the server reserves its ids. A value-level catch
  primitive that Solid provided on both sides would retire the last of
  those reservations.

## CP-5 — `ref/` is the conformance suite

- The Rust crate is correct when it passes `scenarios/` through the same
  four runners: the compiled runner's string-tree renderer, and the server
  runner's served, hydrated and browser-only tables. `ref/` keeps the
  TypeScript implementation as the specification of each pass and as the
  oracle the crate is diffed against; it is not the thing being shipped.

## Decisions taken by default (veto here)

1. **The helper API is `__rt`'s shape** as `ref/compile/rt.ts` has it; a
   name or signature there is a reference, not a commitment, until the
   runtime package exists.
2. **`compile_program` is proposed upstream as the seam** rather than
   vendoring Solid's back ends. If upstream declines, the fallback is a
   pinned fork exposing the same function — not a reimplementation.
