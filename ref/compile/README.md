# ref/compile — `.rx` → JavaScript

The compiler's back half, in TypeScript first (the Rust port follows once this
is pinned). A checked program becomes an ES module over `solid-js` 2.0; the
lowering decisions are the oracle's (`ref/oracle/lower.ts`), made at compile
time instead of run time.

| file | what |
| --- | --- |
| `emit.ts` | the code generator: `compile(program) → string`. Lexical scopes become JS scopes; every region is a function, every declaration a `const`, in dependency order (E-7 + C-1 make it a DAG). Names are mangled: `v$x` the value or accessor, `w$x` a source's writer, `p$x` a companion `pre` memo. |
| `rt.ts` | the runtime the module calls (`__rt`, whose names spec/11 CP-4b pins): sources (atomic → signal; structured → store behind a signal slot), question sources (with an optimistic layer), effects with an error arm, actions as generators, provisions as context, view helpers over `@solidjs/universal`. Renderer node operations are a parameter: a string tree for tests, `domNodes(document)` for the browser. |
| `run.ts` | compiles every scenario's program, imports it, drives it through the scenario's rows. The output is Solid code, so it must show what the oracle shows. |
| `build.ts` | `node --experimental-strip-types ref/compile/build.ts app.rx` → `ref/compile/.out/web/app/` (index.html with an import map, app.mjs, rt.mjs, api.mjs). Serve `ref/` and open `/compile/.out/web/app/`. |

```
node --experimental-strip-types --conditions=browser --conditions=development ref/compile/run.ts [filter]
```

Status (2026-10-26): every scenario passes as compiled modules, with the
divergences the oracle records (Solid bugs). Every example app builds for the
browser (`build.ts`), against `examples/api.mjs`, a fake backend with delays.

A program of several `.rx` modules (spec/09) compiles to one ES module per
`.rx` module: a dependency's `mN.mjs` is a factory over the app that
`__rt.module` runs once per app, the entry's `main.mjs` instantiates its
dependencies at the start of its view (`examples/shop/`).

Failures (04 R-f) lower to Solid error boundaries: a typed `errored` hands
a failure of another class out of its fallback and a memo around it throws
it to the boundary above; `e catch (x: C) => alt` is an error boundary
around the read whose fallback is `alt` — in Solid an errored read reaches
the nearest boundary even inside a JS `try`, so a plain `try` would not
catch it. A catch over an equation's `await` reads an inner memo (the
flight) through such a boundary.

A compiled module (S-core-1's `App`; `__rt.reg` lines, the harness's, left out — spec/11 CP-4c). The view is
JSX, which Solid's compiler then lowers:

```js
const [v$count, w$count] = __rt.source("count", __rt.untrack(() => 0));
const [v$show, w$show] = __rt.source("show", __rt.untrack(() => true));
const v$double = __rt.memo("double", (__prev) => (v$count() * 2), undefined);
const p$double = __rt.pre(v$double);
const v$label = __rt.memo("label", (__prev) => ("prev " + __rt.preOr(p$double(), () => 0)), undefined);
__rt.effect(1, () => [v$double()], ($p) => __rt.untrack(() => {
  return __B.log(__rt.snapshot(v$double));
}));   // SC-2: the apply reads σ, untracked
return <><p>{__rt.show((v$show() ? v$double() : "-"))}{" "}{__rt.show(v$label())}</p></>;
```

Every `await` of reactive scope is lowered (07 §3): an equation's result is
its memo's flight; any other — inside an operand, in a reader, an attribute,
an effect's input or a provision — is its own memo (`a$…`), asked only while
the conditions that reach it hold (`src/awaits.ts`). In imperative scope an
`await` is a statement (06 AC-1): a `yield` in an action's generator, and
`let v = await e catch (x: C) => alt` a `try` around it.

A module known only by its `.d.rx` (09 MO-9) compiles: its imports are bound
by the signature's kinds, and its own JavaScript is imported from beside it
(`x.rx` → `x.mjs`).

Not yet: optimistic path writes mixed with plain writes to the same source,
and optimistic over a structured question source (06 AC-3); `@solidjs/web`'s
template cloning (the browser build uses the universal renderer with DOM node
operations); source maps.
