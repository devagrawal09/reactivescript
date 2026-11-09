# History: the branches consolidated into `solid-model`

On 2026-11-09 all project work in `devagrawal09/reactivescript` was consolidated into one branch, `solid-model`. The
branches below were its sources. This file records each one's final SHA, its whole history
(`git log --format='%h %ad %s' --date=short`) and its parent relations, so that their provenance survives once the
branches are deleted. The PR #21 branches (`tsx-frontend-demo`, `pr21-v1-archive`, `pr21-v2-archive`), `main` and the
`claude/project-thread-*` branches were not part of the consolidation and are untouched.

## Where each folder came from

| Folder | Source | Base commit | Added on top, uncommitted until `solid-model` |
| --- | --- | --- | --- |
| `frontend/` | `tsx-frontend-workspace` | `7791984` | the plan fuzz, slice 3 (live evaluator) and slice 5 (SSR oracle) |
| `rust-solid/` | `rust-solid-slice1` | `4276aba` | the plan fuzz consumer (`plan-trace`), slice 3 (eval table) and slice 5 (server renderer) |
| `docs/` | `project-docs` | `f920b7b` | the `HANDOFF.md` update and `scratch/solid-rc21-issues.md` with its repros |
| `dashboard/` | `project-dashboard` | `41639f9` | a `notes.json` update |

`solid-model` starts at `tsx-frontend-workspace`'s `7791984`, so the frontend's history is `solid-model`'s own: its
first commit moves that tree into `frontend/` and adds the other three folders as files. The other branches' trees were
copied in without their histories.

## Ancestry

- **Ancestors of `solid-model`:** `tsx-frontend-workspace`, whole (`7791984` and its 32 ancestors, back to root
  `a8f0367`). Through it, the shared frontend history up to `fe650c1` that `tsx-frontend-slice1-like` and
  `tsx-frontend-slice1-plan` branch from.
- **Not ancestors of `solid-model`; once their branches are deleted these commits exist only as this record:**
  - `tsx-frontend-slice1-like`: `7285a1e`, `694e509`, `158bea5` (on `fe650c1`).
  - `tsx-frontend-slice1-plan`: `e8c6209`, `f315116` (on `fe650c1`).
    Both were merged locally as `56feaff` (parents `fe650c1`, `158bea5`, `f315116`; "Merge slice 1 (like scenario and
    checked plan) into frontend main"), which was never pushed. Their content reached `tsx-frontend-workspace` as part
    of `7791984`, an ordinary single-parent commit on `fe650c1`, so their commits are not in its history.
  - `rust-solid-main` and `rust-solid-slice1`: a separate history (root `39fdd1b`), all 12 commits. Its tree at
    `4276aba` is the base of `rust-solid/`.
  - `project-docs`: a separate history (root `a55586c`), both commits. Its tree is the base of `docs/`.
  - `project-dashboard`: a separate history (root `2465dc9`), all 6 commits. Its tree is the base of `dashboard/`.
- **Is `rust-solid-main` (`4a1090c`) an ancestor of `rust-solid-slice1` (`4276aba`)?** Yes:
  `git merge-base --is-ancestor 4a1090c 4276aba` succeeds and their merge base is `4a1090c`. `rust-solid-slice1` is
  `rust-solid-main` plus five commits (`3911d2e`, `2752ca0`, `012b5de`, `147d971`, `4276aba`), so the
  `rust-solid-slice1` log below contains all of `rust-solid-main`'s.
- The frontend branches' root `a8f0367`, the Rust root `39fdd1b`, the docs root `a55586c` and the dashboard root
  `2465dc9` are not in `main` (upstream ReactiveScript) or in `tsx-frontend-demo`.

## The branches

### `tsx-frontend-workspace`

- Final SHA: `779198455f4c7ba3087aa7b96cf1d133552f9868` (`7791984`), 33 commits, root `a8f0367`.
- Merge commits: `fe650c1` (parents `df533b5`, `6fb8ea8`).
- Ancestor of `solid-model`: yes, its whole history is in `solid-model`.

