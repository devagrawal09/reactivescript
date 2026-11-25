# S-arms-check-3 — old typed handlers are rejected with their arms rewrite

Rules: R-f-4, 07 §14. A class annotation on a catch or fallback binding is
`LEGACY_TYPED_HANDLER`. The message gives the exact ordered-arms rewrite.
A union gets one arm per class. When handlers nest around the same code,
there is one error, and its rewrite is a single dispatch. Inner arms come
first. A catch-all becomes `_`, which is last. Checked only: no frames.

## Program

```rx
error NotFound
error Offline
import pure { load } from "./api" fails NotFound | Offline

export default component App() {
  item = await load(1)
  errored fallback(e) {
    NotFound => { <p>gone</p> }
    _ => { <p>{e.message}</p> }
  } {
    <p>{item}</p>
  }
}
```

The rewrite of each rejected variant below, one boundary with
`NotFound` before `_`.

## Rejected variants

```rx
-- reject: LEGACY_TYPED_HANDLER only
error Conflict
error Offline
import { save } from "./api" fails Conflict | Offline
export default component App() {
  source note := ""
  action submit() {
    try { await save(1) } catch (e: Conflict | Offline) { note := e.message }
  }
  <button onClick={() => { submit() }}>save</button>
}
```

Rewrite: `catch (e) { Conflict => { … } Offline => { … } }`.

```rx
-- reject: LEGACY_TYPED_HANDLER only
error NotFound
import pure { load } from "./api" fails NotFound
export default component App() {
  item = await load(1) catch (e: NotFound) => null
  <p>{item}</p>
}
```

Rewrite: `catch (e) { NotFound => { null } }`.

```rx
-- reject: LEGACY_TYPED_HANDLER only
error NotFound
import pure { load } from "./api" fails NotFound
export default component App() {
  item = await load(1)
  errored fallback(e: NotFound) { <p>gone</p> } { <p>{item}</p> }
}
```

Rewrite: `errored fallback(e) { NotFound => { … } }`.

```rx
-- reject: LEGACY_TYPED_HANDLER only
error Conflict
error Offline
import { save } from "./api" fails Conflict | Offline
export default component App() {
  source note := ""
  action submit() {
    try {
      try { await save(1) } catch (e: Conflict) { note := "conflict" }
    } catch (e) { note := "failed" }
  }
  <button onClick={() => { submit() }}>save</button>
}
```

Two `try`s around the same code are one error. Rewrite:
`catch (e) { Conflict => { … } _ => { … } }`.

```rx
-- reject: LEGACY_TYPED_HANDLER only
error NotFound
import pure { load } from "./api" fails NotFound
export default component App() {
  item = await load(1)
  errored fallback(e) { <p>{e.message}</p> } {
    errored fallback(e: NotFound) { <p>gone</p> } { <p>{item}</p> }
  }
}
```

A typed boundary directly inside a catch-all, around the same content. This
is the Program above, written as two boundaries.

```rx
-- reject: LEGACY_TYPED_HANDLER only
error NotFound
export default component App() {
  errored fallback(e: NotFound) { <p>missing</p> } {
    errored fallback { <p>failed</p> } { <p>x</p> }
  }
}
```

A typed boundary whose content is a catch-all. This was `DEAD_TYPED_BOUNDARY`:
the catch-all took `NotFound` first. One dispatch puts `NotFound` before `_`.
