# Async in .rx: read this before writing any

This is the one page to read before you write code that talks to a server. The rules it cites are in `spec/`; you
don't need them to follow it.

## Rule zero: don't track requests yourself

Don't write sequence numbers, request ids, "latest token" checks, `if (stillCurrent)` guards, cancellation flags,
or lists of pending requests. In .rx those are bugs waiting to happen, and they are never needed. The language
already knows which question is current and which change a write belongs to. If you're reaching for a counter, you
want one of the moves below.

## What lands together, and what waits

Everything one run writes (one handler call, one apply block) lands together, as one **instant** (W-3). An instant
waits, or is **held**, while anything downstream of it is still loading (H-2). You don't need an `await` for that:
`page := 2` in a plain handler holds if a fetch reads `page`. An action is the other way in: it keeps its change open
across its awaits, and the handler that launches it joins it (AC-1). Then every other write in that instant waits
too, so `open := false; page := 2` closes the menu only when page 2 arrives (S-flush-1).

Usually that's right: the screen changes in one frame. When a write must not wait (clear the input you just
submitted, close a menu, clear an error), give it its own instant: `onFlush(() => { text := "" })` (EF-8). The
compiler can't tell a reset from a write that should wait with the rest, such as a tab highlight that moves with its
page, so it's your call. Decide it for each write that sits next to work that loads.

```rx
// submit a todo: the input clears now, the row shows as a guess until the server answers
let t = text
onFlush(() => { text := "" })
addTodo(t)
```

## 1. Reading from the server: an equation

```rx
forecast = city == "" ? null : city.length < 3 ? throw TooShort(city) : await fetchForecast(city)
```

- It is asked again whenever its inputs change. An answer to an older question is thrown away when it lands
  (R-4), so a stale answer can never show. Nothing to guard.
- An arm that isn't taken asks nothing (E-11): the empty and the too-short city send no request.
- While a new answer is on its way, everything that reads `forecast` keeps showing the last one (the change is held,
  H-2). To show that work is going on, read ahead: `pending? forecast` is `true` while it's in flight, and
  `latest city` is what was typed.
- The first load has nothing to show yet: wrap the readers in `loading fallback { <p>loading…</p> } { … }`. To
  show the fallback again each time a key changes (a new selection, not a refinement), use `loading on(selected)`.
