# S-solid-19 — a same-source outside read: the fallback is armed off screen and never seen (Solid S-19; D-16)

## Program

```
export default component App() {
  source id := 1
  data = await fetch("d:" + id)

  errored fallback(e) { <p>error: {e.message}</p> } {
    <div>{loading on(id) fallback { <p>spinner</p> } { <p>{data}</p> }} {loading fallback { <p>spinner</p> } { <p>{data}</p> }}</div>
  }
}
```

## Frames

| instant | action              | frame              |
| ------- | ------------------- | ------------------ |
| 0       | mount               | `spinner spinner`  |
| 1       | resolve data "A"    | `A A`              |
| 2       | handler `id := 2`   | `A A`              |
| 3       | resolve data "B"    | `B B`              |

The second boundary is shown, so its read of `data(2)` holds the frame —
which is exactly what the first boundary's fallback waits on; the spinner
is never painted (`LOADING_ON_OUTSIDE_HOLD` in dev).

## Variant: a header reading `latest id` beside `on(id)`

```
export default component App() {
  source id := 1
  data = await fetch("d:" + id)

  errored fallback(e) { <p>error: {e.message}</p> } {
    <div><b>{latest id}</b> {loading on(id) fallback { <p>spinner</p> } { <p>{data}</p> }} {loading fallback { <p>spinner</p> } { <p>{data}</p> }}</div>
  }
}
```

| instant | action              | frame                |
| ------- | ------------------- | -------------------- |
| 0       | mount               | `1 spinner spinner`  |
| 1       | resolve data "A"    | `1 A A`              |
| 2       | handler `id := 2`   | `2 A A`              |
| 3       | resolve data "B"    | `2 B B`              |
