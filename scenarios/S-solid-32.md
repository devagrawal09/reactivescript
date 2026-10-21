# S-solid-32 — an optimistic write shows from its instant; held writes beside it; one frame at the end (Solid S-32; D-32, D-33)

Rules: AC-1, AC-3, ST-5, H-11.

## Program

```
source name := "Ann"
source draft = name
source saved := false
action rename(n) { optimistic draft := n; saved := true; await fetch("save"); name := n }
<p>{draft} / {if saved then "saved" else "unsaved"} / {if pending? draft then "p" else "-"} {if pending? saved then "p" else "-"}</p>
```

## Frames

| instant | action                   | frame                  |
| ------- | ------------------------ | ---------------------- |
| 0       | mount                    | `Ann / unsaved / - -`  |
| 1       | handler `rename("Bob")`  | `Bob / unsaved / - p`  |
| 2       | resolve "save" 0         | `Bob / saved / - -`    |

Instant 1: the guess shows; `saved = true` is held; `pending? draft` is
`false` (verdict-inert), `pending? saved` is `true`. Instant 2: `name := n`
after the `await` is the action's; `draft` re-derives to the guess — a
silent confirm; the body returns; the guess ends and the held write commits
in one frame. Never `Ann / unsaved` after 1 (guess held) nor `Bob / saved`
(held write leaked).

## Rejected variants

```
-- reject: OPTIMISTIC_OUTSIDE_HOLD
-- handler: optimistic draft := "Zed"
source name := "Ann"
source draft = name
<p>{draft}</p>
```

A guess outside a hold does not exist (D-32); here it is unwritable.

```
-- reject: OPTIMISTIC_NO_QUESTION
-- handler: fix()
source draft := "Ann"
action fix() { optimistic draft := "Zed"; await fetch("x") }
<p>{draft}</p>
```
