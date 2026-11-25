# @reactivescript/js

Helpers a `.ts` module wraps its exports in, so that `.rx` code importing it knows what TypeScript has no words
for. ReactiveScript generates the module's declaration from TypeScript (`rx-dts`, spec/09 MO-11). The
helpers add the facts.

```ts
import { pure, rejects, ref, instantiates, server } from "@reactivescript/js";

export class NotFound extends Error {}
export const fetchUser = pure(rejects([NotFound], async (id: number) => (await get(`/u/${id}`)) as User));
export const createToggle = ref({ result: [0] }, (initial: boolean) => createSignal(initial));
export const createDebounced = ref({ args: [0], result: true }, (source: Accessor<string>, ms: number) => …);
export const listen = instantiates((el: EventTarget, type: string, h: (e: Event) => void) => …);
export const getSecret = server(async () => …);
```

| helper | generates |
| --- | --- |
| `pure(fn)` | `pure fn`: safe to call in reactive scope (R-io-4) |
| `rejects([A, B], fn)` | `rejects(A \| B)` (R-f-8). An array literal of classes, each reaching `Error`; `rejects([], fn)` is `rejects(nothing)`, a promise that never rejects |
| `ref({ args?, result? }, fn)` | `ref` parameters (indices) and a `ref` result: `true`, tuple indices or object keys (MO-10a/b). A literal |
| `instantiates(fn)` | `instantiates`, where no `ref` is present (MO-10a) |
| `server(fn)` / `client(fn)` | `server fn` / `client fn` (12 SF-5). Not both |

- **Nesting** is the one way to combine them, in any order, each at most once: `pure(rejects([E], fn))`.
- **Where:** the helper call is the whole initializer of an exported `const`, or an `export default`
  expression. Anywhere else it is `DECLARATION_HELPER`.
- **Types:** each helper is `<F>(…, fn: F) => F`, so nothing is annotated twice. `rejects` takes error
  classes, and `ref`'s indices and keys are checked against `fn`'s parameters and result.
- **Runtime:** each helper returns `fn` itself. The package has no side effects (`"sideEffects": false`, and
  every helper is marked `/*#__NO_SIDE_EFFECTS__*/`), so a bundler drops what goes unused.

An export with no helper gets the sound default: a function is io and rejects `Error`, a class extending
`Error` is an error class, and a type is a type.

The helpers share one internal hook, kept for later dev checks. It is not part of the API.
