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
| `ACTION_CALLED_IN_OWNED_SCOPE`    | U   | W-2 / R-io: `action` is imperative                                 |
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
| `RUN_WITH_DISPOSED_OWNER`         | U   | O-3: `escape` is the only cross-region move                        |
| `SETTLED_CLEANUP_UNOWNED`         | U   | EF-4/EF-5 with O                                                   |
| `INVALID_REFRESH_TARGET`          | S   | `refresh` requires a source with a question (V-9)                  |
| `INVALID_AFFECTS_TARGET`          | S   | same                                                               |
| `LOADING_ON_OUTSIDE_HOLD`         | S/R | H: a reader of the `on` data outside the boundary                  |
| `ASYNC_OUTSIDE_LOADING_BOUNDARY`  | S/R | H: a pending reader with no armed boundary on its path             |
| `EFFECT_WRITES_OWN_SOURCE`        | S   | C-3                                                                |
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
