# S-progress-4 — An undo entry shown as soon as its write returns: `latest history`

Rules exercised: AC-1, R-9, H-7. Guide: `async.md`, "Showing progress
while an action runs".

## Program

```rx
export default component App() {
  source history: string[] := []
  source activity := "v1"
  action move(card: string) {
    try {
      let r = await fetch("move:" + card)
      history := h => [...h, r]
      let a = await fetch("activity")
      activity := a
    } catch (e) {}
  }
  <p>{activity} {history.length > 0 ? "undo" : "-"} / {(latest history).length > 0 ? "undo" : "-"}</p>
}
```

The move's own answer comes back first; the action then waits for the
activity reload, and its writes commit together. A button that reads
`history` plainly appears with that commit. One that reads `latest history`
appears as soon as the entry is written.

## Frames

| instant | action                      | frame              |
| ------- | --------------------------- | ------------------ |
| 0       | mount                       | `v1 - / -`         |
| 1       | handler `move("c1")`        | `v1 - / -`         |
| 2       | resolve "move:c1" "m1"      | `v1 - / undo`      |
| 3       | resolve "activity" "v2"     | `v2 undo / undo`   |
