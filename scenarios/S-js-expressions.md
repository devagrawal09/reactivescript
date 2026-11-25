# S-js-expressions — error class tests and arguments

Rules: R-f-1, R-f-4, SV-7a, AC-1f.

## Program

```rx
error Missing(id: number) => `missing ${id}`
fn total(a: number, b: number) => a + b
export default component App() {
  source result := ""
  action check() {
    let e = Missing(2)
    let ns = Array.from("12", x => Number(x))
    let n = Math.max(...ns)
    result := e instanceof Missing && e instanceof Error ? `${n}:${total(...[3, 4])}` : "wrong"
  }
  <p>{result}</p>
}
```

## Frames

| instant | action | frame |
| --- | --- | --- |
| 0 | mount | |
| 1 | handler `check()` | `2:7` |

## Rejected

```rx
-- reject: NOT_AN_ERROR_CLASS
export default component App() { <p>{1 instanceof Number}</p> }
```

```rx
-- reject: CALL_SPREAD
export default component App() {
  action save(id: number) {}
  <button onClick={() => { save(...[1]) }}>Save</button>
}
```

```rx
-- reject: ASSIGNMENT
export default component App() {
  <input onInput={e => { e.currentTarget.value = "" }} />
}
```
