# 08 — Constraints and their enforcement

**Status: OPEN (2026-10-22).** What the compiler refuses, how it decides, and
what the escape looks like. CN-1, CN-3, CN-4 and CN-5 are ruled. The stance is Rust's: every static check is an
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
  close the cycle or leak the value (`a = m ? b : 1; b = m ? 2 : a` is an
  error). `pre` is the declared delay that breaks a cycle (C-2);
  restructuring is the fix for an escape. The static graph is only ever
  used to *refuse* programs: scheduling is the runtime's dynamic tracking,
  as in Solid, and the static graph is never the truth for when updates
  happen. (Ruled 2026-10-22: "Solid can't loop like that easily today
  anyway" — a memo cannot read itself through a branch without `prev` —
  so the rejection costs no program people write.)
- **CN-3b (The JS boundary is the runtime's, not an escape).** An edge the
  static graph cannot see — a closure handed to a JS function, a cycle
  through a JS-owned value, a prop of a JS component — is not marked and
  not approximated: it is outside the graph, so no static rule fires, and
  the runtime's existing checks (the disposed-read error, the cycle error)
  are the backstop there. The compiler never replaces a failed static
  check inside `.rx` with a runtime check; the two have disjoint domains.
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

## CN-5 — The escape

One word: **`pure`**, at the JS boundary (R-io-4) — the author asserts a
row the compiler cannot check, and only in the direction that lowers
taint. There is no `allow`, no per-file lint level, no `unchecked` block,
and no `dynamic` marker: the static graph's checks are sound over `.rx`
(CN-3a) and silent outside it (CN-3b), so nothing needs opting out.
(Ruled 2026-10-22; the earlier `dynamic` proposal is withdrawn.)

---

## Diagnostics this document settles

| code | bin | rule |
| --- | --- | --- |
| `ROW_NARROWER_THAN_INFERRED` (new) | S | CN-4a |
| `ASYNC_OUTSIDE_LOADING_BOUNDARY` | R | CN-3c: a runtime report, not a constraint |
