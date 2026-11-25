# S-js-globals-1 — host JavaScript globals are not in scope

Rules exercised: SV-7a, MO-8c.

## Program

```rx
export default component App() { <p>ok</p> }
```

## Frames

| instant | action | frame |
| --- | --- | --- |
| 0 | mount | `ok` |

## Rejected: browser globals must be imported

```rx
-- reject: UNBOUND
export default component App() { <p>{window.location.href}</p> }
```