```
7791984 2026-11-08 feat: merge slice 1 and add slice-2 tracker scenario
fe650c1 2026-11-06 Merge frontend main with plain-handler yield events
df533b5 2026-11-06 Document the reduced subset and measured repin results
84099fa 2026-11-06 Shrink TSX to the verified subset and repin clean upstream
6fb8ea8 2026-11-06 Lower yield events to plain handlers and let RX infer actions
202bf7f 2026-11-06 docs: YIELD.md reduced to the mapping, the refusals and the open questions
0dd62e0 2026-11-06 Yield: lower directly to the RX AST and drop the solid-yield dependency
7e43873 2026-11-06 docs/YIELD.md: the yield frontend spike — solid-yield fcc100e on Solid rc.20, mapping, gaps, P/E/W/R
5f47623 2026-11-06 Yield: refuse source reads after an attempt inside an event
23a8148 2026-11-06 Yield paired evidence: counter and tracker in solid-yield syntax, five legs, refusal matrix
230e8a7 2026-11-06 Yield frontend spike: solid-yield's explicit generator dialect translated to Solid TSX, then lowered to RX
f15636c 2026-10-31 Differential fuzzer, milestone 1: paired TSX/RX generator, five-leg runner, classifier, reducer
472bbb3 2026-10-31 Tracker demo: findIndex lookup and an optimistic list copy as the claim
870803f 2026-10-31 Refuse async callbacks whatever their name (issue #20)
1f12400 2026-10-31 STALE_WRITE_BACK through authored TSX: lost update shown natively, refused by the frontend, fixed form verified
51ccf48 2026-10-31 Repin to reactivescript 8518fa1e and Solid 5e68925c (rc.20)
014854e 2026-10-29 Issue-tracker demo across all backends; measured results updated
2514d94 2026-10-29 Refuse ordinary async callbacks in TSX pending issue #20; require explicit generator actions
022e359 2026-10-29 Solid-parity subset checkpoint: verify:subset, composition tests moved out of lower.test.ts
dbbb08f 2026-10-28 docs: final measured results and failure classification at pin + 0001
31ca133 2026-10-28 Refusal of structured untrack captures only where an in-place update can reach them; docs: upstream issues, patch queue, verifier modes
d2529f5 2026-10-28 Patch queue 0001 (server question keys) with patched worktree tooling; narrowed authored refusal for structured store untrack; test migrations for SF-1/IO-2; restored features fragment
c031a7f 2026-10-28 async-handlers: register every backend leg; explicit AC-1b refusal proofs for pre-await writes; scenario-API coverage on the supported spelling
d5b83cb 2026-10-28 Truthful verification: recorded exit codes, readiness vs comparison modes, coverage manifest, unapproved observation, verifier tests; port serverFn tests to serverRef/serverCall
6ef9593 2026-10-28 docs: record executed full canary rehearsal
4127261 2026-10-28 docs: measured results, coverage reconciliation and failure classification at the pins
0c7971d 2026-10-28 Finish MO-1c migration of handwritten RX test entries; docs (README, PATCHES, UPSTREAM-ISSUES); classifier categories
01313b2 2026-10-28 Restore coverage: ErrVal/PENDING adapter exports, remaining MO-1c RX entries in async-handlers/features, interpreter runner tally; relax inferred-action refusal to pre-await writes
66d9a12 2026-10-28 Browser-safe failure adapter; docs for upstream issues and patch policy; lower.test updates for MO-1c and AC-1b decisions
f04f255 2026-10-28 Upgrade workflow: pins, contracts, reporter/classifier, verify-pinned and canary; migrate RX test entries to MO-1c; facts-based pairing
a6a8932 2026-10-28 Milestone 1: default-component entry, inferred-action refusal, semantic facts, paired TSX/RX counter
c2dd64d 2026-10-28 Separate package: route upstream imports through tsx/rx adapter, own lockfile, unified server decl
a8f0367 2026-10-28 Import original TSX frontend verbatim from reactivescript proto/sound-tsx-frontend@f3c6771 (uncommitted worktree)
```

### `tsx-frontend-slice1-like`

- Final SHA: `158bea599477a18bfca8671ea7cbb50f400e45ab` (`158bea5`), 35 commits, root `a8f0367`.
- Merge commits: `fe650c1` (parents `df533b5`, `6fb8ea8`).
- Ancestor of `solid-model`: no; 3 of its 35 commits are not reachable from `solid-model`.

