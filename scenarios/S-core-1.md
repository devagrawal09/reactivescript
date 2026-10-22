# S-core-1 — the counter

Rules exercised: E-1, E-2, E-4, E-6, W-1, W-2, W-3, C-2, C-2a, EF-2, EF-4, P-6.

## Program

```
source count := 0
source show := true
double = count * 2
label  = "prev " + pre double -> 0
effect (double) { log(double) }
<p>{show ? double : "-"} {label}</p>
```

## Frames

| instant | action                           | frame        | effect    |
| ------- | -------------------------------- | ------------ | --------- |
| 0       | mount                            | `0 prev 0`   | `log(0)`  |
| 1       | handler `count := 1`             | `2 prev 0`   | `log(2)`  |
| 2       | handler `count := 1`             | `2 prev 2`   | —         |
| 3       | handler `count := 5; count := 7` | `14 prev 2`  | `log(14)` |
| 4       | handler `show := false`          | `- prev 14`  | —         |
| 5       | handler `count := 8`             | `- prev 14`  | `log(16)` |

## Variant: no effect (`double` undemanded while `show` is false)

```
source count := 0
source show := true
double = count * 2
label  = "prev " + pre double -> 0
<p>{show ? double : "-"} {label}</p>
```

| instant | action                  | frame       |
| ------- | ----------------------- | ----------- |
| 4       | handler `show := false` | `- prev 14` |
| 5       | handler `count := 8`    | `- prev 0`  |

Known divergence from Solid 2.0 lazy memo (`prev 14`, last evaluation). P-6
rules previous frame. Confirm in `ref/` phase 3.

## Rejected variants

```
-- reject: W-1
source count := 0
double = count * 2
effect (count) { double := 4 }
```

```
-- reject: W-2
source count := 0
count := 1
```

```
-- reject: C-1
source s := 0
a = b + 1
b = a + 1
<p>{a}</p>
```
