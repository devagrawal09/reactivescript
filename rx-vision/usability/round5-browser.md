# Round 5 (browser / Map view): "Dispatch" — usability report

## Outcome
All 10 items work in the running app. `pnpm build`, `pnpm typecheck` and `pnpm test` (16 tests) pass. 25 `.rx` modules, 0 `.d.rx`.
Repo `rx-r5-browser`, 15 commits. Wall clock 04:22→05:07 (~45 min by the machine clock). About 12 build/typecheck
fix loops and about 45 Playwright driver runs. Gaps: only other agents' typing is shown (I don't send my own). The
RateLimited/retry boxes heal themselves early because the runtime re-asks once with no cause (finding F2 below).
Analytics is lazy at the module level only (the stats math is a dynamic-import chunk), since RX has no lazy component.

## Per item (time · tool helped? · HMR kept state? · time travel / Calls)
| # | item | time | tool | HMR | TT / Calls |
|---|---|---|---|---|---|
| 1 | Inbox (views, facets, search, sort, ∞ scroll, URL) | 15m + 15m dev-server blocker | yes: hover on `pageAns` showed the live answer | **no**: `limit` "not carried (value-mismatch)", and the Reload tab said so | – |
| 2 | Ticket (thread, notes, macros, uploads, optimistic send, retry) | 10m | no, it worked the first time | yes: draft, uploads and kind survived saves of Toasts.rx and Desk.rx | – |
| 3 | Assign/claim/status + Conflict merge prompt | 5m | no | – | – |
| 4 | SLAs (countdowns, soon, breached, toast once) | 5m (+3m toast-flood fix) | no; the console's WIDE_SCOPE_DEPS was more useful | – | – |
| 5 | Realtime (events poll, merge, typing, draft safe) | 3m | no | – | Calls showed each `poll` "called from effect" |
| 6 | ⌘K palette, keyboard only | 8m | no | – | – |
| 7 | Bulk (batches of 25, progress, partial failure, undo) | 5m | Calls: `RUN bulkApply` with its JS calls | – | – |
| 8 | Analytics (range, median FR, compliance, SVG) | 4m | no | – | – |
| 9 | Errors (NotFound, Forbidden, Conflict, RateLimited, retry, banner) | 15m | **yes, the big one**: Calls + travel found a rejection the screen never showed | yes (Desk.rx save: 21 reseeded, nothing lost) | travel to the REJECTED call showed `pageAns` red while the app showed old rows |
| 10 | Tests (SLA, draft merge, conflict, bulk partial + undo, macros, rate limit) | 6m | coverage report CLI listed untested paths | – | – |

## Top 5 RX language friction
1. No `instanceof`: telling errors apart means nested `try { try {…} catch (e: Conflict) {…} } catch (e) {…}`. It reads backwards.
2. JS habits that turned out to be parse or ASSIGNMENT errors, one build each: `new Date()`, `el.value = ""` on a DOM node,
   a bare `"text"` inside `{if c { … }}`, `on` as an arrow parameter, `for x, i in`. Each one needed a TS helper or a rewrite.
3. rx-tsc narrowing: `if (m != null)` does not narrow `T | undefined` (the checker treats `!=` like `!==`), while the
   emitted JS keeps `!= null`. I had to write `!== undefined`. A handler closure also loses narrowing of an equation
   (`ticket`), so I needed `let tk = ticket; if (tk == null) return`.
4. A statement-bodied closure passed to an `instantiates` primitive can't write (REACTIVE_WRITE_IN_OWNED_SCOPE). It must be a
   named `action`, and an action can't return the boolean the primitive wanted, so I redesigned the primitive.
5. Typed regions nest the wrong way without any warning: I put `errored (e)` inside `errored (e: RateLimited)`, so the
   typed region was dead. The compiler said nothing (no DEAD_TYPED_BOUNDARY). Only the map hinted, with "nothing read
   below awaits". Also, JSX entities (`&lt;`) print literally.

## Top 5 tool friction / wins
- WIN **Calls tab**: it showed `listTickets` REJECTED RateLimited ("change on select"), followed by OK "re-asked (no
  cause sent)". Without it I would never have known the rejection happened. Clicking the row travelled to that step,
  and `pageAns` was red on the map while the app showed old rows. Best tool moment of the round.
