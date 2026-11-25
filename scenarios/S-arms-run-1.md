# S-arms-run-1 — ordered arms in an action's `try`: the first match wins, `_` takes the rest, a throw in an arm leaves the dispatch

Rules: R-f-4, R-f-6, AC-7. `./api` has only a declaration, so the runners
supply the flights (MO-8c) and reject with the class a row names.

## Modules

```rx
-- module: ./api.d.rx
export error Conflict
export error Offline
export error Denied
export fn save(n: number) rejects(Conflict | Offline | Denied)
```

## Program

```rx
import { save, Conflict, Offline, Denied } from "./api"
export default component App() {
  source status := "-"
  action submit(n) {
    try {
      try { await save(n); status := "saved" }
      catch (e) {
        Conflict => { status := `conflict: ${e.message}` }
        Offline => { throw e }
        _ => { status := `inner: ${e.message}` }
      }
    } catch (e) {
      Offline => { status := `outer: ${e.message}` }
    }
  }
  <p>{status}</p>
}
```

The inner dispatch tests `Conflict`, then `Offline`, then takes the rest.
Its `Offline` arm rethrows: that failure leaves the inner dispatch — it is
not offered to the inner `_` — and the outer dispatch takes it.

## Frames

| instant | action                                  | frame               |
| ------- | --------------------------------------- | ------------------- |
| 0       | mount                                   | `-`                 |
| 1       | handler `submit(1)`                     | `-`                 |
| 2       | reject "save:1" Conflict("v7")          | `conflict: v7`      |
| 3       | handler `submit(2)`                     | `conflict: v7`      |
| 4       | reject "save:2" Offline("no network")   | `outer: no network` |
| 5       | handler `submit(3)`                     | `outer: no network` |
| 6       | reject "save:3" Denied("nope")          | `inner: nope`       |
| 7       | handler `submit(4)`                     | `inner: nope`       |
| 8       | resolve "save:4" 1                      | `saved`             |

Instant 2: `Conflict` matches its own arm first (the `_` after it would also
take it). Instant 4: the inner `Offline` arm's `throw e` reaches the outer
`Offline` arm, not the inner `_`. Instant 6: `Denied` has no arm of its own;
the inner `_` takes it.
