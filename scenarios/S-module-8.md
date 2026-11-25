# S-module-8 — a TS module declares itself: generated rows, stated facts, one written override

Rules: MO-11a, MO-11b, MO-11c, MO-11d, MO-11e, MO-8c, MO-8d, MO-10a, MO-10b, R-io-4, R-f-8, TY-4b,
TY-4d. S-module-2's program, with its `.d.rx` replaced by the TS module it described. Here
`./api` is `api.d.ts`, a TS module with no implementation, so the runners still supply its
flights (MO-8c, as S-module-2's `api.d.rx` did) and the type layer reads it as TypeScript does. Its
declaration is generated from it (MO-11): its stated facts give `fetchUser` its rows, `logVisit`
has none (the default: io, `rejects(Error)`), and `api.d.rx` overrides `saveUser` alone. `./prims` is
`prims.d.ts`, the scenarios' Solid primitives (S-module-4), with a `ref` parameter and result.

A `.ts` states a fact with a helper call from `@reactivescript/js` (`export const fetchUser =
pure(rejects([NotFound, Offline], …))`, MO-11c). A `.d.ts` has no initializers to wrap, so these
modules state their facts with the package's v1 brand types (`Pure<…>`, `Rejects<…>`, `Ref<…>`),
which the generator still reads; the facts it generates are the same. The package here is its
types alone (the runners supply the flights).

## Modules

```json
-- module: ./node_modules/@reactivescript/js/package.json
{ "name": "@reactivescript/js", "types": "./index.d.ts", "sideEffects": false }
```

```ts
-- module: ./node_modules/@reactivescript/js/index.d.ts
export type Pure<R> = R;
export type Rejects<P extends PromiseLike<unknown>, E extends Error> = P;
export type Ref<T> = () => T;
export type Instantiates<R> = R;
export type Server<R> = R;
export type Client<R> = R;
```

```ts
-- module: ./api.d.ts
import type { Pure, Rejects } from "@reactivescript/js";
export declare class NotFound extends Error {}
export declare class Offline extends Error {}
export type User = { id: number; name: string };
export declare function fetchUser(id: number): Pure<Rejects<Promise<User>, NotFound | Offline>>;
export declare function saveUser(id: number, name: string): Promise<User>;
export declare function logVisit(page: string): Rejects<Promise<void>, Offline>;
export declare const limit: number;
```

```rx
-- module: ./api.d.rx
// one export of ./api.d.ts, written: the rest are generated from it (MO-11e)
export fn saveUser(id: number, name: string): Promise<User> rejects(Offline)
// a type of its own, which ./api.d.ts does not export: it binds no value, so it adds a type only (MO-11e)
export type Rename = { id: number; name: string }
```

```ts
-- module: ./prims.d.ts
import type { Pure, Ref } from "@reactivescript/js";
export declare function createShout(s: Ref<string>): Pure<Ref<string>>;
```

```ts
-- module: ./bad.d.ts
import type { Pure } from "@reactivescript/js";
export declare function score(n: Pure<number>): number;
```

What the loader reads for `./api` (the generated lines, then the written one in place of
`saveUser`'s, MO-11e):

```rx
export error NotFound
export error Offline
export type User
export pure fn fetchUser(id: number): Promise<User> rejects(NotFound | Offline)
export fn saveUser(id: number, name: string): Promise<User> rejects(Offline)   // written
export fn logVisit(page: string): Promise<void> rejects(Offline)
export const limit: number
```

## Program

```rx
import { fetchUser, saveUser, NotFound, Offline, User, Rename } from "./api"
import { logVisit } from "./api"
import { createShout } from "./prims"
export default component App() {
  source id := 1
  source status := ""
  source greeting := "hi"
  user: User | null = await fetchUser(id) catch (e: NotFound) => null
  name = user == null ? "nobody" : user.name
  loud = createShout(greeting)
  draft: Rename = { id: id, name: name }
  action rename(n) {
    try { await saveUser(id, n); status := "saved" }
    catch (e: Offline) { status := "offline" }
  }
  action visit() {
    try { await logVisit("profile"); status := "seen" }
    catch (e: Offline) { status := "visit offline" }
  }

  errored fallback(e: Offline) { <p>offline: {e.message}</p> } {
    <p>{name} {loud} {status}</p>
  }
}
```

`fetchUser` is pure (`Pure`, a `.ts`'s `pure(…)`), so it is awaited in reactive scope, and it
rejects with the two classes `Rejects` names (a `.ts`'s `rejects([NotFound, Offline], …)`). `User` is a type: it binds nothing and is not in the
emitted import (MO-8d). `logVisit` declares its rejection as `Offline` in the module
(`rejects([Offline], …)` in a `.ts`). `saveUser`'s
rows are its written line's. `createShout` takes `greeting` as an accessor (`Ref` on the
parameter; a `.ts`'s `ref({ args: [0], result: true }, …)`) and hands one back: it instantiates
(MO-10a).

## Frames

| instant | action                                         | frame                  |
| ------- | ---------------------------------------------- | ---------------------- |
| 0       | mount                                          | ``                     |
| 1       | resolve user { id: 1, name: "Ann" }            | `Ann hi!`              |
| 2       | handler `rename("Anne")`                       | `Ann hi!`              |
| 3       | reject "saveUser:1,Anne" Offline("no network") | `Ann hi! offline`      |
| 4       | handler `visit()`                              | `Ann hi! offline`      |
| 5       | resolve "logVisit:profile" null                | `Ann hi! seen`         |
| 6       | handler `greeting := "yo"`                     | `Ann yo! seen`         |
| 7       | handler `id := 2`                              | `Ann yo! seen`         |
| 8       | reject user NotFound("no user 2")              | `nobody yo! seen`      |
| 9       | handler `id := 3`                              | `nobody yo! seen`      |
| 10      | reject user Offline("no network")              | `offline: no network`  |

Instant 3: the written `rejects(Offline)` is `saveUser`'s row, and the action catches it.
Instant 5: `logVisit`'s flight lands. Instant 6: the primitive follows the accessor it was given.
Instant 8: a `NotFound` is an answer of `null`; instant 10: an `Offline` reaches the typed boundary.

## Rejected variants

```rx
-- reject: IMPORT_ROW_ON_TS
import pure { saveUser } from "./api"

export default component App() {
  <p>x</p>
}
```

MO-11e: `saveUser`'s line is written, and it is io; `pure` on the import cannot lower it.

```rx
-- reject: IMPORT_ROW_ON_TS
import { fetchUser } from "./api" fails NotFound

export default component App() {
  <p>x</p>
}
```

MO-11e: `fetchUser`'s rejections are stated (`Rejects<…, NotFound | Offline>`); the import cannot
restate them. `logVisit`'s, defaulted, it may narrow (the program above).

```rx
-- reject: NOT_EXPORTED
import { deleteUser } from "./api"

export default component App() {
  <p>x</p>
}
```

MO-11b: the TS module exports what it exports; `api.d.rx` declares only one override.

```rx
-- reject: IO_IN_REACTIVE
import { logVisit } from "./api"
export default component App() {
  seen = logVisit("home")

  <p>{seen}</p>
}
```

R-io-4: with no `pure` stated, a function is io.

```rx
-- reject: IO_IN_REACTIVE
import { limit } from "./api"
export default component App() {
  n = limit()

  <p>{n}</p>
}
```

MO-11b: a value that is not a function is `export const`, read as an undeclared JS import is: io if called.

```rx
-- reject: DECLARATION_HELPER
import { score } from "./bad"
export default component App() {
  <p>x</p>
}
```

MO-11c: `Pure` marks a function's return type; on a parameter it is not a fact the generator can read.

```rx
-- reject: IMPORT_ROW_ON_TS
import pure { logVisit } from "./api"
export default component App() {
  seen = await logVisit("home")

  errored fallback(e) { <p>{e.message}</p> } { <p>{seen}</p> }
}
```

MO-11e: `import pure` is forbidden on a local TS module. The diagnostic gives the fix:
in `api.d.ts`'s place, a `.ts` with `export const logVisit =
pure(…)`, imported without `pure`.

```rx
-- types: TS2345
import { fetchUser, NotFound, User } from "./api"
export default component App() {
  user: User | null = await fetchUser("1") catch (e: NotFound) => null

  errored fallback(e) { <p>{e.message}</p> } { <p>{user == null ? "" : user.name}</p> }
}
```

TY-4b: a generated line's types are TypeScript's — `fetchUser` takes a `number`.

```rx
-- types: TS2322
import { createShout } from "./prims"
export default component App() {
  source greeting := "hi"
  loud: number = createShout(greeting)

  <p>{loud}</p>
}
```

TY-4d: through its rows, `createShout` takes a `string` (its `Ref<string>` parameter) and reads as
one (its `Ref<string>` result), so it is not a `number`.
