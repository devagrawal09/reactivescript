# S-fn-lift — an equation-only block fn lifts, like the arrow form

Rules: E-9, E-10. `fn f(x) { i = …; i }` declares no source, effect, or
region, so the call re-evaluates with its arguments. The same body with a
`source` or an `effect` still instantiates (S-region-6).

## Program

```rx
export default component App() {
  fn add(a, b) {
    s = a + b
    s
  }
  source n := 1
  t = add(n, 10)

  <p>{t}</p>
}
```

`t` follows `n`. A snapshot would have kept `11`.

## Frames

| instant | action | frame |
| --- | --- | --- |
| 0 | mount | `11` |
| 1 | handler `n := 2` | `12` |

## Rejected

```rx
-- reject: SNAPSHOT_ARGUMENT
export default component App() {
  fn watch(v) {
    effect (v) { log(v) }
    v
  }
  source n := 1
  w = watch(n)

  <p>{w}</p>
}
```

An `effect` in the body still instantiates, so a reactive value argument is
`SNAPSHOT_ARGUMENT`.
