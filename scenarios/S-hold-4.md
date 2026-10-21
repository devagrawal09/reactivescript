# S-hold-4 — a lane holds itself, not the instant

Rules: H-7, R-9, R-10, R-4.

## Program

```
source id := "a"
product = await fetch("p:" + id)
preview = await fetch("v:" + latest id)
<div><p>{product.name}</p> <p>{preview}</p></div>
```

`preview` is derived from a probe, so it and its reader are in `id`'s lane
(R-10): the reader never holds the instant; pending work inside the lane
holds the lane.

## Frames

| instant | action                        | frame   |
| ------- | ----------------------------- | ------- |
| 0       | mount                         | ``      |
| 1       | resolve product { name: "A" } | `A `    |
| 2       | resolve preview "pa"          | `A pa`  |
| 3       | handler `id := "b"`           | `A pa`  |
| 4       | resolve preview "pb"          | `A pb`  |
| 5       | resolve product { name: "B" } | `B pb`  |

Instant 0: `product` holds the mount; `preview` is pending too but is a
lane reader, so it does not. Instant 1: the mount commits; the lane has
nothing to show yet. Instant 3: the instant is held by `product`; the lane's
own `await` is pending, so the lane keeps `pa`. Instant 4: the lane lands
and reveals ahead of the still-held instant (H-7). Instant 5: the instant
commits.
