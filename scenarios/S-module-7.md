# S-module-7 — optional JS declaration parameters

Rules: MO-8a, TY-4b. An optional value parameter belongs to the call's
type; it neither supplies a default nor changes the function's row.

## Modules

```rx
-- module: ./labels.d.rx
export pure fn label(x?: string): string
export type Label = string
```

## Program

```rx
import { Label } from "./labels"
export default component App() {
  x: Label = "labels"
  <p>{x}</p>
}
```

## Frames

| instant | action | frame |
| --- | --- | --- |
| 0 | mount | `labels` |

## Rejected

```rx
-- types: TS2345
import { label } from "./labels"
export default component App() {
  <p>{label()}{label("yes")}{label(1)}</p>
}
```

Only the last call is a type error.

```rx
-- reject: PARSE
import type { Label } from "./labels"
export default component App() { <p>labels</p> }
```
