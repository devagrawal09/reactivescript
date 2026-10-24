# S-solid-7 — root mount with uncaught async waits to attach; with a boundary it shows the fallback (Solid S-7; D-6, D-12)

## Program

```
user = await fetch("user")
errored fallback(e) { <p>error: {e.message}</p> } {
  <p>{user}</p>
}
```

## Frames

| instant | action                   | frame      |
| ------- | ------------------------ | ---------- |
| 0       | mount                    | ``         |
| 1       | resolve user "Profile"   | `Profile`  |

## Variant: with a boundary

```
user = await fetch("user")
errored fallback(e) { <p>error: {e.message}</p> } {
  {loading fallback { <p>Spinner</p> } { <p>{user}</p> }}
}
```

| instant | action                   | frame      |
| ------- | ------------------------ | ---------- |
| 0       | mount                    | `Spinner`  |
| 1       | resolve user "Profile"   | `Profile`  |

## Rejected variants

```
-- warn: ASYNC_OUTSIDE_LOADING_BOUNDARY
user = await fetch("user")
errored fallback(e) { <p>error: {e.message}</p> } {
  <p>{user}</p>
}
```