```
158bea5 2026-11-06 Gate like parity and convert upstream S-infer-1 to neutral steps
694e509 2026-11-06 Run like fixtures through fresh-call JS hosts on all frontends
7285a1e 2026-11-06 Define neutral like scenario and exact text frames
fe650c1 2026-11-06 Merge frontend main with plain-handler yield events
df533b5 2026-11-06 Document the reduced subset and measured repin results
84099fa 2026-11-06 Shrink TSX to the verified subset and repin clean upstream
6fb8ea8 2026-11-06 Lower yield events to plain handlers and let RX infer actions
202bf7f 2026-11-06 docs: YIELD.md reduced to the mapping, the refusals and the open questions
0dd62e0 2026-11-06 Yield: lower directly to the RX AST and drop the solid-yield dependency
7e43873 2026-11-06 docs/YIELD.md: the yield frontend spike — solid-yield fcc100e on Solid rc.20, mapping, gaps, P/E/W/R
5f47623 2026-11-06 Yield: refuse source reads after an attempt inside an event
23a8148 2026-11-06 Yield paired evidence: counter and tracker in solid-yield syntax, five legs, refusal matrix
230e8a7 2026-11-06 Yield frontend spike: solid-yield's explicit generator dialect translated to Solid TSX, then lowered to RX
f15636c 2026-10-31 Differential fuzzer, milestone 1: paired TSX/RX generator, five-leg runner, classifier, reducer
472bbb3 2026-10-31 Tracker demo: findIndex lookup and an optimistic list copy as the claim
870803f 2026-10-31 Refuse async callbacks whatever their name (issue #20)
1f12400 2026-10-31 STALE_WRITE_BACK through authored TSX: lost update shown natively, refused by the frontend, fixed form verified
51ccf48 2026-10-31 Repin to reactivescript 8518fa1e and Solid 5e68925c (rc.20)
014854e 2026-10-29 Issue-tracker demo across all backends; measured results updated
2514d94 2026-10-29 Refuse ordinary async callbacks in TSX pending issue #20; require explicit generator actions
022e359 2026-10-29 Solid-parity subset checkpoint: verify:subset, composition tests moved out of lower.test.ts
dbbb08f 2026-10-28 docs: final measured results and failure classification at pin + 0001
31ca133 2026-10-28 Refusal of structured untrack captures only where an in-place update can reach them; docs: upstream issues, patch queue, verifier modes
d2529f5 2026-10-28 Patch queue 0001 (server question keys) with patched worktree tooling; narrowed authored refusal for structured store untrack; test migrations for SF-1/IO-2; restored features fragment
c031a7f 2026-10-28 async-handlers: register every backend leg; explicit AC-1b refusal proofs for pre-await writes; scenario-API coverage on the supported spelling
d5b83cb 2026-10-28 Truthful verification: recorded exit codes, readiness vs comparison modes, coverage manifest, unapproved observation, verifier tests; port serverFn tests to serverRef/serverCall
6ef9593 2026-10-28 docs: record executed full canary rehearsal
4127261 2026-10-28 docs: measured results, coverage reconciliation and failure classification at the pins
0c7971d 2026-10-28 Finish MO-1c migration of handwritten RX test entries; docs (README, PATCHES, UPSTREAM-ISSUES); classifier categories
01313b2 2026-10-28 Restore coverage: ErrVal/PENDING adapter exports, remaining MO-1c RX entries in async-handlers/features, interpreter runner tally; relax inferred-action refusal to pre-await writes
66d9a12 2026-10-28 Browser-safe failure adapter; docs for upstream issues and patch policy; lower.test updates for MO-1c and AC-1b decisions
f04f255 2026-10-28 Upgrade workflow: pins, contracts, reporter/classifier, verify-pinned and canary; migrate RX test entries to MO-1c; facts-based pairing
a6a8932 2026-10-28 Milestone 1: default-component entry, inferred-action refusal, semantic facts, paired TSX/RX counter
c2dd64d 2026-10-28 Separate package: route upstream imports through tsx/rx adapter, own lockfile, unified server decl
a8f0367 2026-10-28 Import original TSX frontend verbatim from reactivescript proto/sound-tsx-frontend@f3c6771 (uncommitted worktree)
```

