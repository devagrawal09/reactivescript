# S-progress-3 — Poll data arriving while an action holds the feed: `latest feed`

Rules exercised: H-2 (a write to a slot an open change holds joins it),
H-11 (`latest` of a guessed slot answers the guess), R-9, H-7, AC-3.
Guide: `async.md`, "Showing progress while an action runs".

## Program

```rx
export default component App() {
  source feed: string[] := ["a"]
  source sending := ""
  source unread := 0
  action post(text: string) {
    try {
      guess sending := text
      let r = await fetch("post:" + text)
      feed := f => [...f, r]
      let u = await fetch("unread")
      unread := u
    } catch (e) {}
  }
  action poll(n: number) {
    try { let r = await fetch("poll:" + n); feed := f => [...f, r] } catch (e) {}
  }
  <p>{feed.join(",")}{sending ? " (" + sending + "…)" : ""} / {(latest feed).join(",")}</p>
}
```

The message being sent is a guess on its own source, `sending`, not on
`feed`: it shows at once and goes away by itself when the action ends. Until
the server answers, the post holds nothing, so a poll that lands then shows
at once. Once the post has written `feed` and goes on waiting (here, for the
unread count), `feed` is held, and a poll that lands writes it too: it joins
the hold, and a plain reader of `feed` shows it with the post's commit. A
reader of `latest feed` shows it as soon as it lands.

If the post guessed on `feed` itself, `latest feed` would show the guess,
not the truth under it, until the action ends (H-11: a slot showing a guess
has the guess as its newest value), and the poll's message would wait.

## Frames

| instant | action                    | frame                       |
| ------- | ------------------------- | --------------------------- |
| 0       | mount                     | `a / a`                     |
| 1       | handler `post("hi")`      | `a (hi…) / a`               |
| 2       | handler `poll(1)`         | `a (hi…) / a`               |
| 3       | resolve "poll:1" "b"      | `a,b (hi…) / a,b`           |
| 4       | resolve "post:hi" "hi"    | `a,b (hi…) / a,b,hi`        |
| 5       | handler `poll(2)`         | `a,b (hi…) / a,b,hi`        |
| 6       | resolve "poll:2" "c"      | `a,b (hi…) / a,b,hi,c`      |
| 7       | resolve "unread" 3        | `a,b,hi,c / a,b,hi,c`       |

## Variant: the post guesses on the feed

```rx
export default component App() {
  source feed: string[] := ["a"]
  action post(text: string) {
    try {
      guess feed := f => [...f, text + "…"]
      let r = await fetch("post:" + text)
      feed := f => [...f, r]
    } catch (e) {}
  }
  action poll(n: number) {
    try { let r = await fetch("poll:" + n); feed := f => [...f, r] } catch (e) {}
  }
  <p>{feed.join(",")} / {(latest feed).join(",")}</p>
}
```

| instant | action                    | frame                    |
| ------- | ------------------------- | ------------------------ |
| 0       | mount                     | `a / a`                  |
| 1       | handler `post("hi")`      | `a,hi… / a,hi…`          |
| 2       | handler `poll(1)`         | `a,hi… / a,hi…`          |
| 3       | resolve "poll:1" "b"      | `a,hi… / a,hi…`          |
| 4       | resolve "post:hi" "hi"    | `a,b,hi / a,b,hi`        |
