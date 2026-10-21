# S-solid-13 — the last on-screen reader leaving releases the hold (Solid S-13; D-11, O3)

## Program

```
source count := 0
source show := true
details = await fetch("d:" + count)
<div><p>Count {count}</p> {if show { <p>{details}</p> }}</div>
```

## Frames

| instant | action                    | frame        |
| ------- | ------------------------- | ------------ |
| 0       | mount                     | ``           |
| 1       | resolve details 0         | `Count 0 0`  |
| 2       | handler `count := 1`      | `Count 0 0`  |
| 3       | handler `show := false`   | `Count 1 `   |

Instant 3: the gate closes; no on-screen reader derives from the flight, so
nothing holds `count = 1` any more. `details(1)` never lands in this
scenario.

## Divergences

- oracle "Frames" instant 0: `Count 0` — Solid 2.0.0-rc.16 renders a mount partially: readers that are not pending show at once and a pending reader outside any boundary is empty (`ASYNC_OUTSIDE_LOADING_BOUNDARY`); H-2 holds the mount as one frame. Open question for 05 — see spec/05-holds.md §Divergences.