- An answer read outside the region that loads it (elsewhere on the page, a count, a button's `disabled`) needs a
  value before it lands, or every one of those readers waits with it, and so does every reader of a store over it.
  Give the answer its value where it's declared, and lay the store over it:

  ```rx
  source folderAns = await fetchFolder(name) -> null           // null until the first answer (R-7)
  messages key id = folderAns == null ? [] : folderAns         // the store the page reads and the guesses go on
  ```

  Its own `loading` region shows while `folderAns == null`; every other reader reads `messages` and never waits.

## 2. Failures: a region where they're read

There are two kinds of failure, and each has one home. A **read** that failed (the server's answer couldn't be
loaded) is shown by an `errored` region where it's read; nothing else handles it. A **write** that failed is the
client's own state: a plain source the action's `catch` writes, shown beside the thing it failed on (section 3).

- `errored fallback(e) { <p>failed: {e.message}</p> } { … }` shows a failure in place of the content under it.
  Give each answer's readers their own, so one answer's failure never takes down what doesn't read it.
- **A failure is shown where it's read.** A value that failed is failed for every reader, and derivations over it are
  plain code: no `catch` inside them. What needs several answers (a row found by searching several
  lists) fails when any of them fails. Put those readers in an `errored` region of their own, whose fallback says it
  can't show that part right now, so what reads other answers beside it stays.
- **A handler reads what its region shows**, the row, the list it is in, its index, and passes them on as plain
  values. A handler that reads an answer its region doesn't show takes that answer's failure too, and no region can
  show it there: the read throws. When a write changes more than its own list, it re-asks the answers it can touch
  (section 3) instead of reading them.
- `catch` follows an `await` and nothing else: `await fetchUser(id) catch (e: NotFound) => null` makes that rejection
  the answer. Use it when a rejection means something the page shows as data (missing, empty), not to hide a failure.
- A rule the user breaks (a field left empty) is a value, not a failure: `fn problem(s) => s.name == "" ? "Name is
  required" : ""`, shown next to the field.
- An answer that means "missing" (`null`) is a failure you declare: `export error NotFound(id: number) => …`, and
  `found(await fetchUser(id), id)` with `fn found(it, id) => it == null ? throw NotFound(id) : it`.
- Retry is `refresh x`. It is quiet (AC-4): the failure stays on screen until the new answer replaces it (H-12).

## 3. Writing to the server: an action

```rx
export source profile: Profile = await loadProfile()   // a question source: the server answer can replace the guess
export source saveError: string := ""

export action save(next: Profile) {
  guess profile := next        // shows now; reverts by itself if the save fails
  onFlush(() => { saveError := "" })   // the old error goes now, in its own instant (EF-8)
  affects profile                   // `pending? profile` is true until the save ends
  try {
    let answer = await saveProfile(next)
    profile := answer               // the truth
  } catch (e) {
    saveError := e.message          // lands in the same frame as the revert
    onFlush(() => { saveError := e.message })   // and stays, if the body failed before its first await
  }
}
```

Write the error both ways. A failure after the `await` lands in the action's last instant, with the revert, and the
`onFlush` run then writes the same value, which changes nothing. A failure before the first `await` (a `throw`, or a
call that throws) lands in the action's first instant, so the clear above runs after it and would erase it; the second
`onFlush` runs after the clear, in the same instant (EF-8: one step's callbacks run in call order), and puts it back.

A handler can be the action itself, with no keyword: an arrow that writes `guess`, declares `affects`, or both
writes and awaits is an action (AC-1b). Declare a named `action` when you call it from more than one place.

An action's body is **one change**: every plain write in it, before or after an `await`, is held until the body
returns (AC-1). That is what makes it safe, and it is why a plain write there doesn't show at once. Pick the write
by what the screen should do:

| You want | Write |
| --- | --- |
| Show a value now, and take it back if the action fails | `guess x := v` (x is a source or an equation) |
| `pending? x` true while the action runs | `affects x` |
| Land a UI write now and keep it (close a menu, clear a message) | `onFlush(() => { x := v })` (EF-8) |
| Record the server's answer | `x := answer` after the `await` |
| Handle a failure | `try { … } catch (e) { … }`: the catch's writes and the revert are one frame (AC-7) |

To guess a value a component gets as a prop, guess its own equation of it: `shown = props.title`, then
`guess shown := t` in the action. A prop itself is read-only (O-4), and the guess shows wherever the child reads `shown`.

A writable `source x := seed` can take a guess too. Its plain writes land when the action commits; if nothing
writes it, the guess ends and the previous value shows again. No question or `refresh` is needed (AC-3).

### Guesses go on the answer

There is one shape for a write on server data. The server's answers are the stores the screen reads, and a write
guesses on them, as the server will make them:

1. **Guess on every store the write shows in.** An edit is a path guess on its row (`guess issues[i].title := t`), at
   an index the handler works out from the screen and passes in. An add, a removal or a move is a function guess on
   each list it changes (`guess open := rs => moved(rs, m)`). A title shown in a list row and in a detail heading is
   two guesses, one on each answer.
2. **Accepted: re-ask the answers it changed** (`refresh issues`). Its guesses stay until the new answers land (D-34),
   so the change never blinks out and never shows twice. On a decline re-ask nothing: the guesses revert with the
   message, in one frame (AC-7).
3. **A row that wasn't on screen to guess** (the handler's index was -1: a filtered-out row, a list still loading)
   gets the server's answer as a guess after the `await`, until the re-ask lands:
   `if (i < 0) { guess issues := rs => rs.map(x => x.id == r.id ? { ...x, title: r.title } : x) }`.

```rx
export source filter := "open"
issues key id = await fetchIssues(filter)
detail = selected == null ? null : await fetchIssue(selected)

export action rename(id: number, title: string, i: number) {    // i: the row's index on screen, from the handler
  try {
    if (i >= 0) { guess issues[i].title := title }
    guess detail.title := title
    let r = await renameIssue(id, title)
    if (i < 0) { guess issues := rs => rs.map(x => x.id == r.id ? { ...x, title: r.title } : x) }
    refresh issues
    refresh detail
  } catch (e) {
    renameError := e.message
  }
}
```

- **Don't keep writes in lists of your own laid over the answers.** That shape needs every view to merge every list,
  and every accept to be written back by hand, and those hand-written writes are where apps go wrong: a row written
  into the column it was in at the click, a card whose rename is lost, a placeholder shown beside its own row.
- **A new row** is a placeholder guessed into the list it will join, under a key minted in the handler. With a server
  id it is inert (no controls, since the server doesn't know it yet) and the re-ask replaces it; a client id the
  server keeps lets the placeholder be the row.
- **When the server answers a kind of row in several fetches** (one list per status, per folder, per page), each fetch
  is its own keyed store, row for row in the server's order, so a row shows once. Each list has its own
  `loading` value and `errored` region (sections 1 and 2), so no fetch holds or fails another. A move guesses the list it leaves
  and the list it joins. On accept, re-ask **every list the row can be in**, not only the two the handler saw: another
  write of the same row may have been answered first and moved it elsewhere. Don't work out which list holds it now
  from the screen (`latest`): a list that hasn't answered yet has no value to read, and the read throws.
- **Work out positions in the handler and pass them in**: an index, a count, a place in the target, computed from
  the screen (a snapshot, R-8). An action that reads a value another action guessed and then guesses is one change
  with that action (H-11, D-33).
- **After the `await`, take only what is the server's.** A plain write into an answer after the server answered
  takes its answer and the answer's own value at the write (`x := rs => …`, rows found by id), never a row the handler
  saw or one read from another source: by then it may have changed, or be held with this write. Pass actions plain
  values (ids, titles, indexes), not rows. The compiler flags the rest (`STALE_CAPTURE`, AC-1g).
- **A failure is the client's, not a guess.** A guess reverts when its action ends; a failure must outlast it, so it
  is a plain source, and a successful retry removes it.
- **Generate ids on the client** in the handler, before calling the action, so a declined add can be shown again
  with its retry.
- **Show that something is in flight**, so a long wait isn't silent: a row flag set by the guess
  (`guess issues[i].saving := true`), or `pending? issues` with `affects issues`.

### When a guess holds

A guess belongs to its action, and the screen it guessed on waits for that action to end. This is the design
(H-11): the screen is never wrong in between. It shows the guesses, then the truth, in one frame.

- **Two writes on one slot or one list end together.** Two moves that change one list, or two adds to it, share it:
  a declined one stays until the other ends. Writes on different rows' paths stay apart.
- **A new question for a guessed answer waits for the write.** Switching a filter, a selection, or reopening the page
  re-asks the answer, and the switch holds with the write's action: the screen stays on the old answer until the
  action ends. Keep the switch and the write in different clicks; don't move the guess off the answer to dodge it.
- **A guess on a value loading a new question** composes on the previous answer, and the new answer replaces it
  (D-34), so the change doesn't show until the re-ask lands. Keep the control out until the value is shown (under
  its `loading` boundary, or `disabled={pending? x}`); the compiler flags a control that can guess while its value
  loads (`GUESS_WHILE_LOADING`). A control under the boundary is enough, even while a held `loading on(sel)` keeps
  it on screen. Don't skip a guess because `pending? x` reads `true` in the handler: it is also `true` while a
  refresh or another write's hold is out (R-9), and a guess skipped there leaves the row unchanged until the server
  answers.
- **Don't rebuild guesses by hand** (a plain list of pending ids with your own revert) to end them one by one: it
  loses the revert and the hold that keep the screen consistent.

### Data belongs with its lifetime

In .rx, state is not tied to components: a `source` can be declared in a module, a component or a region, and a
component only reads and calls what it is given. So give each value one lifetime, and declare it where that lifetime
is:

- **The app.** What every page shares and that outlives any one of them (the signed-in user, a setting the whole app
  reads): a module.
- **The visit.** What a page asks for, its stores and guesses, the writes made on it and their errors, and its
  inputs: declared in the page's component, asked when the page opens, gone when it closes. Opening the page again
  starts it as the app starts. A write still out when its page closes changes nothing on the next visit: the page
  asks the server again.
- **The screen.** What copies what is shown lives where it is shown, inside the region that shows it. A store a
  write guesses on is not screen state: a write can outlive the region it was made in (select another item and come
  back), so the store and its guesses live with the page, keyed by what they belong to, not in a region rebuilt on
  each selection.

So a page's lists and their actions are declared in the page component, not in a module, and a page that is not
open asks nothing. Don't move a page's data to a module with a counter that reloads it on each visit: the inputs,
errors and guesses of the last visit then show on the next.

- **A write whose answer is the new value** (a save that returns the saved settings) writes that answer and re-asks
  nothing.
- **A count in a tab** copies the rows on screen, so it is an `effect` in a component inside the list's region
  (`<OpenCount n={rows.length} … />` under the list's `loading`), not beside the list: outside the region it waits
  for every re-ask of the list and misses the guesses the rows already show.

## 4. Things that look like bugs and aren't

- **A plain write in an action doesn't show until the server answers.** That's the hold. Use `guess` or
  `onFlush` (the table above). Don't move the code into a plain handler to escape it.
- **A declined row guess stays until another action's re-ask lands.** While an action's `refresh` of the list is
  in flight, the list's rows wait for that action (H-11), declined guesses included. That's by design; see "When
  a guess holds" above.
- **A click waits for an action it has nothing to do with.** A plain write to a source an action in flight has
  written or guessed joins that action's hold (H-2): a click that clears the action's error waits for the
  server. Keep such a write off the action's sources, or make it an `onFlush` run.
- **A failure stays up while its retry is in flight.** That's H-12. To show `loading…` instead, put
  `loading on(k)` above the `errored`.
- **The server accepted, and the screen went back to the old value.** The action guessed on one question and
  refreshed another, or none. A guess ends with its action; only a new answer for the question it guessed on shows
  what the server took. Refresh every question you guessed on: a guess on one item's own question needs that
  question re-asked, not only the list's.

## 5. Plain handlers

A handler that writes and awaits is an action (AC-1b), so it never lands a write early by accident. A write before
its `await` is a compile error (`HELD_WRITE`), because it would wait for the server: make it `guess` if it shows
while the work runs, `onFlush` if it is a reset, or declare the action if it should wait. Plain handlers are for
local state: typing, toggles, selection.

A run never sees its own writes: after `x := v`, reading `x` in the same run gives the old value (W-4), and the
compiler refuses it (`STALE_OWN_READ`). Keep the value in a local: `let n = count + 1; count := n; log(n)`.

## 6. Effects: acting on a value as it changes

`effect (a, b) { … }` runs its block with the inputs' values as `$0`, `$1`. Prefer an equation for anything that is
a value; an effect is for sending a value somewhere else (a parent's `on…` handler, `log`, a JS module).

- **When it runs**: once when its component appears, then after any change in which an input's value differs from
  the value the block last received (EF-2). The same value again is not a change. It runs after everything has
  settled, against what is on screen, and its writes are a new change of their own.
- **Loading inputs**: an input that is loading (a first load, or a re-ask after its inputs changed) is pending, and
  the block does not run until the answer lands (R-2). The effect doesn't hold the screen while it waits.
- **Failing inputs**: while an input has failed, the block doesn't run (EF-2a). The failure shows in the region that
  reads it, not in the effect. The next answer runs the block again.
- **Guesses**: an input computed from a `guess` write fires as soon as the guess shows, and again with the old
  value if the guess reverts (EF-2). It doesn't wait for the action to end.
- **Lifetime**: an effect lives as long as its component. When the component goes away the effect stops, and its
  cleanup (a function the block returns) runs; nothing it would have seen later reaches it. State that must outlive
  a page belongs in a component that stays (pass it down, report changes up with an `on…` handler).
- **Order**: two effects that fire in the same change run in no promised order (EF-6).

## 7. Polling, a log, and a sound per message

A timer is a JS primitive (MO-10), declared once:

```rx
export pure fn createTicker(ms: number): ref number
```

`tick = createTicker(2000)` is an instantiation. It is a number that moves. Nothing else about time is in the language.

**Poll every n seconds.** An effect on the tick calls an action. The action does the fetch. The effect does not.

```rx
tick = createTicker(2000)
action poll() {
  try { status := await loadStatus() }
  catch (e) { status := e.message }
}
effect (tick) { poll() }
```

**Re-ask a question without a dummy argument.** A question re-asks when its inputs change (ST-5). Passing the tick into `whoIsHere(id, tick)` so the call changes is a dummy. `refresh` re-runs an `await` equation for the same inputs, quietly (AC-4): the last answer stays up.

```rx
tick = createTicker(5000)
here = await whoIsHere(boardId)
effect (tick) { refresh here }
```

**An append-only log with a cursor.** The log is a keyed source. This example
assumes the server returns all rows newer than the cursor, with a stable `seq`
and `id` on each row. Merge by id and sort by server sequence so overlapping
responses don't duplicate or reorder messages. Advance the cursor only forward.

```rx
source log: Message[] key id := []
source cursor := 0
action poll() {
  try {
    let r = await messagesSince(boardId, cursor)
    log := old => [...old.filter(m => !r.messages.some(n => n.id == m.id)), ...r.messages]
      .sort((a, b) => a.seq - b.seq)
    cursor := prev => prev > r.cursor ? prev : r.cursor
  } catch (e) { err := e.message }
}
effect (tick) { poll() }
```

**A sound, or any other effect, for each message in a burst.** Several messages handled in one turn are one change (W-3): the functional writes compose, and an effect runs once, after that change has settled (EF-2). `onFlush` and `onSettled` also run once for the change, not once per updater. Leave a record in the state as you reduce, and play the new records from an effect on the counter. The effect runs after the commit, against the store that is on screen.

In the `.rx` module:

```rx
import { fresh, reduce, play } from "./live"
source live := fresh()
action dispatch(m) {
  live := s => reduce(s, m)
}
effect (live.fxSeq) { play(live) }
```

In the JS module, `fresh` returns `{ fxSeq: 0, fx: [] }`. `reduce` applies the
message and appends `{ seq: ++s.fxSeq, message: m }` to `s.fx` in the same write.
`play` walks the committed records in sequence order and plays only those
after its last-played sequence. Keep that cursor per consumer, not in a JS
singleton shared by multiple instances. For a long-lived queue, drop records
only after they have been consumed.

In `live.d.rx`, declare the reducer as `export fn reduce(s: LiveState, m: Message): void`.
`reduce` mutates the draft it is given and nothing else. Declare it `fn`, not `pure fn`: a pure function must not mutate, and this one does. `fn` is io, so call it from the action, which is imperative. A `pure fn` here would be a lie so the call would type-check from reactive scope. It does not need to.

## 8. Forms

A draft seeded once from loaded data is a source in the form's component, seeded with `peek`:
`source name := peek(props.initial.name)`. It belongs to the user from then on; a save never resets it.
