# S-core-1 — the counter

Rules exercised: E-1, E-2, E-4, E-6, W-1, W-2, W-3, C-2, C-2a, EF-2, EF-4, P-6.

## Program

```
source count = 0
source show  = true
double = op*(count, 2)
label  = op+("prev ", pre double -> 0)
effect (double) { log(double) }
view <p>{if show then double else "-"} {label}</p>
```

## Frames

| instant | action                           | frame `<p>`  | effect    |
| ------- | -------------------------------- | ------------ | --------- |
| 0       | mount                            | `0 prev 0`   | `log(0)`  |
| 1       | handler `count := 1`             | `2 prev 0`   | `log(2)`  |
| 2       | handler `count := 1`             | `2 prev 0`   | —         |
| 3       | handler `count := 5; count := 7` | `14 prev 2`  | `log(14)` |
| 4       | handler `show := false`          | `- prev 14`  | —         |
| 5       | handler `count := 8`             | `- prev 14`  | `log(16)` |

## Variant: no effect (`double` undemanded while `show` is false)

| instant | action                  | frame `<p>` |
| ------- | ----------------------- | ----------- |
| 4       | handler `show := false` | `- prev 14` |
| 5       | handler `count := 8`    | `- prev 0`  |

Known divergence from Solid 2.0 lazy memo (`prev 14`, last evaluation). P-6
rules previous frame. Confirm in `ref/` phase 3.

## Rejected variants

| fragment                                | rule | verdict      |
| --------------------------------------- | ---- | ------------ |
| `double := 4` in a handler              | W-1  | rejected (U) |
| `count := 1` at top level               | W-2  | rejected (U) |
| `a = op+(b, 1); b = op+(a, 1)`          | C-1  | rejected (S) |
| `effect (count) { count := count + 1 }` | C-3  | accepted, diagnostic `EFFECT_WRITES_OWN_SOURCE` |
