# 08 — Constraints and their enforcement

**Status: OPEN (2026-10-22).** What the compiler refuses, how it decides, and
what the escape looks like. The stance is Rust's: every static check is an
error, the checks are sound (an over-approximation that rejects some fine
programs and never admits a wrong one), modular (a module is checked against
its imports' signatures, not their bodies), and the only way around a check
is explicit, local and greppable — the check does not silently become a
runtime check.

---

## CN-1 — Severity

- **CN-1a (Errors only).** Bins U (unwritable) and S (static) in
  `99-diagnostics.md` are compile errors. There is no warning tier. Bin R
  is not a constraint: it is the runtime's attribution report (timing,
  holds, waterfalls) and never fails a build. (Ruled 2026-10-22.)
- **CN-1b (Diagnostics keep Solid's names).** A static error carries the
  code the dev runtime would have raised for the same shape, so a reader
  who knows one knows the other.

## CN-2 — The checks, by enforcer

| constraint | rules | enforcer |
| --- | --- | --- |
| no write, statement or `io` call in reactive scope; `optimistic` only in an action; a draft writes only `d` | W-1, W-2, IO-2, AC-3, ST-3a | grammar: no position exists (bin U) |
| `io` rises and never falls; `fn` is pure, `action` is `io`; `pure` only at the JS boundary | R-io-1..4 | row inference in the checker |
| `pending` enters only through `await`; `lane` only through probes; rows flow through equations and across modules | R-1, R-10, R-13, R-14 | row inference |
| no instantaneous cycle | C-1 | the static input graph (CN-3) |
| a reactive value never escapes its region; a closure capturing a region-local name does not outlive the region | O-1..O-5, SC-3 | escape analysis over closures: a region is a lifetime |
| a value parameter given a reactive argument | E-10 | static |
| an unkeyed `for` over records whose values change | ST-4b | static shape check |
| exported rows: a component's props and an exported equation carry their rows in their types | RG-4, R-14 | emitted in `.d.rx`; checked at the import (CN-4) |

## CN-3 — Soundness and the static graph

- **CN-3a (Over-approximate).** C-1 and the region/escape checks run over
  the **static** input graph: the union of every branch's inputs, every
  prop read, every arm of a conditional. A program the static graph cannot
  prove acyclic or region-closed is rejected, even if no run would ever
  close the cycle or leak the value. `pre` is the declared delay that
  breaks a cycle (C-2); restructuring is the fix for an escape.
- **CN-3b (No silent fallback).** The compiler never replaces a failed
  static check with a runtime check on its own. Where the static graph
  genuinely cannot see an edge — a prop of a component imported from JS, a
  value whose row is unknown at the boundary — the edge is marked
  explicitly by the author (CN-5) and only that edge is checked at runtime.
  (The Rust stance: the borrow checker rejects; `RefCell` is a visible
  type that opts one value into a runtime check; nothing is checked at
  runtime because the compiler gave up quietly.)
- **CN-3c (Pending is not a constraint).** A reader whose expression
  carries `pending` need not be under a `loading` region: with SSR the
  held mount is the correct behaviour and only an SPA would want to know.
  Uncaught `pending` at the mount stays a runtime diagnostic
  (`ASYNC_OUTSIDE_LOADING_BOUNDARY`) and the mount is held (H-2). The row
  is still inferred and displayed. (Ruled 2026-10-22.)

## CN-4 — Rows in signatures

- **CN-4a (Inferred, displayable, writable).** Rows (`io`, `pending`,
  `lane(x)`) are inferred everywhere, shown by tooling, emitted into
  `.d.rx` for every export and every component's props, and may be
  written by the author to constrain: `data: pending User` on a prop,
  `io (n: number) => Promise<void>` on a value. A written row narrower
  than the inferred one is an error (`ROW_NARROWER_THAN_INFERRED`, bin
  S); a wider one is accepted (the author promises less). (Ruled
  2026-10-22.)
- **CN-4b (Modular).** An import is checked against the signature only.
  A JS import has no signature for rows: it is `io` (R-io-4) and its
  values are row-free unless the author writes rows at the import.

## CN-5 — The escape (open)

Rust has two escapes and they are both visible: `unsafe` (the author
takes over a proof) and runtime-checked types (`RefCell`, `Rc`). The
corresponding forms here, proposed:

- **`pure`** — already ruled: the one row the author may assert at the JS
  boundary. The `unsafe` of `io`.
- **`dynamic`** — an edge the static graph cannot see, declared so: a
  prop read, a conditional input, or a cycle through a JS-owned value,
  marked `dynamic` is excluded from C-1 and the escape check and is
  checked at runtime (the dev error Solid raises today for that shape).
  Greppable, local to the one edge, never inferred.

No other escape: there is no `allow`, no per-file lint level, no
"unchecked" block. A program that cannot be written without `dynamic`
is the program the runtime check exists for; every other program is
proven.

---

## Diagnostics this document settles

| code | bin | rule |
| --- | --- | --- |
| `ROW_NARROWER_THAN_INFERRED` (new) | S | CN-4a |
| `ASYNC_OUTSIDE_LOADING_BOUNDARY` | R | CN-3c: a runtime report, not a constraint |
