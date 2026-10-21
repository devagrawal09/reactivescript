# S-solid-25 — nothing shows a write before its instant; then every channel at once (Solid S-25; D-22, D-32)

A write becomes visible at its instant's settle, to every channel (H-10).
The in-run invisibility (Solid's "no flush" row) is W-4 and is exercised by
S-core-1's multi-write instant; this scenario covers the held case.

## Program

```
source count := 20
doubled = count * 2
slow = await fetch("s:" + count)
<div><p>{count}</p> <p>{latest count}</p> <p>{latest doubled}</p> <p>{pending? count}</p> <i>{slow}</i></div>
```

## Frames

| instant | action                 | frame                  |
| ------- | ---------------------- | ---------------------- |
| 0       | mount                  | ``                     |
| 1       | resolve slow 20        | `20 20 40 false 20`    |
| 2       | handler `count := 30`  | `20 30 60 true 20`     |
| 3       | resolve slow 30        | `30 30 60 false 30`    |

Instant 2: an async reader holds `count`; the plain read stays `20`, both
probes show `30`/`60` together (never `latest count` 30 beside
`latest doubled` 40), and the verdict is `true`.

## Divergences

- oracle "Frames" instant 0: `20 20 40 false` — Solid 2.0.0-rc.16 renders a mount partially: readers that are not pending show at once and a pending reader outside any boundary is empty (`ASYNC_OUTSIDE_LOADING_BOUNDARY`); H-2 holds the mount as one frame. Open question for 05 — see spec/05-holds.md §Divergences.
