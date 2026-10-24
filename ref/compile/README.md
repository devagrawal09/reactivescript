# ref/compile — `.rx` → JavaScript

The compiler's back half, in TypeScript first (the Rust port follows once this
is pinned). A checked program becomes an ES module over `solid-js` 2.0; the
lowering decisions are the oracle's (`ref/oracle/lower.ts`), made at compile
time instead of run time.

| file | what |
| --- | --- |
| `emit.ts` | the code generator: `compile(program) → string`. Lexical scopes become JS scopes; every region is a function, every declaration a `const`, in dependency order (E-7 + C-1 make it a DAG). Names are mangled: `v$x` the value or accessor, `w$x` a source's writer, `p$x` a companion `pre` memo. |
| `rt.ts` | the runtime the module calls (`__rt`): sources (atomic → signal; structured → store behind a signal slot), question sources (with an optimistic layer), effects with an error arm, actions as generators, provisions as context, view helpers over `@solidjs/universal`. Renderer node operations are a parameter: a string tree for tests, `domNodes(document)` for the browser. |
| `run.ts` | compiles every scenario's program, imports it, drives it through the scenario's rows. The output is Solid code, so it must show what the oracle shows. |
| `build.ts` | `node --experimental-strip-types ref/compile/build.ts app.rx` → `ref/compile/.out/web/app/` (index.html with an import map, app.mjs, rt.mjs, api.mjs). Serve `ref/` and open `/compile/.out/web/app/`. |

```
node --experimental-strip-types --conditions=browser --conditions=development ref/compile/run.ts [filter]
```

Status: 71/71 scenarios pass as compiled modules (3 recorded divergences, the
same as the oracle's: Solid bugs DV-3 and DV-4). All seven example apps build
and run in Chromium against `examples/api.mjs`, a fake backend with delays.

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

A compiled module (S-core-1):

```js
const [v$count, w$count] = __rt.source("count", __rt.untrack(() => 0));
const v$double = __rt.memo("double", (__prev) => (v$count() * 2), undefined);
const p$double = __rt.prevOf(v$double);
const v$label = __rt.memo("label", (__prev) => ("prev " + __rt.orInit(p$double(), () => 0)), undefined);
__rt.effect(1, () => [v$double()], ($p) => __rt.untrack(() => { return __B.log(__rt.snap(v$double)); }));
return [__rt.el("p", [], () => [__rt.read(() => (v$show() ? v$double() : "-")), __rt.text(" "), __rt.read(() => v$label())])];
```

Not yet: nested `await` outside an equation's result position (the memo returns
the flight; an `await` inside an operand needs the body split into a chain of
memos); optimistic path writes and optimistic over a structured question
source; modules (`.rx` importing `.rx`); `@solidjs/web`'s template cloning (the
browser build uses the universal renderer with DOM node operations); source maps.
