# compiler — ReactiveScript's crate

The production compiler (spec/11 CP-1a): a Rust crate, `reactivescript`, with
the command line `rxc`. It has parse (07), modules (09), check (02–06, 08),
signatures (MO-9) and the resolved model between check and lower (CP-6),
ported from `ref/src/`, and the lowering, ported from `ref/compile/`: each
module is built as an `oxc_ast::Program` and handed to Solid's
`solidjs-compiler` (`compile_program`, CP-1c; styles through `compile_style`,
CP-1d). Both give the same answers as the reference.

| module | port of | |
| --- | --- | --- |
| `parse.rs`, `ast.rs` | `ref/src/parse.ts`, `ast.ts` | `.rx` and `.d.rx` declarations; the AST serialises as the reference's does |
| `modules.rs` | `modules.ts` | the module graph, MO-5 cycles, MO-6 missing modules, MO-8/MO-9 declaration files |
| `check.rs` | `check.ts` | every diagnostic, with the reference's messages |
| `signature.rs` | `signature.ts` | a module's signature, printed and read back as `.d.rx` |
| `content.rs` | `content.ts` | SV-7d HTML nesting |
| `model.rs` | `model.ts` | CP-6: regions, symbols, computations with their reads, writes and calls |
| `emit.rs`, `awaits.rs` | `ref/compile/emit.ts`, `awaits.ts` | the lowering: `__rt` calls around JSX views, and each target through Solid |
| `js.rs`, `oxc.rs` | | the lowered module as a tree, then as an Oxc program (spans: spec/11 CP-1c) |

The Solid pin (`solidjs-compiler` in `Cargo.toml`) must be the commit in
`ref/SOLID_NEXT`.

```sh
cargo build --release
target/release/rxc check ../examples/todo.rx     # diagnostics
target/release/rxc model ../examples/todo.rx     # the resolved model, as JSON
target/release/rxc compile ../examples/todo.rx --out out   # modules (dom; --target ssr|universal), source maps onto .rx, style.css
target/release/rxc app ../examples/todo.rx       # the same as JSON, imports by .rx path: what vite-plugin-rx/ calls
npm --prefix ../ref run crate                    # CP-5: the crate against ref/ on every program
npm --prefix ../ref run crate -- --lower         # … and the lowered JavaScript, for every target, and its source maps
RX_CRATE=1 npm --prefix ../ref run compiled      # the scenarios, run on the crate's output
RX_CRATE=1 npm --prefix ../ref run ssr           # … served and hydrated from the crate's output
```

`ref/` stays the specification: a change of behaviour lands there first (with
its scenario), then here, and `ref/crate.ts` keeps the two equal.
