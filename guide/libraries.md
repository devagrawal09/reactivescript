# Using TypeScript modules and Solid libraries from .rx

A `.ts` module (your server client, your helpers, a Solid library's primitives) is used from .rx as it is. The
compiler reads it with TypeScript and generates its declaration: every export, its types, and the rows .rx needs.
Facts TypeScript has no words for, such as "safe to call from reactive code", "rejects with `NotFound`" or "hands
back an accessor", are written in the `.ts` as *brands*. A brand is a type from `@reactivescript/types` that
erases and costs nothing.

```ts
// media.ts (no media.d.rx needed)
import type { Pure, Rejects, Ref, Instantiates } from "@reactivescript/types"
import { createSignal, createMemo } from "solid-js"

export class NotFound extends Error {}
export type User = { id: number; name: string }

export async function fetchUser(id: number): Pure<Rejects<Promise<User>, NotFound>> { … }
export async function saveUser(u: User): Promise<void> { … }                 // no brand: io
export function createToggle(initial: boolean): Pure<[Ref<boolean>, (v: boolean) => void]> { … }
export function createDebounced(source: Ref<string>, ms: number): Pure<Ref<string>> { … }
export function createMediaQuery(query: string): Pure<Ref<boolean>> { … }
export function createEventListener(target: EventTarget, type: string, handler: (e: Event) => void): Pure<Instantiates<void>> { … }
```

| brand | where | what .rx gets |
| --- | --- | --- |
| `Pure<R>` | the return type | callable in reactive code (an equation, a loader), not only in actions and handlers |
| `Rejects<Promise<T>, A \| B>` | the return type | its promise rejects with `A` or `B` only, so `catch (e: A)` and `errored fallback(e: B)` can be exhaustive |
| `Ref<T>` | a parameter | you pass a plain value. The compiler passes `() => value`, so the library follows it |
| `Ref<T>` | the return type, or a tuple element or property of it | a *reader*: bound to a name, read without a call (`isOn`, not `isOn()`) |
| `Instantiates<R>` | the return type | the call makes state and runs once. Implied by any `Ref`, so write it only without one |
| `Server<R>` / `Client<R>` | the return type | runs on that side only (`server`/`client` JS) |

Brands go on the **return type**, wrapped around each other in any order (`Pure<Rejects<Promise<User>, NotFound>>`),
and `Ref` also goes on a parameter. A brand anywhere else is `DECLARATION_BRAND`, reported in the `.ts`.

Without a brand, an export is the safe default:

- a function is **io** (only imperative code calls it) and may reject with any `Error`;
- a class extending `Error` is an error class you can catch by name;
- a `type` or `interface` is a type: `import { User } from "./media"` and it erases from the JavaScript;
- any other value (a `const`, an object, an enum) is a plain value.

To see what the compiler made of a module, run `npx rx-dts src/media.ts`. It prints the declaration as `.d.rx` text,
which is also what the MCP's `node` shows for an import.

- **`ref` is an accessor.** In a parameter, the library takes an accessor (Solid's `Accessor<T>`, which `Ref<T>` is);
  in a result, it hands one back. In .rx you pass and read plain values, and the compiler adds the `() => …` and
  the call.
- **A function in a result is io.** A setter can be called only in imperative code (an action, a handler).
- **Anything else is a value.** A store a library returns is a value whose fields track, as in Solid.
- `Pure` is right for a primitive: making it writes nothing but its own state.

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
  one that ships none, re-export what you use from a local `.ts` and brand it there (or declare it in a `.d.rx`).
- **Overriding one export of a `.ts`** whose source you can't brand: a line in `media.d.rx` replaces that export's
  generated line, types included. Every export it doesn't mention keeps its generated line.

A declaration can use type parameters (`export pure fn identity<T>(value: T): T`), private type aliases, and types
imported from another module (`import { Card } from "./server"`). `rejects(Offline, Stopped)` and
`rejects(Offline | Stopped)` declare the same row. What wins, per fact: a `.d.rx` line, then a brand, then
`import pure` / `fails(…)` at the import (only where the fact was left to the default), then the default.

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
- **Without a brand or a declaration,** an import is io unless you import it `pure`, and `import pure` of a primitive
  is unchecked: the call is then an equation, re-run (and the primitive rebuilt) whenever an argument changes. Brand
  primitives instead.

Rules: `spec/09-modules.md` MO-11 (generated declarations and brands), MO-10 (Solid libraries), MO-8 (declaration files).
