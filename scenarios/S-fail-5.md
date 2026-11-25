# S-fail-5 — a typed error boundary wrapped by an inner catch-all is dead

Rules: R-f-4. The catch-all takes `NotFound` first, so the typed fallback
never shows. The model marks the typed region `shadowed` by the inner one.

## Program

```rx
error NotFound
export default component App() {
  errored fallback(e) { <p>{e.message}</p> } {
    errored fallback(e: NotFound) { <p>missing</p> } { <p>ok</p> }
  }
}
```

The typed boundary is inside the catch-all, which is where it can still see
`NotFound`.

## Frames

| instant | action | frame |
| --- | --- | --- |
| 0 | mount | `ok` |

## Variant: a failure in the inner fallback reaches the outer region

```rx
error NotFound
error Offline
export default component App() {
  failed = throw Offline()
  fallbackFailed = throw NotFound()
  errored fallback(e: NotFound) { <p>missing</p> } {
    errored fallback(e) { <p>{fallbackFailed}</p> } { <p>{failed}</p> }
  }
}
```

| instant | action | frame |
| --- | --- | --- |
| 0 | mount | `missing` |

## Rejected

```rx
-- reject: DEAD_TYPED_BOUNDARY
error NotFound
export default component App() {
  errored fallback(e: NotFound) { <p>missing</p> } {
    errored fallback { <p>failed</p> } { <p>x</p> }
  }
}
```

The inner catch-all wraps the children. `NotFound` never reaches the typed
fallback.
