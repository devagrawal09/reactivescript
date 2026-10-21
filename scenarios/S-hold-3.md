# S-hold-3 — joining: a second write lands in the same in-flight version

Rules: H-2, H-3, H-4, H-10, R-4.

## Program

```
source id := "a"
source n := 0
product = await fetch("p:" + id)
<p>{product.name} {n}</p>
```

## Frames

| instant | action                              | frame   |
| ------- | ----------------------------------- | ------- |
| 0       | mount                               | ``      |
| 1       | resolve product { name: "A" }       | `A 0`   |
| 2       | handler `id := "b"`                 | `A 0`   |
| 3       | handler `n := 1`                    | `A 0`   |
| 4       | resolve product { name: "B" }       | `B 1`   |

Instant 0: no boundary, so the mount itself is held (H-2) and nothing shows.
Instant 2 opens a hold; instant 3's write joins it (H-3): `n` is `1` in σ′
but the screen still shows `0` (H-1: never a new value beside a stale one).
Instant 4: both commit together.

## Variant: superseded flight

```
source id := "a"
product = await fetch("p:" + id)
<p>{product.name}</p>
```

| instant | action                              | frame   |
| ------- | ----------------------------------- | ------- |
| 0       | mount                               | ``      |
| 1       | resolve product { name: "A" }       | `A`     |
| 2       | handler `id := "b"`                 | `A`     |
| 3       | handler `id := "c"`                 | `A`     |
| 4       | resolve "p:b" { name: "B" }         | `A`     |
| 5       | resolve product { name: "C" }       | `C`     |

Instant 3 supersedes the flight for `b` (R-4); its late answer at instant 4
is discarded; the screen never shows `B`.
