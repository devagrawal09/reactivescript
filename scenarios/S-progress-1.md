# S-progress-1 — Upload progress per file: plain writes, read through `latest`

Rules exercised: AC-1 (an action that awaits another waits for it; one
change across its awaits), H-2 (two actions writing one source share a
hold), R-9 (`latest x` is the value `x` is moving to), H-7. Guide:
`async.md`, "Showing progress while an action runs".

## Program

```rx
export default component App() {
  source files key id := []
  action sendChunk(id: string, i: number, n: number) {
    try {
      let u = await fetch(id + ":" + i)
      let pct = Math.round(100 * (i + 1) / n)
      if (i + 1 < n) {
        files := fs => fs.map(f => f.id == id ? { ...f, pct: pct } : f)
        await sendChunk(id, i + 1, n)
      } else { files := fs => fs.map(f => f.id == id ? { ...f, pct: 100, url: u } : f) }
    } catch (e) { files := fs => fs.map(f => f.id == id ? { ...f, error: e.message } : f) }
  }
  action attach(id: string, n: number) {
    files := fs => [...fs, { id: id, pct: 0, url: "", error: "" }]
    await sendChunk(id, 0, n)
  }
  <ul>{for f in latest files { <li>{f.id} {f.error ? "failed: " + f.error : f.pct + "%"} {f.url}</li> }}</ul>
  <p>[{files.length}]</p>
}
```

An upload is an action per file; the recursion is how an action repeats an
`await` (there are no loops), and an action that awaits another waits for
it, so a file's upload is one change. Every write is plain: the row, each
chunk's percentage, the URL or the failure. They are what the list should
keep. The list reads `latest files`, which shows each write as soon as it is
made, while the uploads still hold it.

The `[n]` reader reads `files` plainly. Two uploads write the same list, so
their changes are one hold, and it commits when the last upload ends.
Anything that should show only the finished list reads it this way.

## Frames

| instant | action                      | frame                              |
| ------- | --------------------------- | ---------------------------------- |
| 0       | mount                       | `[0]`                              |
| 1       | handler `attach("a", 3)`    | `a 0% [0]`                         |
| 2       | handler `attach("b", 3)`    | `a 0% b 0% [0]`                    |
| 3       | resolve "a:0" "ok"          | `a 33% b 0% [0]`                   |
| 4       | resolve "b:0" "ok"          | `a 33% b 33% [0]`                  |
| 5       | reject "b:1" "boom"         | `a 33% b failed: boom [0]`         |
| 6       | resolve "a:1" "ok"          | `a 67% b failed: boom [0]`         |
| 7       | resolve "a:2" "A"           | `a 100% Ab failed: boom [2]`       |

## Variant: progress from the host

```rx
export default component App() {
  source files key id := []
  action attach(id: string) {
    files := fs => [...fs, { id: id, pct: 0, url: "" }]
    try {
      let u = await fetch("upload:" + id)
      files := fs => fs.map(f => f.id == id ? { ...f, pct: 100, url: u } : f)
    } catch (e) {}
  }
  <ul>{for f in latest files { <li>{f.id} {f.pct}% {f.url}</li> }}</ul>
  <p>[{files.length}]</p>
}
```

When the progress comes from the host (an XHR `progress` event), the
callback runs outside the action, as a run of its own. Its write joins the
upload's hold (the upload has written the list), so `latest files` shows it
at once. The handler rows below stand for those callbacks.

| instant | action                                                                         | frame              |
| ------- | ------------------------------------------------------------------------------ | ------------------ |
| 0       | mount                                                                          | `[0]`              |
| 1       | handler `attach("a")`                                                          | `a 0% [0]`         |
| 2       | handler `files := fs => fs.map(f => f.id == "a" ? { ...f, pct: 40 } : f)`      | `a 40% [0]`        |
| 3       | handler `files := fs => fs.map(f => f.id == "a" ? { ...f, pct: 90 } : f)`      | `a 90% [0]`        |
| 4       | resolve "upload:a" "A"                                                         | `a 100% A[1]`      |
