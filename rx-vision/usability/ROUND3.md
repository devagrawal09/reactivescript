# Usability round 3: "Crew" (team board + chat)

Same rules and report format as ROUND1.md/ROUND2.md. Bigger app, more async interplay. Tools improved since round 2:
current state on open (values, errors, held writes, tripped boundaries), real time travel (timeline), warm MCP over HTTP
with `record`, cause chains in `why`, boundary history, `check` = build diagnostics, a layered map with an overview,
view-text strips, and the language fixes (TS expressions, `as`, .d.rx generics, narrowing, STYLE_SCOPE…).

## App spec

A team workspace against a fake server `src/server.ts` (150–900 ms latency; `?chaos` → ~1 in 3 calls reject; `?slow`
→ ×4 latency). At least 10 `.rx` modules.

1. **Boards**: list of boards (sidebar), each with columns and cards. Hash routing `#/b/<id>` and `#/b/<id>/c/<cardId>`.
2. **Cards**: create, edit title/description, assign members, labels; move a card between columns and reorder within a
   column (buttons or keyboard are fine; drag-and-drop optional) — all optimistic with rollback and an inline error.
3. **Card drawer**: card details + activity log loaded separately; comments with optimistic add; @mentions autocomplete
   from members (debounced search).
4. **Chat**: a per-board chat pane that polls `messagesSince(boardId, cursor)` every 2 s, appends new messages without
   refetching all, keeps scroll position, shows "n new" when scrolled up; sending is optimistic with retry on failure.
5. **Presence**: `whoIsHere(boardId)` polled every 5 s; avatars in the header; stale presence fades.
6. **Undo**: the last 5 card moves/edits can be undone (server call `revert(opId)`), optimistic.
7. **Filters**: by member/label/text across the board, reflected in the URL query; counts per column stay right.
8. **Errors**: typed `NotFound` for a bad board/card id (friendly page), `Forbidden` for a locked board (read-only
   banner, editing disabled), any other error → a retry box at the nearest sensible boundary. The rest keeps working.
9. **Offline-ish**: when 3 calls in a row fail, show a "connection trouble" banner; it clears on the next success.
10. **Tests**: vitest tests for the move/rollback, chat append, undo, and the typed errors.

Done = `pnpm build`, `pnpm typecheck`, `pnpm test` pass and every item verified in the running app.

## Report extras

- Per spec item: time, tool helped (yes/no/misled), and for the browser tester: did time travel help? For the MCP
  tester: did `record`/`why` help?
- The single biggest RX language win and the single biggest RX language blocker you hit.
