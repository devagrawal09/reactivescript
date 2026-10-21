# S-solid-27 — `[pending? x, x]` is atomic; the `latest` form follows x's own async only (Solid S-27; D-23)

## Program

```
source n := 0
x = await fetch("x:" + n)
y = await fetch("y:" + x)
<div><p>{str(pending? x) + "," + str(x)}</p> <p>{str(pending? latest x) + "," + str(latest x)}</p> <i>{y}</i></div>
```

The first `<p>` is one reader with a plain read beside the probe: it holds
like `x` alone and the pair stays atomic (R-11). The second reads `x` only
through `latest`, so it follows `x`'s own async.

## Frames

| instant | action              | frame                     |
| ------- | ------------------- | ------------------------- |
| 0       | mount               | ``                        |
| 1       | resolve x "x0"      | ``                        |
| 2       | resolve y "y0"      | `false,x0 false,x0 y0`    |
| 3       | handler `n := 1`    | `true,x0 true,x0 y0`      |
| 4       | resolve x "x1"      | `true,x0 false,x1 y0`     |
| 5       | resolve y "y1"      | `false,x1 false,x1 y1`    |

Instant 4: `x(1)` landed but `y(1)` is still up, so the frame is held: the
atomic pair shows `[true, x0]` (a landed answer awaiting reveal); the
`latest` form saw `x`'s own answer — `[false, x1]`. Never `[true, x1]`.

## Divergences

- oracle "Frames" instant 1: `false,x0 false,x0` — at the mount a verdict reader (`pending? x` beside `x`) shows its landed value ahead of the still-pending `y` reader in Solid; H-2 holds the mount as one frame, so nothing shows until `y` lands. Same open question as the partial mount.
