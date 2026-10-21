# S-solid-31 — a verdict reader's mount is mainline: a boundary it opens shows its fallback (Solid S-31; D-27, #3851)

## Program

```
source x := 0
source gate := 0
hold = await fetch("g:" + gate + ":" + x)
<div><p>{x}</p> {if latest x > 0 { {loading fallback { <p>fallback</p> } { <p>content {x}</p> }} }} <i>{hold}</i></div>
```

## Frames

| instant | action               | frame                 |
| ------- | -------------------- | --------------------- |
| 0       | mount                | ``                    |
| 1       | resolve hold "g"     | `0 g`                 |
| 2       | handler `x := 1`     | `0 fallback g`         |
| 3       | resolve hold "g2"    | `1 content 1 g2`       |

Instant 2: the branch opens ahead (display-ahead); the boundary is a
mainline mount whose content read the held write — born held — so it shows
its fallback. `0 | content 1` is the torn frame.

## Divergences

- oracle "Frames" instant 0: `0` — Solid 2.0.0-rc.16 renders a mount partially: readers that are not pending show at once and a pending reader outside any boundary is empty (`ASYNC_OUTSIDE_LOADING_BOUNDARY`); H-2 holds the mount as one frame. Open question for 05 — see spec/05-holds.md §Divergences.
