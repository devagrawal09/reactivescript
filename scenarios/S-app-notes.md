# S-app-notes — a notes app over four modules: server functions, routing, an editor, styles, a client question

Rules exercised: SF-1–SF-6, SV-7b, CSS-1–CSS-4, TY-1–TY-4, MO-1, MO-2a, MO-6c, RG-1, RG-6, ST-4, ST-5, H-5, H-6, H-12, AC-1, AC-3, AC-4, AC-7, E-4, R-f-4, R-f-5, R-f-6.

## Program

file: ../examples/notes/main.rx

The app and what writing it found: `examples/notes/NOTES.md`.

## Frames

| instant | action | frame |
| ------- | ------ | ----- |
| 0 | mount | `widesearching…` |
| 1 | resolve "dbNotes:" [{"id":1,"title":"Groceries","body":"eggs","updated":"10-01","owner":"ann"},{"id":2,"title":"Ideas","body":"lang","updated":"10-20","owner":"ann"}] | `wideGroceries10-01Ideas10-20` |
| 2 | handler `search("idea")` | `widesearching…` |
| 3 | resolve "dbNotes:idea" [{"id":2,"title":"Ideas","body":"lang","updated":"10-20","owner":"ann"}] | `wideIdeas10-20` |
| 4 | handler `open(2)` | `backwideopening…` |
| 5 | resolve "dbNote:2" {"id":2,"title":"Ideas","body":"lang","updated":"10-20","owner":"ann"} | `backwidesave` |
| 6 | handler `title := ""` | `backwidea note needs a titlesave` |
| 7 | handler `title := "Ideas2"` | `backwidesave` |
| 8 | handler `save(2, "Ideas2", "lang")` | `backwidesave` |
| 9 | reject "dbSave:2,Ideas2,lang" Conflict("rev 7") | `backwidesomeone else saved first: rev 7save` |
| 10 | handler `back()` | `wideIdeas10-20` |
| 11 | resolve "viewport:" 500 | `narrowIdeas10-20` |


- 0: `width` is a client question with a first paint (SV-7b): `wide` until the browser answers. `notes` is pending under an armed `loading on(query)` (H-5).
- 2–3: a new `query` re-asks `listNotes` (a question over a server fn, SF-2b) and re-arms the boundary (H-6).
- 4–5: `open(2)` changes `route`; the other branch is fresh (RG-1a) and its `loading` takes `current` until `getNote(2)` lands. The editor's drafts are snapshots of the note (E-4).
- 6–7: the drafts are the editor's own sources; `problem` follows `title`.
- 8: `save` guesses the list (AC-3) — not on screen — and awaits `saveNote`, an io server fn called from an action (SF-2c).
- 9: `Conflict` is declared in `api.d.rx`, so it crosses as itself (SV-5a) and the inner typed catch takes it (AC-7).
- 10: the action ended without a save: the guess is gone (AC-1), and the list shows what the server has.
- 11: the browser answers the client question; the layout follows.
