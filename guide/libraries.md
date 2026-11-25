# Using TypeScript modules and Solid libraries from .rx

A `.ts` module (your server client, your helpers, a Solid library's primitives) is used from .rx as it is. The
compiler reads it with TypeScript and generates its declaration: every export, its types, and the rows .rx needs.
Facts TypeScript has no words for, such as "safe to call from reactive code", "rejects with `NotFound`" or "hands
back an accessor", are stated in the `.ts` with *helpers* from `@reactivescript/js`. A helper wraps your function
and returns it unchanged. TypeScript infers through it, so you write no return types.

```ts
// media.ts (no media.d.rx needed)
import { pure, rejects, ref, instantiates } from "@reactivescript/js"
import { createSignal, createMemo, type Accessor } from "solid-js"

export class NotFound extends Error {}
export type User = { id: number; name: string }

export const fetchUser = pure(rejects([NotFound], async (id: number) => { … }))
export async function saveUser(u: User) { … }                       // no helper: io
export const createToggle = ref({ result: [0] }, (initial: boolean) => createSignal(initial))
export const createDebounced = ref({ args: [0], result: true }, (source: Accessor<string>, ms: number) => …)
export const createMediaQuery = ref({ result: true }, (query: string) => …)
export const createEventListener = instantiates((target: EventTarget, type: string, handler: (e: Event) => void) => { … })
```

| helper | what .rx gets |
| --- | --- |
| `pure(fn)` | callable in reactive code (an equation, a loader), not only in actions and handlers |
| `rejects([A, B], fn)` | its promise rejects with `A` or `B` only, so arms for `A` and `B` in one `catch` or `errored fallback` cover the row. Pass the classes themselves, not their names |
| `rejects([], fn)` | its promise never rejects (it reports problems in its result), so an `await` of it needs no `catch`. It is still io |
| `ref({ args: [0] }, fn)` | parameter 0 takes an accessor. You pass a plain value, and the compiler passes `() => value`, so the library follows it |
| `ref({ result: true }, fn)` | the result is a *reader*: bound to a name, read without a call (`wide`, not `wide()`). `result: [0]` marks tuple element 0, `result: ["value"]` a property |
| `instantiates(fn)` | the call makes state and runs once. Implied by any `ref`, so write it only without one |
| `server(fn)` / `client(fn)` | runs on that side only (`server`/`client` JS) |

Helpers nest, in any order, each once: `pure(rejects([NotFound], fn))`. `ref` and `instantiates` already
imply `pure`; adding the `pure` wrapper is a type error. Write the call as the value of an
exported `const`. A helper anywhere else, a `ref` spec or `rejects` list that isn't written out literally, or a
`ref` index that isn't an accessor is `DECLARATION_HELPER`, reported in the `.ts` (TypeScript catches most of these
first). At run time a helper is the identity function, so a production bundle pays one call per export.

Without a helper, an export is the safe default:

- a function is **io** (only imperative code calls it) and may reject with any `Error`;
- a class extending `Error` is an error class you can catch by name;
- a `type` or `interface` is a type: `import { User } from "./media"` and it erases from the JavaScript;
- any other value (a `const`, an object, an enum) is a plain value.

To see what the compiler made of a module, run `npx rx-dts src/media.ts`. It prints the declaration as `.d.rx` text,
which is also what the MCP's `node` shows for an import.

