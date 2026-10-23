# 99 — Diagnostics, binned

**Status: DRAFT.** Solid 2.0's diagnostic table
(`documentation/solid-2.0/08-dev-diagnostics.md`, quick reference) with each
code assigned to one bin. The first bin is the grammar; the second is the
checker; the third stays runtime attribution. Codes keep Solid's names so a
compile-time error and the dev-mode runtime error mean the same thing.

Bins:

- **U — Unwritable.** The grammar has no position for the program. Parse or
  scope error. Cites the rule that removes the position.
- **S — Static.** A query over the static graph (inputs, regions, lanes).
  Compile error or warning.
- **R — Runtime.** Timing, data-dependent, or cross-module-dynamic. Stays in
  the runtime's attribution engine unchanged.
- **S/R** — static within a module, runtime across component boundaries where
  the edge is dynamic (a prop getter, `dynamic()`).

| Code                              | Bin | Rule / note                                                        |
| --------------------------------- | --- | ------------------------------------------------------------------ |
| `REACTIVE_WRITE_IN_OWNED_SCOPE`   | U   | W-2: reactive scope has no statement position                      |
| `ACTION_CALLED_IN_OWNED_SCOPE`    | S   | R-io-3: an action called in reactive scope (an io import: `IO_IN_REACTIVE`) |
| `IO_IN_FN` (new)                  | S   | R-io-2: a `fn` body that is `io`                                   |
| `ASYNC_STORE_SETTER`              | U   | ST: a draft block is synchronous by grammar                        |
| `STRICT_READ_UNTRACKED`           | U   | E-4/E-5: the only snapshots are initializers and `peek`            |
| `UNTRACKED_READ_AFTER_AWAIT`      | U   | R-pending: inputs are static; no tracking window                   |
| `PENDING_ASYNC_UNTRACKED_READ`    | U   | R-pending: a pending value cannot be read in imperative scope without `peek`/`latest` |
| `PENDING_ASYNC_FORBIDDEN_SCOPE`   | U   | same                                                               |
| `PRIMITIVE_IN_FORBIDDEN_SCOPE`    | U   | SC-2: declarations do not occur in imperative scope                |
| `PRIMITIVE_IN_EFFECT_CALLBACK`    | U   | same                                                               |
| `CLEANUP_IN_FORBIDDEN_SCOPE`      | U   | EF-5: cleanup is the apply block's return                          |
| `MISSING_EFFECT_FN`               | U   | EF-1: an effect is two halves by grammar                           |
| `SYNC_NODE_RECEIVED_ASYNC`        | U   | R-pending: the row says                                            |
| `FLUSH_IN_EFFECT_CALLBACK`        | U   | W-3: no API to split an instant                                    |
| `NO_OWNER_EFFECT`                 | U   | O: every declaration has a region                                  |
| `NO_OWNER_CLEANUP`                | U   | same                                                               |
| `NO_OWNER_BOUNDARY`               | U   | same                                                               |
| `RUN_WITH_DISPOSED_OWNER`         | S   | O-3: its static form is `REGION_ESCAPE`; the runtime error stays the JS-boundary backstop (CN-3b) |
| `SETTLED_CLEANUP_UNOWNED`         | U   | EF-4/EF-5 with O                                                   |
| `SNAPSHOT_ARGUMENT` (new)         | S   | E-10: reactive argument to a value parameter at an instantiation       |
| `SNAPSHOT_INITIALIZER` (new)      | S   | E-4 / DV-6: a source initializer reads a reactive value outside `peek(…)` |
| `INVALID_REFRESH_TARGET`          | S   | `refresh` requires a source with a question (V-9)                  |
| `INVALID_AFFECTS_TARGET`          | S   | same                                                               |
| `LOADING_ON_OUTSIDE_HOLD`         | S/R | H: a reader of the `on` data outside the boundary                  |
| `ASYNC_OUTSIDE_LOADING_BOUNDARY`  | S/R | H: a pending reader with no armed boundary on its path             |
| `EFFECT_WRITES_OWN_SOURCE`        | S   | C-3: an error (ruled 2026-10-23); closures the apply creates are exempt |
| `EFFECT_RELAY_TEAR`               | S   | C-3 generalised: an effect relaying a source to a source           |
| `ASYNC_WATERFALL`                 | S   | R-pending: `await` whose inputs depend on another `await`          |
| `SILENT_HOLD` (structural form)   | S/R | H-9: a write whose cone contains no probe; timing form stays R     |
| `HUGE_FAN_IN`, `WIDE_SCOPE_DEPS`  | S   | counts on the static graph                                         |
| `HUGE_FAN_OUT`                    | S/R | static within module                                               |
| `DYNAMIC_ASYNC_COMPONENT`         | S   | R-pending on a component-typed value                               |
| `LONG_HOLD`                       | R   | timing                                                             |
| `FALLBACK_FLASH`                  | R   | timing                                                             |
| `STACKED_HOLDS`                   | R   | timing                                                             |
| `ABANDONED_FLIGHTS`               | R   | timing                                                             |
| `UNTRACKED_ASYNC_HANDLER`         | R   | timing; the structural half (no write before `await`, no `action`) is S |
| `HOT_SCOPE_*`                     | R   | profiling                                                          |
| `WASTED_RECOMPUTE`                | R   | data-dependent                                                     |
| `UNSTABLE_MEMO_OUTPUT`            | R   | data-dependent (partly S once ST decides structured equality)      |
| `UNSTABLE_LIST_IDENTITY`          | S   | ST: key is on the type; unkeyed `for` over records is a diagnostic |
| `IMMUTABLE_UPDATE_IN_STORE`       | U   | ST: a structured equation is a delta over `pre`, not a replaced container |
| `OPTIMISTIC_REVERTED`             | R   | data-dependent                                                     |
| `GRAPH_GROWTH`                    | R   | profiling                                                          |
| `REACTIVITY_HALTED`               | R   | an error escaping every boundary                                   |
| `INVARIANT_VIOLATION`             | R   | runtime internal                                                   |
| `SETTLE_WALK_UNINITIALIZED_SOURCE`| U   | E-4: every source has an initializer                               |
| `SERVER_WRITE`                    | S   | R-io with a server row (later)                                     |
| `SSR_*`, `HEAD_*`, `LATE_HEADER_WRITE`, `FRAME_MARKER_CORRUPTED`, `LAZY_ASSET_UNMAPPED`, `PRELOAD_DESCRIPTOR_INVALID` | R | server/transport; out of scope for the language |
| `UNRECOGNIZED_INSERT_VALUE`       | S   | a reader's type is not renderable                                  |
| `UNSCOPED_HOLE_ALLOCATED_IDS`     | R   | hydration                                                          |
| `LOWERCASE_EVENT_ATTRIBUTE`       | U   | X: handlers are a grammar form                                     |

