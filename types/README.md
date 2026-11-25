# @reactivescript/types

Type-level brands for a `.ts` module that `.rx` imports. ReactiveScript generates the module's declaration
from TypeScript (`rx-dts`, spec/09 MO-11). These brands say the facts TypeScript has no words for. They are plain
aliases, so they cost nothing: no runtime code, `"sideEffects": false`.

```ts
import type { Pure, Rejects, Ref } from "@reactivescript/types";

export class NotFound extends Error {}
export async function fetchUser(id: number): Pure<Rejects<Promise<User>, NotFound>> { … }
export function createDebounced(source: Ref<string>, ms: number): Pure<Ref<string>> { … }
```

generates

```rx
export pure fn fetchUser(id: number): Promise<User> rejects(NotFound)
export error NotFound
export pure fn createDebounced(ref source: string, ms: number): ref string
```

| brand | where | generates |
| --- | --- | --- |
| `Pure<R>` | head of the return type | `pure fn` (R-io-4) |
| `Rejects<Promise<T>, A \| B>` | head of the return type | `rejects(A \| B)` (R-f-8) |
| `Ref<T>` | a parameter, the result, a returned tuple element or object property | `ref` (MO-10a/b) |
| `Instantiates<R>` | head of the return type, with no `Ref` | `instantiates` (MO-10a) |
| `Server<R>` / `Client<R>` | head of the return type | `server fn` / `client fn` (12 SF-5) |

The wrapper brands nest in any order, each once. A brand is read where it is written: a local alias of a brand
is not followed. A brand anywhere else is `DECLARATION_BRAND`. Without a brand an export gets the sound
default: a function is io and rejects `Error`; a class extending `Error` is an error class; a type is a type.
