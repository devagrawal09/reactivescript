# Async in .rx: read this before writing any

This is the one page to read before you write code that talks to a server. The rules it cites are in `spec/`; you
don't need them to follow it.

## Rule zero: don't track requests yourself

Don't write sequence numbers, request ids, "latest token" checks, `if (stillCurrent)` guards, cancellation flags,
or lists of pending requests. In .rx those are bugs waiting to happen, and they are never needed. The language
already knows which question is current and which change a write belongs to. If you're reaching for a counter, you
want one of the moves below.

## 1. Reading from the server: an equation

```
results = query == "" ? [] : len(query) < 2 ? throw TooShort(query) : await search(query)
```

- It is asked again whenever its inputs change. An answer to an older question is thrown away when it lands
  (R-4), so a stale answer can never show. Nothing to guard.
- An arm that isn't taken asks nothing (E-11): the empty and the too-short query send no request.
- While a new answer is on its way, everything that reads `results` keeps showing the last one (the change is held,
  H-2). To show that work is going on, read ahead: `pending? results` is `true` while it's in flight, and
  `latest query` is what was typed.
- The first load has nothing to show yet: wrap the readers in `loading fallback { <p>loading…</p> } { … }`. To
  show the fallback again each time a key changes (a new selection, not a refinement), use `loading on(selected)`.

## 2. Failures: a boundary or a value

- `errored fallback(e) { <p>failed: {e.message}</p> } { … }` shows a failure in place of the content under it.
  Give each pane its own, so one pane's failure never touches another.
- `x catch (e) => e.message` turns a failure into a value, for showing it inline.
- An answer that means "missing" (`null`) is a failure you declare: `export error NotFound(id: number) => …`, and
  `found(await fetchItem(id), id)` with `fn found(it, id) => it == null ? throw NotFound(id) : it`.
- Retry is `refresh x`. It is quiet (AC-4): the failure stays on screen until the new answer replaces it (H-12).

## 3. Writing to the server: an action

```
export source saved: Settings = await loadSettings()   // a source with a question: it can take a guess
export source saveError: string = ""

export action save(next: Settings) {
  optimistic saved := next          // shows now; reverts by itself if the save fails
  optimistic saveError := ""        // the old error goes now
  affects saved                     // `pending? saved` is true until the save ends
  try {
    let answer = await saveSettings(next)
    saved := answer                 // the truth
  } catch (e) {
    saveError := e.message          // lands in the same frame as the revert
  }
}
```

An action's body is **one change**: every plain write in it, before or after an `await`, is held until the body
returns (AC-1). That is what makes it safe, and it is why a plain write there doesn't show at once. Pick the write
by what the screen should do:

| You want | Write |
| --- | --- |
| Show a value now, and take it back if the action fails | `optimistic x := v` (x is a source with a question: `source x = …`) |
| `pending? x` true while the action runs | `affects x` |
| Land a UI write now and keep it (close a menu, clear a message) | `onFlush(() => { x := v })` (EF-8) |
| Record the server's answer | `x := answer` after the `await` |
| Handle a failure | `try { … } catch (e) { … }`: the catch's writes and the revert are one frame (AC-7) |

## 4. Things that look like bugs and aren't

- **A plain write in an action doesn't show until the server answers.** That's the hold. Use `optimistic` or
  `onFlush` (the table above). Don't move the code into a plain handler to escape it.
- **Two actions guessing the same source revert together.** Their guesses are one change (H-11): a declined one
  goes back when the other ends. Don't rebuild guesses by hand to separate them.
- **A failure stays up while its retry is in flight.** That's H-12. To show `loading…` instead, put
  `loading on(k)` above the `errored`.

## 5. Plain handlers

A handler that awaits outside an action has no hold: each write lands when its line runs, in whatever order the
answers come back, and ordering is then your problem (AC-7). Use plain handlers for local state only: typing,
toggles, selection. Anything that waits on the server is an equation (reads) or an action (writes).

## 6. Forms

A draft seeded once from loaded data is a source in the form's component, seeded with `peek`:
`source name := peek(props.initial.name)`. It belongs to the user from then on; a save never resets it.
