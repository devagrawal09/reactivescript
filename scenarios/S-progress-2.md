# S-progress-2 — Bulk "n of 3" with per-row results: plain writes read through `latest`

Rules exercised: AC-1, R-9 (`latest x` is the value `x` is moving to), H-7,
H-9 (`pending?` of a held write), AC-3 (a guess as a "while it runs" flag).
Guide: `async.md`, "Showing progress while an action runs".

## Program

```rx
export default component App() {
  source results := {}
  source running := false
  action applyFrom(ids: number[], i: number) {
    if (i >= ids.length) return
    let id = ids[i]
    let r = await fetch("row:" + id) catch (e) => "failed: " + e.message
    results[id] := r
    await applyFrom(ids, i + 1)
  }
  action bulk(ids: number[]) {
    guess running := true
    await applyFrom(ids, 0)
  }
  done = Object.keys(latest results).length
  <p>{running ? "applying " + done + " of 3" : "idle"}: {[1, 2, 3].map(id => (latest results)[id] ?? "-").join(" ")} [{Object.keys(results).length}]</p>
}
```

The batch is one action: its result writes are one change and commit
together. Each row's result is a plain write (it stays after the batch);
the rows and the count read it with `latest`, which shows a held write as
soon as it is made. `running` is a guess, so it shows at once and goes back
to `false` by itself when the batch ends. The `[n]` reader reads `results`
plainly: it shows the committed batch.

## Frames

| instant | action                         | frame                                         |
| ------- | ------------------------------ | --------------------------------------------- |
| 0       | mount                          | `idle: - - - [0]`                             |
| 1       | handler `bulk([1, 2, 3])`      | `applying 0 of 3: - - - [0]`                  |
| 2       | resolve "row:1" "ok"           | `applying 1 of 3: ok - - [0]`                 |
| 3       | reject "row:2" "boom"          | `applying 2 of 3: ok failed: boom - [0]`      |
| 4       | resolve "row:3" "ok"           | `idle: ok failed: boom ok [3]`                |
