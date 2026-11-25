# Usability round 2: "Tracker" (issue tracker)

Same setup as round 1 (ROUND1.md rules and report format), bigger app. Two agents build the same spec; one uses the
devtools Map view visually (browser), the other the RX MCP server. Each writes a usability report. Neither reads the
other's work or round-1 apps.

## App spec

An issue tracker in ReactiveScript (`.rx`), from the `with-reactivescript` template, against a fake server module
`src/server.ts` (all functions async, 150–700 ms latency; a `?chaos` URL flag makes ~1 in 3 calls reject).

1. **Projects sidebar**: projects from `listProjects()`; selecting one shows its issues. The selected project lives in
   the URL hash (`#/p/<id>` and `#/p/<id>/i/<issueId>`), and back/forward work.
2. **Issue list**: `listIssues(projectId, { page, status, q })` returns 20 per page with a total. Status filter
   (open / in progress / done / all), text search (debounced ~250 ms), pagination (prev/next, page n of m). Changing the
   filter or search resets to page 1. While a new page loads, the old one stays visible but dimmed (no blank flash).
3. **Issue detail** (right pane): title, status, assignee, description, and comments from `listComments(issueId)`
   (loaded separately; its own loading state, so the issue shows before its comments).
4. **Edit**: change status and assignee inline; optimistic in both the detail pane AND the list row; rolls back with an
   inline error if `updateIssue` rejects. Add a comment (optimistic, rolls back on failure).
5. **Create issue**: a small form; the new issue appears at the top of the list optimistically; when the server returns
   its real id, the row keeps its identity (no remount/flicker); rollback on failure.
6. **Counts**: per-project open-issue counts in the sidebar that stay correct after edits and creates (no refetch of
   everything).
7. **Errors**: a typed error for "not found" (`NotFound`, e.g. a bad issue id in the hash) shows a friendly message in
   the detail pane only; any other error shows a retry box at the nearest sensible boundary. The rest of the app keeps
   working.
8. **Live**: a "server activity" badge that polls `serverStats()` every 5 s and shows pending writes.
9. At least 5 `.rx` modules (e.g. `App.rx`, `Sidebar.rx`, `IssueList.rx`, `IssueDetail.rx`, `Comments.rx`).
10. A few vitest tests for the core flows (the template has vitest + jsdom).

Done = `pnpm build`, `pnpm typecheck`, `pnpm test` pass, and every item above verified in the running app.

## Report extras (on top of ROUND1.md)

- Per spec item: how long it took and whether the tool helped (yes / no / misled).
- One bug you hit that the tool found fastest, and one it should have found but didn't.