### `tsx-frontend-slice1-plan`

- Final SHA: `f315116c771bc37ccf5d154ac20d4788fe758d8c` (`f315116`), 34 commits, root `a8f0367`.
- Merge commits: `fe650c1` (parents `df533b5`, `6fb8ea8`).
- Ancestor of `solid-model`: no; 2 of its 34 commits are not reachable from `solid-model`.

```
f315116 2026-11-06 Require resolved text readers and record the type-check boundary
e8c6209 2026-11-06 Emit a small checked RX plan and test three-frontend Rust frames
fe650c1 2026-11-06 Merge frontend main with plain-handler yield events
df533b5 2026-11-06 Document the reduced subset and measured repin results
84099fa 2026-11-06 Shrink TSX to the verified subset and repin clean upstream
6fb8ea8 2026-11-06 Lower yield events to plain handlers and let RX infer actions
202bf7f 2026-11-06 docs: YIELD.md reduced to the mapping, the refusals and the open questions
0dd62e0 2026-11-06 Yield: lower directly to the RX AST and drop the solid-yield dependency
7e43873 2026-11-06 docs/YIELD.md: the yield frontend spike — solid-yield fcc100e on Solid rc.20, mapping, gaps, P/E/W/R
5f47623 2026-11-06 Yield: refuse source reads after an attempt inside an event
23a8148 2026-11-06 Yield paired evidence: counter and tracker in solid-yield syntax, five legs, refusal matrix
230e8a7 2026-11-06 Yield frontend spike: solid-yield's explicit generator dialect translated to Solid TSX, then lowered to RX
f15636c 2026-10-31 Differential fuzzer, milestone 1: paired TSX/RX generator, five-leg runner, classifier, reducer
472bbb3 2026-10-31 Tracker demo: findIndex lookup and an optimistic list copy as the claim
870803f 2026-10-31 Refuse async callbacks whatever their name (issue #20)
1f12400 2026-10-31 STALE_WRITE_BACK through authored TSX: lost update shown natively, refused by the frontend, fixed form verified
51ccf48 2026-10-31 Repin to reactivescript 8518fa1e and Solid 5e68925c (rc.20)
014854e 2026-10-29 Issue-tracker demo across all backends; measured results updated
2514d94 2026-10-29 Refuse ordinary async callbacks in TSX pending issue #20; require explicit generator actions
022e359 2026-10-29 Solid-parity subset checkpoint: verify:subset, composition tests moved out of lower.test.ts
dbbb08f 2026-10-28 docs: final measured results and failure classification at pin + 0001
31ca133 2026-10-28 Refusal of structured untrack captures only where an in-place update can reach them; docs: upstream issues, patch queue, verifier modes
d2529f5 2026-10-28 Patch queue 0001 (server question keys) with patched worktree tooling; narrowed authored refusal for structured store untrack; test migrations for SF-1/IO-2; restored features fragment
c031a7f 2026-10-28 async-handlers: register every backend leg; explicit AC-1b refusal proofs for pre-await writes; scenario-API coverage on the supported spelling
d5b83cb 2026-10-28 Truthful verification: recorded exit codes, readiness vs comparison modes, coverage manifest, unapproved observation, verifier tests; port serverFn tests to serverRef/serverCall
6ef9593 2026-10-28 docs: record executed full canary rehearsal
4127261 2026-10-28 docs: measured results, coverage reconciliation and failure classification at the pins
0c7971d 2026-10-28 Finish MO-1c migration of handwritten RX test entries; docs (README, PATCHES, UPSTREAM-ISSUES); classifier categories
01313b2 2026-10-28 Restore coverage: ErrVal/PENDING adapter exports, remaining MO-1c RX entries in async-handlers/features, interpreter runner tally; relax inferred-action refusal to pre-await writes
66d9a12 2026-10-28 Browser-safe failure adapter; docs for upstream issues and patch policy; lower.test updates for MO-1c and AC-1b decisions
f04f255 2026-10-28 Upgrade workflow: pins, contracts, reporter/classifier, verify-pinned and canary; migrate RX test entries to MO-1c; facts-based pairing
a6a8932 2026-10-28 Milestone 1: default-component entry, inferred-action refusal, semantic facts, paired TSX/RX counter
c2dd64d 2026-10-28 Separate package: route upstream imports through tsx/rx adapter, own lockfile, unified server decl
a8f0367 2026-10-28 Import original TSX frontend verbatim from reactivescript proto/sound-tsx-frontend@f3c6771 (uncommitted worktree)
```

