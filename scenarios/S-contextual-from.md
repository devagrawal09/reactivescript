# S-contextual-from — `from` is only a keyword in imports

Rule: 07 §3. `from` can name state and be read and written as usual.

## Program

```rx
import pure { len } from "./prelude"
export default component App() {
  source from := "a"
  <p>{from}:{len(from)}</p>
}
```

## Frames

| instant | action | frame |
| --- | --- | --- |
| 0 | mount | `a:1` |
| 1 | handler `from := "bc"` | `bc:2` |
