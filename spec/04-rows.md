# 04 — Rows

**Status: OPEN (2026-10-21).** Three properties of an expression that the
compiler tracks and the grammar restricts: `io` (may write or side-effect),
`pending` (may have no answer yet), `lane(x)` (derived from a probe of `x`).
All three are inferred; annotations exist for declarations and display.

This document is the static side. What the screen does with a pending reader
is `05-holds.md`; this file only says where rows come from, how they flow,
and where they may not go.

---

## R-io — effectful functions (restated from 02 IO-1..3)

- **R-io-1 (One-way taint).** `io` is a row the compiler infers inside
  `.rx`: a function is `io` iff its body writes a source, calls an `io`
  function, or calls a value whose type carries `io`. Taint only rises:
  nothing in `.rx` can declare a tainted body clean.
- **R-io-2 (Declaration is the row).** `fn` is pure by definition — a `fn`
  whose body is `io` is a compile error (`IO_IN_FN`, bin S). `action` is
  `io` by definition (AC-1). An apply block, an action body and an arrow
  written in imperative scope are `io` scopes; an equation, a `fn` body,
  a draft block and an arrow written in reactive scope are not.
- **R-io-3 (Call site).** An `io` value may be called only in an `io` scope
  (SC-2). Calling one anywhere else is a compile error (`IO_IN_REACTIVE`,
  bin S — Solid's runtime `ACTION_CALLED_IN_OWNED_SCOPE` has no runtime
  form here). Carrying an `io` value (storing it, passing it) is not a
  call; its type carries the row: `io (n: number) => Promise<void>`.
- **R-io-4 (The boundary).** Every JS import is `io`. `import pure { f }
  from …` is the one assertion that lowers taint, and it is unchecked for
  JS (checked when the imported module is `.rx`, where it must agree with
  the inferred row). There is no `io` keyword: dirty is the default and is
  inferred; `pure` is the only word, and it points one way. (Ruled
  2026-10-22.)

## R-pending — absence

- **R-1 (Entry).** `pending` enters only through `await e` in reactive scope.
  `await` is the row marker, not a scheduler: if `e` is already a value,
  `await e` is `e` in the same instant with no tick; if `e` is a promise or an
  async iterable, the equation is pending until the first answer lands. A
  Promise-valued expression without `await` is an ordinary value of type
  Promise and is never pending.
- **R-2 (Flow).** An equation that reads a pending value is pending. A reader
  of a pending value is a pending reader (05 decides what that does to the
  screen). An effect whose compute half is pending does not run its apply
  (EF-2: nothing changed). Passing a pending value — as a prop, into a `ref`
  parameter, into a `fn` — is not reading it; only evaluation of the value is.
- **R-3 (Functions).** A `fn` whose body contains `await` has row `pending`;
  a lifted call to it is a pending equation. Rows compose through calls like
  values.
- **R-4 (Flights).** The in-flight work of a pending equation belongs to its
  question (V-9), and the question belongs to the change whose pass asked it:
  a pending pass triggered by change `d` is `d`'s, whether or not a new
  request was issued (S-solid-16 variant: `page` re-asks `details` through
  `pageData` without a new fetch). An input change asks a new question: the old flight is
  abandoned (its answer, if it lands, is discarded), the body restarts from
  the top, and the old body's `finally` runs. A re-ask (`refresh`) restarts
  the body for the *same* question — quiet (F-9).
- **R-5 (Static inputs).** Because inputs are collected at compile time, a
  read after an `await` is a dependency like any other. There is no tracking
  window; `UNTRACKED_READ_AFTER_AWAIT` is unwritable. Likewise an absent
  operand (pending or error) does not erase the equation's other inputs:
  `"d:" + pageData + ":" + count` depends on `count` even while `pageData` is
  pending (found by `ref/`: S-solid-16 variant — a dynamic-tracking
  evaluator that short-circuits on absence drops `count` and lets its hold
  commit).
- **R-6 (Errors).** A rejected `await` is an error value (E-12): it ends the
  wait, flows like a value, is caught by `errored`, and is retried by a new
  question or `refresh`. There is no separate errored state.
- **R-7 (First paint).** `await e -> v` declares `v` as the value until the
  first answer lands: the equation is never pending on its first flight and
  `pending?` of it is `false` until then. Later questions follow R-4 and the
  hold rules. (Solid: `loadingValue`.)
- **R-8 (Imperative scope).** A pending value cannot be read as a snapshot;
  in imperative scope, reading a pending equation is a type error unless
  through `latest` or `peek`-with-a-default (05 decides the forms). A
  handler that needs "the value when it lands" uses `await` in its own body,
  which is ordinary JS asynchrony (SC-3: the continuation stays imperative).

## R-lane — display-ahead

- **R-9 (Probes).** `latest x` and `pending? x` are the two probes. `latest x`
  reads the in-flight value of `x` if there is one, else the committed value.
  `pending? x` is `true` iff `x`'s value is not the final answer to a new
  question (F-9); on a first load, both probes do what a read of `x` does —
  there is no verdict until there is a value.
- **R-10 (Lane row).** A probe is itself a dependency on `x` (a lane one):
  the probing reader re-evaluates when `x` changes. The result of a probe of `x` carries row `lane(x)`. The
  row flows through equations like `pending`: `y = latest x * 2` has
  `lane(x)`; an expression over probes of two sources has both lanes. It
  stops at readers: a reader of a lane-typed value renders in that lane. This
  is Solid F-6 ("a display-ahead read is a world of its own") as a type; what
  it means for the screen is 05.
- **R-11 (Probes never hold).** A probe never holds the instant it reads ahead
  of (F-6). A *plain* read beside a probe in the same reader still holds
  (D-23): `[pending? x, x]` holds like `x` alone, and the two are atomic
  because they are one reader (V-1).
- **R-12 (Probes in imperative scope).** `latest x` and `pending? x` are
  readable in imperative scope as snapshots of the verdict / in-flight value
  at that moment.

## R-inference

- **R-13.** Rows are inferred locally per function and per equation from the
  body; no whole-program analysis. `io` from writes and `io` calls; `pending`
  from `await` and pending inputs; `lane` from probes and lane inputs.
- **R-14.** A declaration (`.d.ts`-equivalent) states rows for imports:
  `! io`, `! pending` (a function returning a promise that the language
  should treat as awaitable in place). Absent a declaration, R-io-4 applies.

---

## Diagnostics this document makes unwritable or static

| code                             | bin | rule  |
| -------------------------------- | --- | ----- |
| `UNTRACKED_READ_AFTER_AWAIT`     | U   | R-5   |
| `PENDING_ASYNC_UNTRACKED_READ`   | U   | R-8   |
| `PENDING_ASYNC_FORBIDDEN_SCOPE`  | U   | R-8   |
| `SYNC_NODE_RECEIVED_ASYNC`       | U   | R-1   |
| `ASYNC_WATERFALL`                | S   | an `await` whose inputs depend on another `await` (R-2) |
| `UNTRACKED_ASYNC_HANDLER` (structural half) | S | a handler that awaits with no write before and no `action` |

## Scenarios (executable once 05 gives pending readers a screen semantics)

- `S-row-1`: `await` of a value is same-instant; of a promise is pending until
  `resolve` (R-1).
- `S-row-2`: input change abandons the flight; late answer discarded (R-4).
- `S-row-3`: `await e -> v` first paint; `pending?` false until first answer
  (R-7).
- `S-row-4`: rejected await is an error value; new question retries (R-6).
- `S-row-5`: `fn load(id) => await fetch(id)`; `x = load(id)` pending (R-3).