- WIN **Reload tab**: after saving Toasts.rx it showed "NOT CARRIED: limit (value-mismatch) · 18 reseeded · 44 kept". It named
  exactly why my 60-row inbox dropped back to 30. Saving Desk.rx showed "21 reseeded" and nothing lost, which matched the app.
- FRICTION **dev blocker (not the map)**: the dev server returned 500 on the entry because the RX vite front end
  `addWatchFile`s every *candidate* `x.d.rx` for each `.ts` import, even when none exists, and Vite can't resolve
  the missing file. The template didn't hit this because it still shipped `users.d.rx`. Worked around it with a 10-line
  `resolveId` plugin in vite.config.ts.
- FRICTION **getting to detail**: overview cards stay until ~60% zoom. Double-clicking a module card didn't fly in; it
  took ~12 wheel notches. A hovered token's tooltip sticks and covers the side panel. Reloading the ↗ pop-out blanks it
  (it's about:blank), so I had to pop out again. The Calls list is dominated by the 2 s `events` poll until you filter by
  function.
- FRICTION **Coverage overlay**: I found no way to load `.rx-coverage` in the devtools Map (only standalone pages built
  with coverage get the chip). I used `rx-map coverage report` instead: useful, but noisy ("no test changes W" for constants).

## 3 tool changes that would save the most time (ranked)
1. Surface a REJECTED call that never tripped any boundary as a map badge or toast ("rejection swallowed by re-ask").
   It took me Calls + travel to find, and an agent would never look.
2. Mark a typed `errored` region that a nearer untyped region shadows as dead, in the checker and on the map in words
   (instead of "nothing read below awaits").
3. Fix the dev-only missing-`.d.rx` watch (or make the template have no `.d.rx`, so it reproduces). Also: double-click
   a module card to fly to detail zoom, and a Coverage "load file" button in the devtools map.

## Generated declarations
Brands and defaults worked for every helper I used: `pure`, `pure(rejects([…]))`, `rejects` on io writes, `ref({result})`,
`ref({args,result})`, `instantiates`. I didn't want a `.d.rx` anywhere. One snag: the linked compiler changed mid-session
(rx-integ commits 04:26–04:43), so `pure(ref(…))`, which libraries.md showed when I started, became a DECLARATION_HELPER
error ("ref already makes it pure"). Each such error also turned the export io, so the build reported 6 IO_IN_REACTIVE
errors in `.rx` files that were only fallout. The map panel for `pageAns` said "declared by default (no helper)" even
though `listTickets` is wrapped in `pure(rejects([RateLimited], …))`. Either the label or the generator is wrong.

## Agents write, humans review: 3 hardest spots
1. `Desk.rx` `update`/`send` (nested typed try, guesses on two stores, `refresh` of both, `onFlush` resets). Correctness
   depends on hold rules (H-2, AC-1) you can't see in the text. Review help: a hover on each write that says
   "lands: now / with action / held by X".
2. Region nesting in Desk markup (typed vs untyped `errored`, `loading on(ticketId)`, palette under its own regions).
   Order matters and is silent. Review help: the checker flags shadowed typed regions, and the map shows each region's
   catch-set.
3. `source limit: number = firstLimit(qkey)` (a writable derived source used as "reset on query change"). It is
   idiomatic but opaque, and HMR can't carry it. Review help: a named form (`source limit := 30 resets on qkey`).

## Compare
Plain TS + Solid 2: RX saved real time on optimistic writes with automatic rollback, stale-answer dropping and the
compile-time UNGUARDED_SNAPSHOT catch. Every async feature worked the first time. RX cost time on JS habits (no
`new`/`instanceof`/DOM writes; small TS helpers needed) and on hold/region semantics I had to take on faith. Versus
round 4: much smoother. No `.d.rx`, helpers inferred types, HMR kept state across a big-component save, and Calls is a
genuinely new debugging capability.

**Biggest language win:** `guess` plus `refresh` on keyed answers. Optimistic assign/status/bulk/send with rollback was a few lines each.
**Biggest language blocker:** error-class dispatch (no `instanceof`, silently dead typed regions).
**Biggest tool win:** the Calls tab with click-to-travel. **Biggest tool blocker:** the dev-server 500 from missing `.d.rx` watches.
