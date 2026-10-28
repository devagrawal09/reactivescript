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
forecast = city == "" ? null : len(city) < 3 ? throw TooShort(city) : await fetchForecast(city)
```

- It is asked again whenever its inputs change. An answer to an older question is thrown away when it lands
  (R-4), so a stale answer can never show. Nothing to guard.
- An arm that isn't taken asks nothing (E-11): the empty and the too-short city send no request.
- While a new answer is on its way, everything that reads `forecast` keeps showing the last one (the change is held,
  H-2). To show that work is going on, read ahead: `pending? forecast` is `true` while it's in flight, and
  `latest city` is what was typed.
- The first load has nothing to show yet: wrap the readers in `loading fallback { <p>loading…</p> } { … }`. To
  show the fallback again each time a key changes (a new selection, not a refinement), use `loading on(selected)`.

## 2. Failures: a boundary or a value

- `errored fallback(e) { <p>failed: {e.message}</p> } { … }` shows a failure in place of the content under it.
  Give each pane its own, so one pane's failure never touches another.
- `x catch (e) => e.message` turns a failure into a value, for showing it inline.
- An answer that means "missing" (`null`) is a failure you declare: `export error NotFound(id: number) => …`, and
  `found(await fetchUser(id), id)` with `fn found(it, id) => it == null ? throw NotFound(id) : it`.
- Retry is `refresh x`. It is quiet (AC-4): the failure stays on screen until the new answer replaces it (H-12).

## 3. Writing to the server: an action

```
export source profile: Profile = await loadProfile()   // a source with a question: it can take a guess
export source saveError: string = ""

export action save(next: Profile) {
  optimistic profile := next        // shows now; reverts by itself if the save fails
  optimistic saveError := ""        // the old error goes now
  affects profile                   // `pending? profile` is true until the save ends
  try {
    let answer = await saveProfile(next)
    profile := answer               // the truth
  } catch (e) {
    saveError := e.message          // lands in the same frame as the revert
  }
}
```

A handler can be the action itself, with no keyword: an arrow that writes `optimistic`, declares `affects`, or both
writes and awaits is an action (AC-1b). Declare a named `action` when you call it from more than one place.

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

### Writing one row of a list

When several actions can each change a different row of one list, guess the row, not the list:

```
export source todos: Todo[] key id = await loadTodos()

export action markDone(id: number) {
  try {
    let i = indexOf(todos, t => t.id == id)   // from the prelude; -1 when absent
    optimistic todos[i].done := true          // this row only
    await saveDone(id)
    refresh todos                             // the server's list confirms the guess
  } catch (e) { … }
}
```

A guess on `todos[i].done` belongs to its own action: another action's guess on another row reverts on its own
(AC-3). A guess on the whole list (`optimistic todos := …`) makes every action on the list one change, so a
declined one stays on screen until the others end. After the `await`, re-ask the list (`refresh todos`) rather than
writing the row: a plain write to a list that is guessed by row is not supported yet.

### Guessing data that depends on a selection

A guess on a value whose question reads a selection holds the selection with it: while the action runs, choosing
something else waits for the server, and the screen stays on the old choice until the action ends (F-1). Keep the
pending items in a source of their own, with a constant question, and show them beside the loaded ones:

```
source photo: number := 1
tags = await loadTags(photo)
source adding: { photo: number; tag: string }[] = []
shownAdding = keep(adding, a => a.photo == photo)    // shown after `tags`

export action addTag(p: number, tag: string) {
  try {
    optimistic adding := [...adding, { photo: p, tag: tag }]
    await saveTag(p, tag)
    refresh tags                              // the server's list now has the tag; the guess goes with the action
  } catch (e) { … }
}
```

Changing `photo` while a tag is saving shows the new photo's tags at once, and the pending tag only under its own
photo.

## 4. Things that look like bugs and aren't

- **A plain write in an action doesn't show until the server answers.** That's the hold. Use `optimistic` or
  `onFlush` (the table above). Don't move the code into a plain handler to escape it.
- **Two actions guessing the same source revert together.** Their guesses are one change (H-11): a declined one
  goes back when the other ends. For a list, guess the row instead (above). Don't rebuild guesses by hand to
  separate them.
- **A click waits for an action it has nothing to do with.** A plain write to a source an action in flight has
  written or guessed joins that action's hold (H-2): a click that clears the action's error waits for the
  server. Keep such a write off the action's sources, or make it an `onFlush` run.
- **A failure stays up while its retry is in flight.** That's H-12. To show `loading…` instead, put
  `loading on(k)` above the `errored`.

## 5. Plain handlers

A handler that writes and awaits is an action (AC-1b), so it never lands a write early by accident. A write before
its `await` is a compile error (`HELD_WRITE`), because it would wait for the server: make it `optimistic` if it shows
while the work runs, `onFlush` if it is a reset, or declare the action if it should wait. Plain handlers are for
local state: typing, toggles, selection.

A run never sees its own writes: after `x := v`, reading `x` in the same run gives the old value (W-4), and the
compiler refuses it (`STALE_OWN_READ`). Keep the value in a local: `let n = count + 1; count := n; log(n)`.

## 6. Forms

A draft seeded once from loaded data is a source in the form's component, seeded with `peek`:
`source name := peek(props.initial.name)`. It belongs to the user from then on; a save never resets it.
