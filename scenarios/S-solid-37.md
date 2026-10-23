# S-solid-37 — a derived source's seed is never visible; pending is per key (Solid S-37; D-30)

Rules: ST-2c, ST-5, AC-4, R-7.

## Program

```
source id := 1
source state = await fetch("s:" + str(id))
action patch() { state.a := 5; await fetch("w") }
{loading fallback { <p>loading</p> } { <p>{state.a} {state.b} {pending? state.a ? "a!" : "-"} {pending? state.b ? "b!" : "-"}</p> }}
```

## Frames

| instant | action                        | frame          |
| ------- | ----------------------------- | -------------- |
| 0       | mount                         | `loading`      |
| 1       | resolve state { a: 1, b: 1 }  | `1 1 - -`      |
| 2       | handler `id := 2`             | `1 1 a! b!`    |
| 3       | resolve state { a: 2, b: 2 }  | `2 2 - -`      |
| 4       | handler `refresh state`       | `2 2 - -`      |
| 5       | resolve state { a: 3, b: 3 }  | `3 3 - -`      |

Instant 0: there is no seed to see — the first load suspends to the
boundary. Instant 2: the derive re-asks: the whole family is pending.
Instant 4: a quiet re-ask.

## Variant: a held path write pends exactly its key (row 2′)

| instant | action                        | frame          |
| ------- | ----------------------------- | -------------- |
| 2       | handler `patch()`             | `1 1 a! -`     |
| 3       | resolve "w" 0                 | `5 1 - -`      |

Per key: the sibling is final.

## Divergences

- oracle "Frames" instant 2: `1 1 - -` — Solid 2.0.0-rc.16: under a `<Loading>` that has shown content, a derived store's per-key verdicts (`isPending(() => state.a)`) read `false` while the derive re-asks; outside a boundary, or for an async memo under the same boundary (S-solid-26), they read `true`. Solid's D-30 and its S-37 row 2 say `true`. A Solid bug, reproduced standalone (`ref/oracle/repros/dv4-signals.mjs`; DV-4 in spec/05-holds.md).
