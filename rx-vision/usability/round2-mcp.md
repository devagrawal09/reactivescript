# Round 2 — Tracker / RX MCP

**Outcome:** Tracker works on port 3112. `pnpm build`, `pnpm typecheck`, and `pnpm test` (3/3) pass. Verified the main flows in headless Chromium, including all three write rollbacks under `?chaos`. The fake database resets on reload; the badge samples rather than tracking every short write. Three local commits (`333d1e4`, `e957d93`, `bb05887`); no tooling changes or pushes. ~22 minutes wall time including the interruption, ~16 build/debug iterations.

## Spec coverage (approx. hands-on time, overlapping)
| # | Time | MCP helped? | Result |
|---|---:|---|---|
| 1 | 2m | No | Atlas/Beacon/Relay, hash selection, Back and Forward verified in Chromium. |
| 2 | 3m | Yes | 20 rows/page, status and case-insensitive search reset page; old rows dim without blanking. `node`/`reach` confirmed the query/probe wiring. |
| 3 | 2m | Yes | Detail appeared while comments were loading; `tail` confirmed separate flights. |
| 4 | 5m | Yes | Status/assignee showed in both panes before save; comments appeared immediately. Edit and comment reverted with inline errors in chaos. `tail` exposed the comments restart. |
| 5 | 2m | Yes | Draft at top; same actual `<li>` when `/i/400` replaced the placeholder, including a create from page 2. Chaos removed the failed draft. `state` distinguished revert from supersede. |
| 6 | 2m | Yes | Open count followed edit/create and rollback; write reply includes the authoritative count, without reloading projects. `check` caught stale capture; `why` showed count and row in the same flush. |
| 7 | 2m | Yes | Bad issue hash showed the typed detail-only message; list stayed usable. Verified an activity retry under chaos; `boundary(key)` explained the typed route but didn't diagnose the quiet-refresh failure. |
| 8 | 2m | Misled | 5 s polling; observed 0 → 1 → 0 around a timed create. `tail` proved polling; `value` reported `(no value)` for a badge visibly showing a number. |
| 9 | 1m | Yes | Seven app `.rx` modules; `overview` listed modules/boundaries but also listed unused template modules. |
| 10 | 2m | No | Vitest: stale pagination/search reset, stable create node, and isolated typed error. Fixed an initial debounce that could reset the first page flip in jsdom. |

## Five language friction points
1. “TypeScript expressions” did not cover computed object keys, `as` in a call, or a newline before `.map` (even in parentheses). Moved keyed updates to TS helpers, narrowed select values explicitly, split the chain.
2. `ref` fixed `SNAPSHOT_ARGUMENT`, then made inline calls hit `INSTANTIATION_NOT_BOUND`. Inline count equation and a pure JS merge helper were simpler than the first RX functions.
3. The reference says guesses on `:=` sources can land against plain writes; `rx-tsc` emitted `GUESS_NO_QUESTION`. Using `source x = seed` worked. `STALE_CAPTURE` also rejected the derived delta, then the primitive `before` parameter despite recommending plain arguments; returning the count from the mutation fixed both semantics and the check.
4. Foreign declarations duplicate TS types; generic `fn` and non-exported aliases failed in `.d.rx`, and `rejects(A, B)` needed `rejects(A | B)`. `Number`/`Math` needed JS helpers; a two-arg timer callback declaration produced a confusing TS projection error at `5000`.
5. Reactive props can couple unrelated requests: `Comments id={issue.id}` re-asked comments on edits despite the ID being unchanged, holding the optimism; sourcing it from `props.id` fixed it. `pending?` via an equation outside the list's Loading also produced a runtime warning with a clean static check; moving the form inside fixed it.

## Five MCP wins/frictions and call notes
1. **`check`:** baseline and final `ok`; parser iterations pinpointed newline `.map`, computed keys, generic/private `.d.rx`, rejection syntax, and cast (one response wrapped in raw `content` JSON). Then named `SNAPSHOT_ARGUMENT`, `UNBOUND Number`, `INSTANTIATION_NOT_BOUND`, `STALE_CAPTURE`; the first `INSTANTIATION_NOT_BOUND` run didn't print the `GUESS_NO_QUESTION` batch `rx-tsc` showed. Usually ~1 s; observed ~10–25 s outliers. It did not catch the runtime Loading warning.
2. **Static map:** `--list` gave usable schemas; `overview` gave module order but included the disconnected starter files. `find(answer)` disambiguated list vs. detail; `node(answer)` showed dependencies and write-side refreshes, `node(loadingPage)` showed CreateForm's disabled reader, and `reach(debounced,down,3)` showed the path to list readers. `boundary()` enumerated regions; keyed `boundary` identified detail's answer. `diff(HEAD)` mostly enumerated the initial additions. `find`/`boundary` on a broken program simply bounced me back to `check`.
3. **Fastest find:** `tail` first showed detail land, then comments start; after edits, `tail(since=67,limit=18)` showed comments re-starting and edit-related state landing alongside comments. `why(edits)` and `why(answer)` showed row/count/detail in the same flush; changing the comments prop took the edit from >500 ms to ~8 ms in the browser.
4. **Live evidence:** `live_status` correctly explained the missing page, then showed one page; early `state` still said `no live state` after four flushes. Later unkeyed `state` showed chaos errors plus `reverted`/`superseded`; keyed `state(edits)` could be `(no value)` before any edit. `value(counts)` confirmed `{atlas: 23}`. `pending` returned no requests; ~1–3 s per process often missed 150–700 ms flights. Some static/live calls timed out (~8–10 s caps or harness timeout), then worked on retry.
5. **Missed bug:** With `refresh stats`, clicking Retry activity could leave the error visible even after a successful flight. `tail` showed abandon/land and anonymous `{}` boundary records, but not which boundary remained open or why; `why(stats)` said no change recorded and `value(stats)` gave `(no value)`. A reactive poll counter instead of repeated quiet refresh recovered on explicit retry. No claim about the runtime root cause.

## Three tool changes, ranked
1. Trace actual hold and recovery causes: show action → changed prop → comments flight → held readers, and name the boundary with its previous/current error and what happened on retry.
2. Keep an MCP session warm and offer a start/stop recording around a user gesture, with a semantic-only event filter. Today startup can outlast a flight, and `tail` floods with anonymous records from a single flush.
3. Make `check` include the same diagnostic batch and TS projection errors as `rx-tsc`; distinguish “unobserved” from actual empty state/value, and return one consistent error format.
