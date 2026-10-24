# S-context-1 — declared contexts: identity is the declaration, defaults, rows and writability are declared

Rules: RG-7a..e, MO-7, R-f-5, CN-4a.

## Modules

```
-- module: ./theme.rx
export context theme: string = "light"
export context accent: string
```

```
-- module: ./other.rx
export context accent: string
```

`other.rx`'s `accent` is a different context from `theme.rx`'s: the same
spelling, another declaration.

## Program

```
import { theme, accent } from "./theme.rx"
source mode := "dark"
component Label(props) { <b>{use theme}/{use accent}</b> }
component Themed(props) {
  provide theme = mode
  <i>{props.children}</i>
}
provide accent = "blue"
<div><Label /> <Themed><Label /></Themed></div>
```

The first `Label` has no provision of `theme` above it and reads its
default; the second reads `Themed`'s. Both find `main`'s `accent`.

## Frames

| instant | action                | frame                   |
| ------- | --------------------- | ----------------------- |
| 0       | mount                 | `light/blue dark/blue`  |
| 1       | handler `mode := "dim"` | `light/blue dim/blue` |

## Rejected variants

```
-- reject: CONTEXT_NOT_FOUND
import { accent } from "./theme.rx"
import { accent as paint } from "./other.rx"
component Label(props) { <b>{use accent}</b> }
provide paint = "red"
<Label />
```

MO-7: a provision of `other.rx`'s `accent` is not one of `theme.rx`'s.

```
-- reject: ROW_NARROWER_THAN_INFERRED
import { accent } from "./theme.rx"
provide accent = await fetch("accent")
errored fallback(e) { <p>{e.message}</p> } { <b>{use accent}</b> }
```

RG-7e: an exported context's type is its contract — `accent: string`
writes no rows, so a provision that is pending and can fail is refused at
the `provide`. Its importers, on both sides, rely on the declaration.

```
-- reject: UNHANDLED_FAILURE
context who: string
provide who = await fetch("who")
<b>{use who}</b>
```

A context that is not exported and writes no rows takes its rows from its
provisions: `use who` can fail with `Error`, so its reader needs a boundary.

```
-- reject: WRITE_TO_NON_SOURCE
import { accent } from "./theme.rx"
provide accent = "blue"
<button onClick={() => { use accent := "red" }}>{use accent}</button>
```

RG-7c: only a context declared `source` is written through.

```
-- reject: PROVIDE_NOT_A_SOURCE
context picked: source number
provide picked = 1 + 1
<b>{use picked}</b>
```

```
-- reject: NOT_A_CONTEXT
source picked := 1
provide picked = 2
<b>{picked}</b>
```

```
-- reject: INVALID_CONTEXT_DEFAULT
context picked: source number = 1
<b>{use picked}</b>
```

```
-- reject: CONTEXT_AS_VALUE
import { theme } from "./theme.rx"
<b>{theme}</b>
```