### `rust-solid-main`

- Final SHA: `4a1090ceaf4e61d201206630fab6bd732b0e1b25` (`4a1090c`), 7 commits, root `39fdd1b`.
- No merge commits; a single line of history.
- Ancestor of `solid-model`: no; 7 of its 7 commits are not reachable from `solid-model`.

```
4a1090c 2026-11-06 Record isolated 2000-seed results, verified repros and incomplete M1 status
d1f17ba 2026-11-06 Isolate every oracle program after a fresh-replay check exposed shared state
1dbeb4a 2026-11-06 Fix promise identity, visible errors and idle lazy scheduling; preserve baseline repros
96131da 2026-11-06 Add height ordering, queued flight continuations, tests and timeout-safe oracle
8bfa86b 2026-11-06 Match status propagation, queued refresh, effect cleanup and lazy release
8197633 2026-11-06 Add shared JSON drivers, seeded generation, shrinking and coverage
39fdd1b 2026-11-06 Start Rc graph, explicit flush, flights and action coroutine spike
```

### `rust-solid-slice1`

- Final SHA: `4276abae0a183143b478bb9a456f972022e1746f` (`4276aba`), 12 commits, root `39fdd1b`.
- No merge commits; a single line of history.
- Ancestor of `solid-model`: no; 12 of its 12 commits are not reachable from `solid-model`.

```
4276aba 2026-11-08 feat(runtime): async, stores, lists, universal renderer, tracker
147d971 2026-11-07 Port Solid's scheduler paths for slice 1; exact-trace fuzz 1000/1000
012b5de 2026-11-06 Record 1000-seed slice results and class-preserving reduced failures
2752ca0 2026-11-06 Match held-write equality ordering and preserve fuzz failure classes
3911d2e 2026-11-06 Run checked like plans through scalar action lanes and text rendering
4a1090c 2026-11-06 Record isolated 2000-seed results, verified repros and incomplete M1 status
d1f17ba 2026-11-06 Isolate every oracle program after a fresh-replay check exposed shared state
1dbeb4a 2026-11-06 Fix promise identity, visible errors and idle lazy scheduling; preserve baseline repros
96131da 2026-11-06 Add height ordering, queued flight continuations, tests and timeout-safe oracle
8bfa86b 2026-11-06 Match status propagation, queued refresh, effect cleanup and lazy release
8197633 2026-11-06 Add shared JSON drivers, seeded generation, shrinking and coverage
39fdd1b 2026-11-06 Start Rc graph, explicit flush, flights and action coroutine spike
```

### `project-docs`

- Final SHA: `f920b7bfa46c31d5694056a03f73491417d5ba54` (`f920b7b`), 2 commits, root `a55586c`.
- No merge commits; a single line of history.
- Ancestor of `solid-model`: no; 2 of its 2 commits are not reachable from `solid-model`.

```
f920b7b 2026-11-08 docs(handoff): slice-2 tracker state and 2026-11-08 pushes
a55586c 2026-11-07 Project handoff and research notes
```

### `project-dashboard`

- Final SHA: `41639f98203d5996b21f05a692a401625758aba9` (`41639f9`), 6 commits, root `2465dc9`.
- No merge commits; a single line of history.
- Ancestor of `solid-model`: no; 6 of its 6 commits are not reachable from `solid-model`.

```
41639f9 2026-11-08 chore(dashboard): update notes for slice-2 tracker gate
8c9d175 2026-11-07 notes: slice 1 result and pending decision
a32ed43 2026-11-07 Run gates in clean worktrees with cached output
f60af5d 2026-11-07 Add read-only local project dashboard
bf57dfe 2026-11-06 Add read-only local project dashboard
2465dc9 2026-11-06 Add read-only local project dashboard
```
