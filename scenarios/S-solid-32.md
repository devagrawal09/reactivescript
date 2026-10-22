# S-solid-32 — an optimistic write shows from its instant; held writes beside it; one frame at the end (Solid S-32; D-32, D-33)

Rules: AC-1, AC-3, ST-5, H-11.

## Program

```
source name := "Ann"
source shown = name
source saved := false
action rename(n) { optimistic shown := n; saved := true; await fetch("save"); name := n }
<p>{shown} / {if saved then "saved" else "unsaved"} / {if pending? shown then "p" else "-"} {if pending? saved then "p" else "-"}</p>
```

## Frames

| instant | action                   | frame                  |
| ------- | ------------------------ | ---------------------- |
| 0       | mount                    | `Ann / unsaved / - -`  |
| 1       | handler `rename("Bob")`  | `Bob / unsaved / - p`  |
| 2       | resolve "save" 0         | `Bob / saved / - -`    |

Instant 1: the guess shows; `saved = true` is held; `pending? shown` is
`false` (verdict-inert), `pending? saved` is `true`. Instant 2: `name := n`
after the `await` is the action's; `shown` re-derives to the guess — a
silent confirm; the body returns; the guess ends and the held write commits
in one frame. Never `Ann / unsaved` after 1 (guess held) nor `Bob / saved`
(held write leaked).

## Variant: the save rejects — the guess reverts, the held write commits

| instant | action                   | frame                  |
| ------- | ------------------------ | ---------------------- |
| 2       | reject "save" "boom"     | `Ann / saved / - -`    |

The guess `Bob` reverts to the truth (`name` is still `Ann`); `saved = true`
was a plain write and commits (AC-1, DV-2).

## Rejected variants

```
-- reject: OPTIMISTIC_OUTSIDE_HOLD
-- handler: optimistic shown := "Zed"
source name := "Ann"
source shown = name
<p>{shown}</p>
```

A guess outside a hold does not exist (D-32); here it is unwritable.

```
-- reject: OPTIMISTIC_NO_QUESTION
-- handler: fix()
source shown := "Ann"
action fix() { optimistic shown := "Zed"; await fetch("x") }
<p>{shown}</p>
```
