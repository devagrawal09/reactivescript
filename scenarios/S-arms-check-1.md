# S-arms-check-1 — ordered error arms: accepted in all three places, and kept in order

Rules: R-f-1, R-f-4, R-f-6, R-f-10. The checker reads each dispatch against
the row that reaches it. Arms match in source order. The first matching arm
wins. `_` takes the remainder and comes last. Checked only: no frames.

## Program

```rx
error Conflict(version) => `conflict at ${version}`
error Offline
error NotFound(id) => `no item ${id}`
import { save } from "./api" fails Conflict | Offline
import pure { load } from "./api" fails NotFound | Offline

export default component App() {
  source id := 1
  source note := ""
  item = await load(id) catch (e) { NotFound => { null } _ => { throw e } }
  title = await load(id + 1) catch (e) { NotFound => { "?" } Offline => { "offline" } }
  action submit() {
    try { await save(id) } catch (e) {
      Conflict => { note := e.message }
      _ => { note := `failed: ${e.message}` }
    }
  }
  action retry() {
    try { await save(id) } catch (e) {
      Conflict => { note := "conflict" }
      Offline => { note := "offline" }
      _ => { note := "only a panic gets here" }
    }
  }
  action strict() {
    try { await save(id) } catch (e) {
      Offline => { note := "offline" }
      Conflict => { note := `at ${e.version}` }
    }
  }
  <button onClick={() => { submit() }}>save</button>
  <button onClick={() => { retry() }}>retry</button>
  <button onClick={() => { strict() }}>strict</button>
  <p>{note}</p>
  errored fallback(e) {
    Offline => { <p>offline</p> }
    _ => { <p>{e.message}</p> }
  } {
    <p>{item == null ? "none" : item.name}</p>
    <p>{title}</p>
  }
  errored fallback(e) {
    NotFound => { <p>gone</p> }
    _ => { <p>{e.message}</p> }
  } {
    <p>{await fetch("x:" + id)}</p>
  }
}
```

- `item`'s `_` rethrows what is left after `NotFound`. That is `Offline`,
  so `item` fails with `Offline` only.
- `title` covers its whole row (`NotFound | Offline`) without `_`.
- `retry` and the first boundary keep a `_` that a closed row leaves empty.
  That is allowed. The model marks it `dead: true`, and it still takes a
  panic at run time.
- `strict` covers `Conflict | Offline` without `_`. Order does not matter
  between distinct classes.
- The second boundary's content reads `fetch`, an open row (`Error`), so
  its `NotFound` arm is not provably unreachable.

## Rejected variants

```rx
-- reject: ERROR_ARM_ORDER only
error Conflict
error Offline
import { save } from "./api" fails Conflict | Offline
export default component App() {
  source note := ""
  action submit() {
    try { await save(1) } catch (e) {
      _ => { note := "failed" }
      Conflict => { note := "conflict" }
    }
  }
  <button onClick={() => { submit() }}>save</button>
}
```

An arm after `_` never runs: `_` took the failure first.

```rx
-- reject: ERROR_ARM_ORDER only
error NotFound
error Offline
import pure { load } from "./api" fails NotFound | Offline
export default component App() {
  item = await load(1)
  errored fallback(e) {
    NotFound => { <p>gone</p> }
    Offline => { <p>offline</p> }
    NotFound => { <p>never</p> }
  } { <p>{item}</p> }
}
```

The same class twice: the first arm takes every `NotFound`.

```rx
-- reject: ERROR_ARM_ORDER only
error NotFound
import pure { load } from "./api" fails NotFound
export default component App() {
  item = await load(1) catch (e) { NotFound => { null } _ => { "a" } _ => { "b" } }
  <p>{item}</p>
}
```

`_` appears once, as the last arm.

```rx
-- reject: ERROR_ARM_ORDER only
error NotFound
import pure { load } from "./api" fails NotFound
export default component App() {
  item = await load(1)
  errored fallback(e) {
    Error => { <p>{e.message}</p> }
    NotFound => { <p>gone</p> }
  } { <p>{item}</p> }
}
```

`Error` is the top class: an arm after it never runs.

```rx
-- reject: ERROR_ARM_ORDER
error NotFound
import pure { load } from "./api" fails NotFound
export default component App() {
  item = await load(1)
  errored fallback(e) {
    Panic => { <p>bug</p> }
    NotFound => { <p>gone</p> }
  } { <p>{item}</p> }
}
```

R-f-10: at run time `Panic` takes whatever reaches it, so a later arm never
runs. `Panic` also discharges nothing statically, so `item`'s `NotFound` is
unhandled too.

```rx
-- reject: NOT_AN_ERROR_CLASS
error NotFound
import pure { load } from "./api" fails NotFound
export default component App() {
  source Missing := 0
  item = await load(1) catch (e) { NotFound => { null } Missing => { null } _ => { null } }
  <p>{item}</p>
}
```

R-f-1: an arm names an error class or `_`.
