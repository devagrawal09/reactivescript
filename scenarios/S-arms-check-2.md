# S-arms-check-2 — ordered error arms against the row that reaches them

Rules: R-f-4, R-f-5, R-f-6, R-f-10. A dispatch has a row: the `try`
body's for a statement, the awaited expression's for `await … catch`, and
for a boundary, every failure that reaches it from its content. Without
`_`, the arms cover every declared class in that row. An open row
(`Error`) needs `_`. A class arm that a closed row cannot produce is an
error. The checker never infers that from an open or unresolved row. A
failure inside an arm leaves the dispatch. It never enters another arm.
Checked only: no frames.

## Program

```rx
error Conflict
error Offline
import { save } from "./api" fails Conflict | Offline

export default component App() {
  source note := ""
  action submit() {
    try {
      try { await save(1) } catch (e) {
        Conflict => { throw e }
        _ => { note := "offline" }
      }
    } catch (e) {
      Conflict => { note := "conflict, again" }
    }
  }
  <button onClick={() => { submit() }}>save</button>
  <p>{note}</p>
}
```

The inner `Conflict` arm rethrows. Its `e` is narrowed to `Conflict`, so
the outer dispatch receives only `Conflict` and needs no `_`.

## Rejected variants

```rx
-- reject: UNREACHABLE_ERROR_ARM only
error Conflict
error Offline
error NotFound
import { save } from "./api" fails Conflict | Offline
export default component App() {
  source note := ""
  action submit() {
    try { await save(1) } catch (e) {
      Conflict => { note := "conflict" }
      NotFound => { note := "gone" }
      _ => { note := "failed" }
    }
  }
  <button onClick={() => { submit() }}>save</button>
}
```

`save` can fail only with `Conflict` or `Offline`.

```rx
-- reject: UNREACHABLE_ERROR_ARM only
error NotFound
error Offline
import pure { load } from "./api" fails Offline
export default component App() {
  item = await load(1) catch (e) { NotFound => { null } _ => { null } }
  <p>{item}</p>
}
```

```rx
-- reject: UNREACHABLE_ERROR_ARM only
error NotFound
error Offline
failed = throw Offline()
export default component App() {
  errored fallback(e) {
    NotFound => { <p>gone</p> }
    _ => { <p>{e.message}</p> }
  } { <p>{failed}</p> }
}
```

The boundary's content can fail only with `Offline`.

```rx
-- reject: MISSING_ERROR_ARMS
error NotFound
error Offline
import pure { load } from "./api" fails NotFound | Offline
export default component App() {
  item = await load(1)
  errored fallback(e) {
    NotFound => { <p>gone</p> }
  } { <p>{item}</p> }
}
```

No `_`, and `Offline` is not covered. The message names it.

```rx
-- reject: MISSING_ERROR_ARMS
error NotFound
export default component App() {
  item = await fetch("x:1") catch (e) { NotFound => { null } }
  <p>{item}</p>
}
```

`fetch` rejects with any `Error`: an open row needs `_`.

```rx
-- reject: MISSING_ERROR_ARMS
error Conflict
error Offline
import { save } from "./api" fails Conflict | Offline
export default component App() {
  source note := ""
  action submit() {
    try { await save(1) } catch (e) {
      Conflict => { note := "conflict" }
    }
  }
  <button onClick={() => { submit() }}>save</button>
}
```

```rx
-- reject: UNCAUGHT_ACTION_FAILURE only
error Conflict
error Offline
import { save } from "./api" fails Conflict | Offline
export default component App() {
  source note := ""
  action submit() {
    try { await save(1) } catch (e) {
      Conflict => { throw e }
      _ => { note := "failed" }
    }
  }
  <button onClick={() => { submit() }}>save</button>
}
```

R-f-6: the `Conflict` arm rethrows, and nothing around the `try` catches it.
A later arm never takes a failure from an earlier one.

```rx
-- reject: UNHANDLED_FAILURE only
error NotFound
import pure { load } from "./api" fails NotFound
export default component App() {
  item = await load(1)
  errored fallback(e) {
    Panic => { <p>bug</p> }
  } { <p>{item}</p> }
}
```

R-f-10: a lone `Panic` arm is not a missing-arms error, but it discharges
no failure. `item`'s `NotFound` must be handled below it.
