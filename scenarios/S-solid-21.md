# S-solid-21 — a display-ahead read in `on` shows the fallback now, beside the held frame (Solid S-21; D-17)

## Program

```
source id := 1
product = await fetch("p:" + id)
comments = await fetch("c:" + id)
<div><h1>{product.name}</h1> {loading on(latest id) fallback { <p>spinner</p> } { <ul>{comments}</ul> }}</div>
```

## Frames

| instant | action                          | frame            |
| ------- | ------------------------------- | ---------------- |
| 0       | mount                           | ``               |
| 1       | resolve product { name: "A" }   | `A spinner`      |
| 2       | resolve comments "comments-A"   | `A comments-A`   |
| 3       | handler `id := 2`               | `A spinner`      |
| 4       | resolve product { name: "B" }   | `B spinner`      |
| 5       | resolve comments "comments-B"   | `B comments-B`   |

Instant 3: `on` read `latest id`, whose frame has landed, so the new id's
loading state shows inside the old page; reads of `id` stay held.

## Divergences

- oracle "Frames" instant 0: `spinner` — Solid 2.0.0-rc.16 renders a mount partially: readers that are not pending show at once and a pending reader outside any boundary is empty (`ASYNC_OUTSIDE_LOADING_BOUNDARY`); H-2 holds the mount as one frame. Open question for 05 — see spec/05-holds.md §Divergences.
