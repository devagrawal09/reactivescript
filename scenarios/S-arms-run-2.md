# S-arms-run-2 — `await … catch (e) { arms }`: the selected arm's expression is the value

Rules: R-f-4, R-f-6, AC-1. `./api` has only a declaration, so the runners
supply the flights (MO-8c) and reject with the class a row names.

## Modules

```rx
-- module: ./api.d.rx
export error Conflict
export error Offline
export pure fn load(id: number) rejects(Conflict | Offline)
```

## Program

```rx
import { load, Conflict, Offline } from "./api"
export default component App() {
  source id := 1
  source note := "-"
  value = await load(id) catch (e) { Conflict => { "stale" } _ => { `failed: ${e.message}` } }
  action fetchNote(n) {
    let v = await load(n) catch (e) { Offline => { "offline" } _ => { `other: ${e.message}` } }
    note := v
  }
  <p>{value} {note}</p>
}
```

In reactive scope the arms answer the equation's flight; in the action they
answer the statement's `await`. Each arm is one expression.

## Frames

| instant | action                              | frame                     |
| ------- | ----------------------------------- | ------------------------- |
| 0       | mount                               | ``                        |
| 1       | resolve value "A"                   | `A -`                     |
| 2       | handler `id := 2`                   | `A -`                     |
| 3       | reject value Conflict("old")        | `stale -`                 |
| 4       | handler `id := 3`                   | `stale -`                 |
| 5       | reject value Offline("down")        | `failed: down -`          |
| 6       | handler `fetchNote(4)`              | `failed: down -`          |
| 7       | reject "load:4" Offline("x")        | `failed: down offline`    |
| 8       | handler `fetchNote(5)`              | `failed: down offline`    |
| 9       | reject "load:5" Conflict("y")       | `failed: down other: y`   |

Instant 3: `Conflict` takes its own arm. Instant 5: `Offline` has no arm of
its own in the equation's dispatch; `_` takes it, with `e` the `Offline`.
Instants 7 and 9: the action's dispatch, in its own order.
