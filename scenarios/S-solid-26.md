# S-solid-26 — `pending?` is about a new question (Solid S-26 rows 0–3; D-23, D-24)

Rows 4–7 (`refresh`, `affects`, optimistic) wait on 06-stores.

## Program

```
source id := 1
user = await fetch("u:" + id)
{loading fallback { <p>…</p> } { <div><p>{user.name}</p> <p>{if pending? user then "updating" else ""}</p></div> }}
```

## Frames

| instant | action                        | frame            |
| ------- | ----------------------------- | ---------------- |
| 0       | mount                         | `…`              |
| 1       | resolve user { name: "Ann" }  | `Ann `           |
| 2       | handler `id := 2`             | `Ann updating`   |
| 3       | resolve user { name: "Bob" }  | `Bob `           |

Instant 0: the probe's own read suspends with the first load — no verdict,
nothing observable (D-24). Instant 2: an input changed — a new question.
