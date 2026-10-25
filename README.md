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
  12-server-functions.md  server fn / server action; the server and client rows; what crosses the wire
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
