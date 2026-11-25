# S-fail-1 — ordered error arms select a fallback by class

Rules: R-f-1, R-f-3, R-f-4, R-f-5, H-12, D-41.

## Program

```rx
error BadId(id) => `bad id ${id}`
error NotFound(id) => `no user ${id}`
source id := 1
user = id > 0 ? await fetch("u:" + id) : throw BadId(id)
name = user == null ? throw NotFound(id) : user.name

export default component App() {
  errored fallback(e) { <p>down: {e.message}</p> } {
    <div><p>#{id}</p> {errored fallback(e) {
      NotFound => { <p>(nobody)</p> }
      BadId => { <p>{e.message}</p> }
      _ => { {throw e} }
    } { <p>{name}</p> }}</div>
  }
}
```

`name`'s row is `fails(Error | BadId | NotFound)`: `Error` from the fetch
(a JS promise, R-f-8), `BadId` and `NotFound` from its `throw`s. The
inner boundary shows specific fallbacks for `NotFound` and `BadId`, and
rethrows the rest to the root, whose fallback replaces the whole page.

## Frames

| instant | action                         | frame             |
| ------- | ------------------------------ | ----------------- |
| 0       | mount                          | ``                |
| 1       | resolve user { name: "Ann" }   | `#1 Ann`          |
| 2       | handler `id := 2`              | `#1 Ann`          |
| 3       | resolve user null              | `#2 (nobody)`     |
| 4       | handler `id := 0`              | `#0 bad id 0`     |
| 5       | handler `id := 3`              | `#3 bad id 0`     |
| 6       | reject user "offline"          | `down: offline`   |
| 7       | handler `id := 4`              | `down: offline`   |
| 8       | resolve user { name: "Dee" }   | `#4 Dee`          |

Instant 3: the `NotFound` arm shows `(nobody)` and the root boundary does
not move. Instant 4: `BadId` is thrown with no await; its arm takes it in
the same frame as `#0`. Instant 5:
the content is pending behind an error fallback, which holds nothing
(H-4) and stays until an answer replaces the error (D-41). Instant 6: the
rejection is an `Error`: the default arm rethrows it and the root shows
its fallback. Instants 7–8: a new question, then its answer recovers through both
boundaries in one frame.

## Variant: a final `Error` arm covers the remaining declared failures

```rx
error BadId(id) => `bad id ${id}`
error NotFound(id) => `no user ${id}`
source id := 1
user = id > 0 ? await fetch("u:" + id) : throw BadId(id)
name = user == null ? throw NotFound(id) : user.name

export default component App() {
  errored fallback(e) {
    NotFound => { <p>(nobody)</p> }
    Error => { <p>down: {e.message}</p> }
  } { <p>{name}</p> }
}
```

| instant | action                         | frame             |
| ------- | ------------------------------ | ----------------- |
| 0       | mount                          | ``                |
| 1       | resolve user { name: "Ann" }   | `Ann`             |
| 2       | handler `id := 0`              | `down: bad id 0`  |

`Error` is the top class (R-f-1), so `BadId` matches its arm. `NotFound`
gets its own fallback because its arm comes first.

## Rejected variants

```rx
-- reject: MISSING_ERROR_ARMS
error BadId(id) => `bad id ${id}`
error NotFound(id) => `no user ${id}`
source id := 1
user = id > 0 ? await fetch("u:" + id) : throw BadId(id)
name = user == null ? throw NotFound(id) : user.name

export default component App() {
  <p>#{id}</p>
  errored fallback(e) {
    NotFound => { <p>(nobody)</p> }
    BadId => { <p>{e.message}</p> }
  } { <p>{name}</p> }
}
```

R-f-4: the fetch's `Error` is missing from the dispatch.

```rx
-- reject: MISSING_ERROR_ARMS
error BadId(id) => `bad id ${id}`
error NotFound(id) => `no user ${id}`
source id := 1
user = id > 0 ? await fetch("u:" + id) : throw BadId(id)
name = user == null ? throw NotFound(id) : user.name

export default component App() {
  errored fallback(e) { BadId => { <p>{e.message}</p> } } {
    <p>{name}</p>
  }
}
```

Neither `NotFound` (no boundary for it) nor `Error` is discharged.

```rx
-- reject: CATCH_NOT_ON_AWAIT
error NotFound(id) => `no user ${id}`
source id := 1
user = await fetch("u:" + id)
name = user == null ? throw NotFound(id) : user.name

export default component App() {
  errored fallback(e) { <p>down</p> } {
    <p>{name catch (e) { NotFound => { "(nobody)" } _ => { throw e } }}</p>
  }
}
```

R-f-4: a `catch` follows an `await`. A failure read from a value is shown
by a boundary where it is read.

```rx
-- reject: NOT_AN_ERROR_CLASS
export default component App() {
  source id := 1
  user = await fetch("u:" + id)

  errored fallback(e) { Missing => { <p>{e.message}</p> } _ => { <p>down</p> } } { <p>{user}</p> }
}
```

```rx
-- reject: ROW_NARROWER_THAN_INFERRED
error NotFound(id) => `no user ${id}`
source id := 1
user = await fetch("u:" + id)
name: pending fails(NotFound) string = user == null ? throw NotFound(id) : user.name

export default component App() {
  errored fallback(e) { <p>{e.message}</p> } { <p>{name}</p> }
}
```

R-f-9: the written row leaves out the fetch's `Error`.
