# Usability round 1: "Shelf" (reading list)

Two agents build the same app from the same spec. One uses the devtools Map view visually (browser), the other uses the
RX MCP server. Each writes a usability report. Neither reads the other's work.

## App spec (both)

A reading list in ReactiveScript (`.rx`), from the `with-reactivescript` template.

1. A list of books (title, author, read: bool) loaded from a fake server module (`src/api.ts`: `load()` resolves after
   600 ms; `save(book)` resolves after 400 ms and rejects ~1 in 4 times with an `Error("save failed")`).
2. Add a book (title + author inputs, Add button). The new book shows right away (optimistic) and rolls back if save
   fails, with a visible error message.
3. Toggle read/unread per book, also saved through `save`.
4. Filter chips: all / unread / read, and a search box (title or author, case-insensitive).
5. A header with counts: total, unread.
6. A loading state for the first load and an errored state with a retry button if `load()` fails
   (make `load()` fail when the URL has `?fail`).
7. At least 2 `.rx` modules (e.g. `App.rx` + `components/Book.rx`).

Done = `pnpm build` passes, `rx-tsc --noEmit` (pnpm typecheck) passes, and every item above verified in the running app.

## Rules

- Learn RX from `<workspace>/reactivescript/guide/*.md` and `examples/`. Don't edit the compiler, runtime or tooling.
- Use your assigned tool for understanding and debugging whenever it could help, and note every time it helped, was
  useless, confused you, or was missing something you wanted.
- Report (markdown, ≤ 60 lines) to the given path:
  - outcome (what works, what doesn't), time spent, rough count of build/debug iterations;
  - top 5 friction points with the RX language itself;
  - top 5 friction points / wins with the tool, each with a concrete moment;
  - the 3 tool changes that would have saved the most time, ranked.