## Codes the checker adds

`ref/src/check.ts` (08) reports these, each with the rule it enforces. Where
Solid has no code for the shape (its runtime cannot see it), the code is new.
Every row has a rejected variant in `scenarios/S-check-1.md` or the scenario
named.

| Code                              | Bin | Rule  | Scenario |
| --------------------------------- | --- | ----- | -------- |
| `DUPLICATE_DECLARATION`           | S   | E-7   | S-check-1 |
| `CYCLE`                           | S   | C-1 (CN-3a: union of branches; only an equation's own `pre` breaks it) | S-check-1, S-core-1 |
| `PRE_OF_NON_REACTIVE`             | S   | C-2   | S-check-1 |
| `UNBOUND`                         | S   | lexical scope (a component sees its declaration site, RG-7a) | S-check-1 |
| `UNKNOWN_COMPONENT`, `COMPONENT_AS_VALUE` | S | RG-4a | S-check-1, S-region-5 |
| `INSTANTIATION_NOT_BOUND`         | S   | E-9 / RG-6 | S-region-6 |
| `SNAPSHOT_ARGUMENT`               | S   | E-10  | S-region-6 |
| `SNAPSHOT_INITIALIZER`            | S   | E-4 / DV-6 | S-surface-1 |
| `IO_IN_REACTIVE`                  | S   | IO-2 / R-io-3 | S-surface-1 |
| `ACTION_CALLED_IN_OWNED_SCOPE`    | S   | IO-2 / R-io-3 | S-check-1 |
| `IO_IN_FN`                        | S   | R-io-2 | S-check-1 |
| `REACTIVE_WRITE_IN_OWNED_SCOPE`   | U/S | W-2 (a statement position) / SC-3 (a statement-bodied closure in reactive scope) | S-core-1, S-check-1 |
| `WRITE_TO_NON_SOURCE`             | S   | W-1   | S-core-1, S-check-1 |
| `DRAFT_WRITE_OUTSIDE_DRAFT`       | S   | ST-3a | S-store-2 |
| `ASYNC_STORE_SETTER`              | S   | ST-3b | S-check-1 |
| `OPTIMISTIC_OUTSIDE_HOLD`         | S   | AC-3  | S-check-1 |
| `OPTIMISTIC_NO_QUESTION`          | S   | AC-3 / ST-5c | S-check-1, S-solid-32 |
| `INVALID_REFRESH_TARGET`, `INVALID_AFFECTS_TARGET` | S | AC-4, AC-5 | S-check-1 |
| `REGION_ESCAPE`                   | S   | O-3   | S-check-1 (three shapes) |
| `UNSTABLE_LIST_IDENTITY`          | S   | ST-4b (narrow form: `map` into fresh records, unkeyed) | S-store-3 |
| `CONTEXT_NOT_FOUND`               | S   | RG-7b (over the static application tree) | S-check-1, S-region-7, S-ai-feed |
| `ROW_NARROWER_THAN_INFERRED`      | S   | CN-4a (checked only where a row is written) | S-check-1 |
| `EFFECT_WRITES_OWN_SOURCE`        | S   | C-3 (directly or through equations; not closures the apply creates) | S-check-2 |

## The advisory rows (ruled 2026-10-23, in part)

Under CN-1a there is no warning tier, so an S row is a compile error or it
is not a diagnostic. `ASYNC_WATERFALL`, `HUGE_FAN_IN`, `HUGE_FAN_OUT`,
`WIDE_SCOPE_DEPS`, `SILENT_HOLD` (structural), `LOADING_ON_OUTSIDE_HOLD`
and `UNTRACKED_ASYNC_HANDLER` (structural half) are **not errors** — they
are performance and shape advice about correct programs — and move to a
separate advisory tool that reads the same static graph and never fails a
build (the rustc/clippy split). `EFFECT_WRITES_OWN_SOURCE` is an error
(C-3); `EFFECT_RELAY_TEAR` (an effect copying one source into another — an
equation written the long way, with a one-instant tear, but also how a
source is synced into a JS-owned one) stays advisory. `UNRECOGNIZED_INSERT_VALUE`,
`DYNAMIC_ASYNC_COMPONENT` and `SERVER_WRITE` are type questions and wait for
the type oracle.

## Counting

| bin | codes |
| --- | ----- |
| U   | 21    |
| S   | 12    |
| S/R | 5     |
| R   | 17 (+ the SSR family) |

The U and S rows are the language's claim. Every one needs a scenario in
`scenarios/` whose verdict is "rejected", and an error message written for a
reader who will fix the program without running it.
