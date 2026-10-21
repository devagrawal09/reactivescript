# S-solid-22 — a fallback that itself reads pending data (Solid S-22; D-18)

## Program

```
source id := 1
meta = await fetch("m:" + id)
content = await fetch("c:" + id)
<div>{loading fallback { <p>outer</p> } {
  {loading on(id) fallback { <p>Meta {meta}</p> } { <p>{content}</p> }}
}}</div>
```

## Frames

| instant | action                 | frame      |
| ------- | ---------------------- | ---------- |
| 0       | mount                  | `outer`    |
| 1       | resolve meta 1         | `Meta 1`   |
| 2       | resolve content "c1"   | `c1`       |
| 3       | handler `id := 2`      | `c1`       |
| 4       | resolve meta 2         | `Meta 2`   |
| 5       | resolve content "c2"   | `c2`       |

Instant 0: the inner fallback's pending is the parent's. Instant 3: the old
content stays until the fallback can show; the parent never drops to
`outer` for a child's re-arm.

## Variant: content lands first — the fallback is never seen

```
source id := 1
meta = await fetch("m:" + id)
content = await fetch("c:" + id)
<div>{loading fallback { <p>outer</p> } {
  {loading on(id) fallback { <p>Meta {meta}</p> } { <p>{content}</p> }}
}}</div>
```

| instant | action                 | frame      |
| ------- | ---------------------- | ---------- |
| 3       | handler `id := 2`      | `c1`       |
| 4       | resolve content "c2"   | `c2`       |

## Divergences

- oracle "Variant: content lands first — the fallback is never seen" instant 4: `c1` — Solid 2.0.0-rc.16 through `solid-js`'s `<Loading>`: the content's landing does not reveal while the re-armed fallback's own reader (`meta`) is pending — the old content stays until `meta` lands. Solid's own S-22 row 3′ and its signals-level pin (`loading-on-rearm-reveal-3540.test.ts`, "content lands before the fallback") say `content(2)`; suspected web-layer bug, reported upstream.
