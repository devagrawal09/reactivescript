# S-solid-2 — a memo that starts reading a held value reveals with it (Solid S-2; D-1)

## Program

```
source count := 0
source show  := false
details = await fetch("d:" + count)
panel   = if show then count else "hidden"
<div><p>Count {count}</p> <p>Details {details}</p> <p>Panel {panel}</p></div>
```

## Frames

| instant | action                   | frame                                 |
| ------- | ------------------------ | ------------------------------------- |
| 0       | mount                    | ``                                    |
| 1       | resolve details 0        | `Count 0 Details 0 Panel hidden`      |
| 2       | handler `count := 1`     | `Count 0 Details 0 Panel hidden`      |
| 3       | handler `show := true`   | `Count 0 Details 0 Panel hidden`      |
| 4       | resolve details 1        | `Count 1 Details 1 Panel 1`           |

Instant 3: `panel` is an equation; its pass reads the held `count` (1 in
σ′) and so it joins the hold — `Panel 1` beside `Count 0` would reveal the
future (the ✗ row). The `show` write waits with it.

## Divergences

- oracle "Frames" instant 0: `Count 0 Panel hidden` — Solid 2.0.0-rc.16 renders a mount partially: readers that are not pending show at once and a pending reader outside any boundary is empty (`ASYNC_OUTSIDE_LOADING_BOUNDARY`); H-2 holds the mount as one frame. Open question for 05 — see spec/05-holds.md §Divergences.
