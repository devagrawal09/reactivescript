# Ordered error arms — design notes

The normative rules are in 07 §3–5, H-12, R-f-4, R-f-6, and AC-7.
This note collects examples and tooling requirements.

## 07 — Surface

```rx
try { await save() } catch (e) {
  Conflict => { showConflict(e.version) }
  Offline => { showOffline() }
  _ => { report(e.message) }
}

errored fallback(e) {
  RateLimited => { <RateLimitNotice retryAfter={e.retryAfter} /> }
  _ => { <RetryBox message={e.message} /> }
} {
  <Inbox page={page} />
}
```

A class arm names one declared error class. `_` matches the remainder;
it may appear once and must be last. Each body is braced. Each arm gets
its own binding of `e`, narrowed to that arm's class, or to the residual
row in the default arm (at least `Error` for open rows). Retain the
existing untyped catch/fallback as the spelling for a default-only
handler. `await f() catch (e) => alt` keeps its expression shape;
`await f() catch (e) { Conflict => { null } _ => { throw e } }`
uses a single expression inside each arm.

## 05 / 04 — Matching and ownership

Match the class of the failure once, in source order. The first matching
arm owns the fallback and its lifetime. Changing the selected arm replaces
its region; changing the error within the same arm updates its binding.
A failure in an arm does not enter another arm of the same dispatch.
It propagates to the enclosing context. Separate boundaries can still nest
for different regions of UI; migrate same-content typed nesting to one
dispatch. Without a default, the dispatch must cover the whole declared
row it receives. Any unmatched error at runtime propagates out.

## 99 — Errors, not warnings

- `ERROR_ARM_ORDER`: a default isn't last, or an earlier arm already
  accepts every instance accepted by this class.
- `UNREACHABLE_ERROR_ARM`: a closed, resolved row proves no failure can
  match this class. Don't infer absence from an opaque imported row.
- `MISSING_ERROR_ARMS` names uncovered classes and requires `_` for an
  open remainder.
- `LEGACY_TYPED_HANDLER` shows the rewrite for an annotated catch or
  fallback. `DEAD_TYPED_BOUNDARY` is replaced by arm validation.

## Checker (ref/src/check.ts, compiler/src/check.rs)

- The row a dispatch checks against: the `try` body's (`stmtsFails`), the
  awaited expression's (`failsOf`), or, for a boundary, every class that
  reaches its region on a route up from a reader, an application or an
  argument in its content, before a step that discharges it.
- `_` and an `Error` arm discharge every class. Other class arms discharge
  their classes. `Panic` discharges none (R-f-10). A lone `Panic` arm needs
  no `_`, since it leaves every failure to the code below it.
- Ordering: `_`, `Error` and `Panic` each take everything that reaches them,
  so any later arm is `ERROR_ARM_ORDER`. So is a class named twice. Classes
  are flat (R-f-1). No other class subsumes another.
- A row is closed when it has no `Error` and no prop's failures, which are
  known only per application. `UNREACHABLE_ERROR_ARM` and a dead `_` need a
  closed row.
- Each arm binds its own `e`. For a rethrow, a class arm's `e` is that
  class. `_`'s `e` is the rest of the row after the earlier arms. `Panic`'s
  `e` is nothing (a rethrow is `Error`). The projection's type for `_` is
  `checkModules(…).armTypes` (crate: `Checked.arm_types`), sorted, or
  `["Error"]` for an open or unresolved row.
- Model: `ModelArm { cls, line, dead? }` on `errored` regions (`arms`) and on
  an action's `ActionCatch` (`arms`; `classes` is the arm names, or `null`
  with `_`).

## Tooling

Give each arm a distinct site identity rooted in its dispatch. Trace only
the selected arm, not the checks that preceded it; coverage uses
`caught:C` or `errored:C` for that arm (`_` for the default). This includes
arm replacement on a running boundary and carries the selected instance
to map/coverage. The type projection uses the same arm order and local
bindings without exposing class-test syntax to RX users.
