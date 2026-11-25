# S-ts-expr-1 — Computed keys, assertions, and multiline chains

Rules exercised: 07 §3, E-7, TY-1a.

## Program

```rx
fn show(n: number): number => n
export default component App() {
  record = { [key]: 4 }
  key = "value"
  value: unknown = record[key]
  first = ([show(value as number)]
    .map(n => n + 1))[0]
  <p>{first}</p>
}
```

## Frames

| instant | action | frame |
| --- | --- | --- |
| 0 | mount | `5` |
