# S-fail-6 — read order controls which failure is shown

Rules: E-3, E-8, R-f-4. The guard can skip the `details` read entirely,
or demand it before deciding whether to show the title.

## Program

```rx
error Missing
export default component App() {
  source shown := false
  details = throw Missing()
  errored fallback(e: Missing) { <p>missing</p> } {
    if shown && details { <p>title</p> }
  }
}
```

## Frames

| instant | action | frame |
| --- | --- | --- |
| 0 | mount | `''` |
| 1 | handler `shown := true` | `missing` |
