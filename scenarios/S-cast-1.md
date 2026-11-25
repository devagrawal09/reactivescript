# S-cast-1 — A type assertion is TypeScript's, and a handler error stays on its line

Rules exercised: 07 §3 (`e as T`), 13 TY-2.

## Program

```rx
type Status = "open" | "done"
export default component App() {
  source s: string := "open"
  source out: Status := "open"
  <button onClick={() => { out := s as Status }}>{out}</button>
}
```

`as` is an assertion, erased where the program runs: the click writes `s`. The
projection keeps it, so `s as Status` is a `Status` and the write checks.

## Frames

| instant | action                              | frame  |
| ------- | ----------------------------------- | ------ |
| 0       | mount                               | `open` |
| 1       | handler `out := s as Status`        | `open` |

## Rejected variants

```rx
-- reject: PARSE
export default component App() {
  source n := 1
  <button onClick={() => {
    let d = n
    foo(???)
  }}>{n}</button>
}
```

A syntax error in a handler is that error, on its line. It is not `JS_LOCAL`
on the `let` above it: that `let` is a handler local.