- **`ref` is an accessor.** In a parameter, the library takes an accessor (Solid's `Accessor<T>`); in a result, it
  hands one back. In .rx you pass and read plain values, and the compiler adds the `() => …` and
  the call.
- **A function in a result is io.** A setter can be called only in imperative code (an action, a handler).
- **Anything else is a value.** A store a library returns is a value whose fields track, as in Solid.
- `pure` is right for a primitive: making it writes nothing but its own state.

## A `.d.rx`: plain JS, packages, and overrides

A `.d.rx` file says the same in .rx's words, one line per export:

```rx
// media.d.rx
export pure fn createToggle(initial: boolean): [ref boolean, (v: boolean) => void]
export pure fn createDebounced(ref source: string, ms: number): ref string
export pure fn createEventListener(target: EventTarget, type: string, handler: (e: Event) => void) instantiates
export fn saveUser(u: User): Promise<void>
export error NotFound
export const fields: string[]
```

You need one in three cases:

- **Plain JavaScript with no types** (`./media.js` alone): `./media.d.rx` beside it declares it, every export.
- **A package:** one that ships a `.d.rx` needs nothing. The compiler resolves the import the way a bundler does
  (`exports`, `module`, `main`) and reads the `.d.rx` beside that file (`dist/index.jsx` → `dist/index.d.rx`). For
  one that ships none, re-export what you use from a local `.ts` with its helpers
  (`export const createMediaQuery = ref({ result: true }, lib.createMediaQuery)`), or declare it in a `.d.rx`.
- **Overriding one export of a `.ts`** whose source you can't change: a line in `media.d.rx` replaces that export's
  generated line, types included. Every export it doesn't mention keeps its generated line.

A declaration can use type parameters (`export pure fn identity<T>(value: T): T`), private type aliases, and types
imported from another module (`import { Card } from "./server"`). `rejects(Offline, Stopped)` and
`rejects(Offline | Stopped)` declare the same row. What wins, per fact: a `.d.rx` line, then a helper, then the
default.

`import pure { f } from "./api"` on a local TS module fails with `IMPORT_ROW_ON_TS`.
Write `export const f = pure(…)` in `api.ts` instead, then import it without `pure`. The error also names the helper
for `fails`, `server` or `client`. On a plain-JS package with no TS module beside it, `import pure` is still available.

## Use it

```rx
import { createToggle, createDebounced, createMediaQuery } from "./media"

export component Search(props: { start: boolean, q: string }) {
  [isOn, setOn] = createToggle(peek props.start)   // runs once; peek: `start` is read once, and you mean it
  query = createDebounced(props.q, 300)            // passed as an accessor: it follows props.q
  wide = createMediaQuery("(min-width: 768px)")
  action flip() { setOn(!isOn) }

  <button onClick={flip}>{isOn && wide ? query : "off"}</button>
}
```

`isOn`, `query` and `wide` are equations like any other: read them without calling them. They may hold, like a
value from an `await` (Solid promises nothing about an accessor), so `latest`, `pending?` and `loading` apply.

What the compiler catches:

| you write | you get |
| --- | --- |
| `createToggle(props.start)` | `SNAPSHOT_ARGUMENT`: a value argument is read once; write `peek props.start`, or the library should take `ref` |
| `x = setOn(true)` | `IO_IN_REACTIVE`: a setter is called from an action or handler |
| `<p>{createMediaQuery(q)}</p>` | `INSTANTIATION_NOT_BOUND`: bind it, `wide = createMediaQuery(q)` |

## What stays the library's

- **Its setters are not writes of a source.** The compiler can't see them as writes, so a read right after one, in
  the same action, gives the value from before it (Solid batches the write), and nothing warns you:

  ```rx
  action flip() {
    setOn(!isOn)
    label := isOn ? "on" : "off"     // still the old isOn
  }
  ```

  Compute the new value once and use it: `let next = !isOn; setOn(next); label := next ? "on" : "off"`.
- **Callbacks you pass are plain functions.** An action passed as `handler` is checked as an action; a plain closure
  is not checked beyond what any closure is.
- **Without a helper or a declaration,** an import is io. `import pure` of a JS primitive is unchecked: the call is
  then an equation, re-run (and the primitive rebuilt) whenever an argument changes. Wrap primitives in `ref(…)`
  instead.

Rules: `spec/09-modules.md` MO-11 (generated declarations and helpers), MO-10 (Solid libraries), MO-8 (declaration files).
