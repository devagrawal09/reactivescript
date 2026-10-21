# S-solid-40 — a fresh boundary that reads only `latest` shows it now (Solid S-40; D-12, F-6)

## Program

```
source s := 0
n0 = await fetch("n:" + s)
<div><p>{n0}</p> {loading fallback { <p>loading</p> } { <p>{latest s}</p> }}</div>
```

## Frames

| instant | action              | frame     |
| ------- | ------------------- | --------- |
| 0       | mount               | ``        |
| 1       | resolve n0 0        | `0 0`     |
| 2       | handler `s := 1`    | `0 1`     |
| 3       | resolve n0 1        | `1 1`     |

Instant 2: the sibling holds; the boundary's read has a value, so it shows
it — neither an empty slot nor the fallback.

## Divergences

- oracle "Frames" instant 0: `0` — Solid 2.0.0-rc.16 renders a mount partially: readers that are not pending show at once and a pending reader outside any boundary is empty; H-2 holds the mount as one frame. Open question for 05 — see spec/05-holds.md §Divergences.
