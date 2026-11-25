# S-module-6 — a declaration file imports types

Rules: MO-8e, TY-4b. `Card` lives in another `.d.rx`, `Note` is an `.rx`
`export type`. `api.d.rx` names them in its signatures instead of copying
them. The projection aliases the other declare namespace (and the `.rx`
projection), not a sibling `.ts`.

## Modules

```rx
-- module: ./cards.d.rx
export type Card = { id: string; title: string }
```

```rx
-- module: ./notes.rx
export type Note = { text: string }
```

```rx
-- module: ./api.d.rx
import { Card, Card as Item } from "./cards"
import { Note } from "./notes.rx"
export pure fn titleOf(c: Card): string
export pure fn same(c: Item): boolean
export pure fn textOf(n: Note): string
```

```rx
-- module: ./fns.d.rx
export pure fn fetch(): string
```

```rx
-- module: ./badfn.d.rx
import { fetch } from "./fns"
export pure fn g(x: number): number
```

```rx
-- module: ./bad.d.rx
import { Missing } from "./nope"
export pure fn f(): number
```

## Program

```rx
import { titleOf, textOf } from "./api"
export default component App() { <p>ok</p> }
```

The import is enough: the declare namespace is checked, so a missing `Card`
or `Note` is a type error here, not only at a call.

## Frames

| instant | action | frame |
| --- | --- | --- |
| 0 | mount | `ok` |

## Rejected

```rx
-- types: TS2345
import { titleOf } from "./api"
export default component App() {
  t = titleOf(1)
  <p>{t}</p>
}
```

`Card` came from `cards.d.rx`. A number is not one.

```rx
-- types: TS2345
import { textOf } from "./api"
export default component App() {
  t = textOf(1)
  <p>{t}</p>
}
```

`Note` came from `notes.rx`. Same.

```rx
-- reject: TYPE_IMPORT
import { g } from "./badfn"
export default component App() { <p>x</p> }
```

`fetch` is a function. A declaration file imports types only.

```rx
-- reject: MODULE_NOT_FOUND
import { f } from "./bad"
export default component App() { <p>x</p> }
```

```rx
-- reject: NOT_EXPORTED
import { Missing } from "./api"
export default component App() { <p>x</p> }
```

An imported type is in scope for the file's signatures. It is not an export
of the JS module.
