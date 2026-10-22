# S-solid-35 — the body's end corrects a guess nothing authoritative is answering (Solid S-35; D-35)

Rules: AC-1, AC-3, H-11.

## Program

```
source truth := 1
source guess = truth
action try() { optimistic guess := 5; await fetch("unrelated") }
<p>{guess} / {latest guess} {pending? guess ? "p" : "-"}</p>
```

## Frames

| instant | action                   | frame       |
| ------- | ------------------------ | ----------- |
| 0       | mount                    | `1 / 1 -`   |
| 1       | handler `try()`          | `5 / 5 -`   |
| 2       | resolve "unrelated" 0    | `1 / 1 -`   |

Instant 1: the guess's own source is not re-asked: `pending? guess` is
`false`. Instant 2: the body returns with nothing authoritative in flight;
the guess is corrected by the truth at hand and, nothing else holding the
change, commits in the same instant. Solid's rows 2 and 3 (correction, then
commit) are one instant here.

## Variant: a derived flight keeps the hold open

```
source truth := 1
source guess = truth
derived = await fetch("x:" + str(guess))
action try() { optimistic guess := 5; await fetch("unrelated") }
<p>{guess} {derived} / {latest guess} {pending? guess ? "p" : "-"}</p>
```

| instant | action                   | frame           |
| ------- | ------------------------ | --------------- |
| 0       | mount                    | ``              |
| 1       | resolve derived "x1"     | `1 x1 / 1 -`    |
| 2       | handler `try()`          | `1 x1 / 1 -`    |
| 3       | resolve "unrelated" 0    | `1 x1 / 1 -`    |
| 4       | resolve "x:5" "x5"       | `1 x1 / 1 -`    |
| 5       | resolve derived "x1"     | `1 x1 / 1 -`    |

Instant 2: the guess's lane holds itself on `derived(5)`; the guess never
shows, and the on-screen probes are in the same lane (D-25). Instant 3:
the body's end corrects the guess — `derived` re-asks from the truth
(`x:1`), so instant 5's `resolve derived` lands that flight while the
obsolete `x:5` (instant 4) is inert; untracked, `latest guess` is the
truth and `pending? guess` is `true` until the commit.
