# S-js-globals-1 — JavaScript globals are not in scope

Rules exercised: SV-7a, MO-8c.

## Program

```rx
export default component App() { <p>ok</p> }
```

## Frames

| instant | action | frame |
| --- | --- | --- |
| 0 | mount | `ok` |

## Rejected: Number and Math must be imported

```rx
-- reject: UNBOUND
export default component App() { <p>{Number("1")}{Math.floor(1.2)}</p> }
```
