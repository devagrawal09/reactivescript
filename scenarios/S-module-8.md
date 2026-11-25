# S-module-8 — a TS module declares itself: generated rows, brands, one written override

Rules: MO-11a, MO-11b, MO-11c, MO-11d, MO-11e, MO-8c, MO-8d, MO-10a, MO-10b, R-io-4, R-f-8, TY-4b,
TY-4d. S-module-2's program, with its `.d.rx` replaced by the TS module it described. Here
`./api` is `api.d.ts`, a TS module with no implementation, so the runners still supply its
flights (MO-8c, as S-module-2's `api.d.rx` did) and the type layer reads it as TypeScript does. Its
declaration is generated from it (MO-11): the brands give `fetchUser` its rows, `logVisit` has
none (the default: io, `rejects(Error)`), and `api.d.rx` overrides `saveUser` alone. `./prims` is
`prims.d.ts`, the scenarios' Solid primitives (S-module-4), declared by a `Ref` brand.

## Modules

```json
-- module: ./node_modules/@reactivescript/types/package.json
{ "name": "@reactivescript/types", "types": "./index.d.ts", "sideEffects": false }
```

```ts
-- module: ./node_modules/@reactivescript/types/index.d.ts
export type Pure<R> = R;
export type Rejects<P extends PromiseLike<unknown>, E extends Error> = P;
export type Ref<T> = () => T;
export type Instantiates<R> = R;
export type Server<R> = R;
export type Client<R> = R;
```

```ts
-- module: ./api.d.ts
import type { Pure, Rejects } from "@reactivescript/types";
export declare class NotFound extends Error {}
export declare class Offline extends Error {}
export type User = { id: number; name: string };
export declare function fetchUser(id: number): Pure<Rejects<Promise<User>, NotFound | Offline>>;
export declare function saveUser(id: number, name: string): Promise<User>;
export declare function logVisit(page: string): Promise<void>;
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
import type { Pure, Ref } from "@reactivescript/types";
export declare function createShout(s: Ref<string>): Pure<Ref<string>>;
```

```ts
-- module: ./bad.d.ts
import type { Pure } from "@reactivescript/types";
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
export fn logVisit(page: string): Promise<void>
export const limit: number
```

## Program

```rx
import { fetchUser, saveUser, NotFound, Offline, User, Rename } from "./api"
import { logVisit } from "./api" fails Offline
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

`fetchUser` is pure by its `Pure` brand, so it is awaited in reactive scope, and it rejects with
the two classes its `Rejects` brand names. `User` is a type: it binds nothing and is not in the
emitted import (MO-8d). `logVisit` has no brand, so its rows are the default, and the import may
narrow them as R-io-4 and R-f-8 allow for an undeclared JS import: `fails Offline`. `saveUser`'s
rows are its written line's. `createShout` takes `greeting` as an accessor (`Ref` on the
parameter) and hands one back (`Ref` on the result): it instantiates (MO-10a).

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
-- reject: IMPORT_ROW_MISMATCH
import pure { saveUser } from "./api"

export default component App() {
  <p>x</p>
}
```

MO-11e: `saveUser`'s line is written, and it is io; `pure` on the import cannot lower it.

```rx
-- reject: IMPORT_ROW_MISMATCH
import { fetchUser } from "./api" fails NotFound

export default component App() {
  <p>x</p>
}
```

MO-11e: `fetchUser`'s rejections are branded (`Rejects<…, NotFound | Offline>`); the import cannot
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

R-io-4: with no `Pure` brand, a function is io.

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
-- reject: DECLARATION_BRAND
import { score } from "./bad"
export default component App() {
  <p>x</p>
}
```

MO-11c: `Pure` marks a function's return type; on a parameter it is not a fact the generator can read.

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
