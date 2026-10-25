# ReactiveScript

Codename for a language that carries Solid 2.0's reactive semantics as language
semantics: equations by default, writes confined to imperative scope, ownership
and async (pending, holds, lanes) as things the compiler checks rather than the
runtime warns about.

This repository is the **spec** and its **reference implementation**. The
production compiler is a separate Rust crate over Solid's own
`solidjs-compiler` (`spec/11-compiler.md`): ReactiveScript parses, checks
and lowers to an Oxc AST; Solid's compiler lowers the JSX. `ref/` is its
conformance suite, run on Solid's `next` branch built from source.

## Layout

```
spec/
  00-vocabulary.md     the nouns; each mapped to its Solid 2.0 term
  01-scopes.md         reactive vs imperative scope; lexical inheritance
  02-core.md           the synchronous calculus: syntax, static rules, instants, pre, causality
  03-regions.md        ownership, disposal, escape
  04-rows.md           effect rows: pending, lane, io, fails; inference
  05-holds.md          the two-version store; Solid's F-1…F-12 restated over the calculus
  06-stores.md         structured types, paths, draft, key/reconcile, follows
  07-surface.md        concrete syntax — written LAST
  08-constraints.md    what the compiler refuses, how, and the escape (Rust stance)
  09-modules.md        .rx modules: what an import binds, the value boundary, signatures
  10-server.md         SSR as the streamed mount; what runs where; hydration; what crosses
  11-compiler.md       the production compiler: a crate on solidjs-compiler; the one seam it needs
  12-server-functions.md  server fn (io inferred, the call site decides); the server and client rows; the wire
  99-diagnostics.md    Solid 2.0's diagnostic table, each code binned: unwritable / static / runtime
scenarios/             one file per scenario: program, action, frames, compiles-or-rejects
ref/                   interpreter, checker, Solid oracle, compiler and server runner (TypeScript) — all run scenarios/
```

## Discipline

1. **Core before holds.** `02-core.md` is finished and `ref/` passes its scenarios
   before `05-holds.md` opens. The two are separate documents on purpose.
2. **Rules and screens, not prose.** Every claim is a numbered rule or a scenario
   (program → action → frames → verdict). A section that cannot be written that
   way is not ready.
3. **One grammar.** `07-surface.md` is the concrete syntax; `ref/` parses it
   and every scenario is written in it. `02-core.md §1` keeps the abstract
   syntax the rules are stated over.
4. **Solid's fundamentals are upstream.** `05-holds.md` inherits
   `packages/signals/docs/RULES-FUNDAMENTALS.md` from `solidjs/solid@next`. An
   open question there (Q-n) is open here; this spec does not rule on it.

## Rule IDs

- `V-n` vocabulary · `SC-n` scopes · `E-n` equations · `W-n` writes · `C-n` causality
- `O-n` ownership · `R-n` rows · `H-n` holds (each cites the Solid `F-n` it restates)
- `ST-n` stores · `X-n` surface · `D-n` diagnostics (binned)

Scenario IDs: `S-core-n`, `S-region-n`, `S-hold-n` (the latter mirror Solid's `S-n`).

## References

- **Revisiting ReactiveScript** —
  <https://hackmd.io/@0u1u3zEAQAO0iYWVAStEvw/BktlDvq9R>. The case for the
  language as *strictness*, narrowed to two concerns, and where this spec
  answers each:
  - *Signals vs stores* — one `source`, atomic or structured behind a signal
    slot (06 ST-1, ST-2a); a mutable derivation is a `draft` (ST-3, its
    `$project`); `$memo` is an equation (E-1), `$async` an `await` in an
    equation's tail (R-1).
  - *Read vs write* — writes only in imperative scope (W-1, W-2), only by
    the declaring region or what it nests (W-5, O-4); an imported source is
    read-only and is written through the actions its module exports (09
    MO-2a).
  - *Reactivity crossing a function boundary* (its open question: what a
    `$` function may return) — reactivity is a property of names, not
    values: a `ref` parameter takes an equation by reference (E-9), an
    instantiating `fn` runs once and its tail is bound as an equation in
    the caller (03 RG-6), and a writer crosses only as an `action` the
    tail carries (`{ value: n, inc }`), never as a setter.
  - *Superset of `.tsx`, no SFCs* — partly: expressions and JSX are TS's
    verbatim and a file is a module (07 §1), but declarations are keywords
    (`source`, `x = e`), so `.rx` is not a superset of `.tsx`.
