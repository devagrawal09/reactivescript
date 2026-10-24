# S-solid-22 — a fallback that itself reads pending data (Solid S-22; D-18)

## Program

```
source id := 1
meta = await fetch("m:" + id)
content = await fetch("c:" + id)
errored fallback(e) { <p>error: {e.message}</p> } {
  <div>{loading fallback { <p>outer</p> } {
    {loading on(id) fallback { <p>Meta {meta}</p> } { <p>{content}</p> }}
  }}</div>
}
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
errored fallback(e) { <p>error: {e.message}</p> } {
  <div>{loading fallback { <p>outer</p> } {
    {loading on(id) fallback { <p>Meta {meta}</p> } { <p>{content}</p> }}
  }}</div>
}
```

| instant | action                 | frame      |
| ------- | ---------------------- | ---------- |
| 3       | handler `id := 2`      | `c1`       |
| 4       | resolve content "c2"   | `c2`       |

## Divergences

- oracle "Variant: content lands first — the fallback is never seen" instant 4: `c1` — Solid 2.0.0-rc.16: the re-armed fallback's `<p>` has an insert effect reading the pending `meta`, and that effect holds the content's reveal until `meta` lands. Solid's S-22 row 3′ says `content(2)`; its pinned test reads the data directly in the fallback function and passes. A Solid bug, reproduced in `@solidjs/signals` alone: `ref/oracle/repros/dv3-signals.mjs` (DV-3).
