# S-store-5 — a stream: each landing is its own quiet change; an input change restarts it

Rules: ST-6, R-4, H-9.

In `ref/` a stream is a flight that lands more than once: `resolve x v`
again on the same flight is the equation body's `yield v`.

## Program

```
source room := "a"
msgs = await fetch("room:" + room)
<p>{msgs} {if pending? msgs then "p" else "-"}</p>
```

## Frames

| instant | action                  | frame     |
| ------- | ----------------------- | --------- |
| 0       | mount                   | ``        |
| 1       | resolve msgs "a1"       | `a1 -`    |
| 2       | resolve msgs "a2"       | `a2 -`    |
| 3       | handler `room := "b"`   | `a2 p`    |
| 4       | resolve "room:a" "a3"   | `a2 p`    |
| 5       | resolve msgs "b1"       | `b1 -`    |
| 6       | resolve msgs "b2"       | `b2 -`    |

Instant 2: a later answer to the same question — quiet. Instant 3: a new
question; the old stream is superseded (R-4) and its later answer (instant
4) is inert.
