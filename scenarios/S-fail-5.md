# S-fail-5 — one boundary dispatches on the class; nested typed boundaries are rejected

Rules: R-f-4, H-12. `errored fallback(e) { A => { … } _ => { … } }` picks
the first matching arm. A failure in the selected arm goes to the
enclosing region, never into a later arm. This replaces two boundaries
nested around the same content (formerly `DEAD_TYPED_BOUNDARY`). That form
is now `LEGACY_TYPED_HANDLER`, with the merged rewrite.

## Program

```rx
error NotFound
error Offline
source which := "none"
failed = which == "missing" ? throw NotFound() : which == "off" ? throw Offline() : "ok"
export default component App() {
  errored fallback(e) {
    NotFound => { <p>missing</p> }
    _ => { <p>failed: {e.message}</p> }
  } { <p>{failed}</p> }
}
```

## Frames

| instant | action | frame |
| --- | --- | --- |
| 0 | mount | `ok` |
| 1 | handler `which := "missing"` | `missing` |

## Variant: the default arm takes another class

| instant | action | frame |
| --- | --- | --- |
| 1 | handler `which := "off"` | `failed: Offline` |

## Variant: a failure in the selected arm reaches the outer region

```rx
error NotFound
error Offline
failed = throw NotFound()
fallbackFailed = throw Offline()
export default component App() {
  errored fallback(e) { <p>outer: {e.message}</p> } {
    errored fallback(e) {
      NotFound => { <p>{fallbackFailed}</p> }
      _ => { <p>other</p> }
    } { <p>{failed}</p> }
  }
}
```

| instant | action | frame |
| --- | --- | --- |
| 0 | mount | `outer: Offline` |

The `NotFound` arm's own failure does not go to `_`. It leaves the
dispatch for the outer boundary.

## Rejected variants

```rx
-- reject: LEGACY_TYPED_HANDLER only
error NotFound
export default component App() {
  errored fallback(e: NotFound) { <p>missing</p> } {
    errored fallback { <p>failed</p> } { <p>x</p> }
  }
}
```

The inner catch-all would take `NotFound` before the typed boundary sees it.
The message gives one boundary instead:
`errored fallback(e) { NotFound => { … } _ => { … } }`.

```rx
-- reject: LEGACY_TYPED_HANDLER only
error NotFound
export default component App() {
  errored fallback(e) { <p>failed</p> } {
    errored fallback(e: NotFound) { <p>missing</p> } { <p>x</p> }
  }
}
```

The old working spelling, a typed boundary inside a catch-all, gets the same
rewrite.
