# S-hold-1 — first load reaches a boundary; a later update is held

Mirrors Solid `concepts/async-reactivity` (product detail). Rules: H-2, H-4,
H-5, H-6, H-7, H-9, R-1, R-4, R-9, R-10, R-11, V-1.

## Program

```
source id := "a"
product = await fetch("p:" + id)
<div>
  <p>sel:{latest id}</p>
  {loading fallback { <p>loading</p> } {
    <div><p>{product.name}</p> <p>{pending? product}</p></div>
  }}
</div>
```

`fetch(key)` is the oracle's FFI: it returns a flight the scenario lands
with `resolve`/`reject`. `{product.name}` and `{pending? product}` are two
readers (V-1): the plain read holds; the probe shows ahead (R-11).

## Frames

| instant | action                              | frame               |
| ------- | ----------------------------------- | ------------------- |
| 0       | mount                               | `sel:a loading`     |
| 1       | resolve product { name: "A" }       | `sel:a A false`     |
| 2       | handler `id := "b"`                 | `sel:b A true`      |
| 3       | resolve product { name: "B" }       | `sel:b B false`     |

Instant 0: the first load is caught by the armed boundary (H-5); the mount
commits with the fallback. Instant 1: the answer lands; the boundary disarms
and shows content. Instant 2: a new question (R-4); the reader of
`product.name` is forwarded by the disarmed boundary into the hold (H-6);
the screen keeps `A`; `latest id` shows `b` and `pending? product` shows
`true` beside it (H-7, H-9). Instant 3: the hold commits as one frame.

## Rejected variants

```
-- warn: ASYNC_OUTSIDE_LOADING_BOUNDARY
source id := "a"
product = await fetch("p:" + id)
<p>{product.name}</p>
```
