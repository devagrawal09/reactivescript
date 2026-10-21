# 06-stores

**Status: NOT OPEN — phase-1 model recorded (2026-10-21).** Full rules
(draft, key/reconcile, follows, yield) open after 04-rows.

## Phase-1 store model (what `ref/` implements; carried into ST-1/ST-2)

- **ST-1 (Structured vs atomic is the type).** A source or equation whose
  value is an object or array is structured; there is no separate store
  primitive.
- **ST-2 (Dependencies are per object identity, per key).** A read of `o.k`
  depends on `(o, k)` where `o` is the object's identity, not a path from a
  root. A read of a reactive name `x` depends on `(x, root)`. Reaching `o`
  through `x` tracks every step. Consequence: a shared object reached through
  two names notifies readers through either (S-region-3 instant 6). This is
  Solid's store model; a root-path model was tried first and rejected by that
  scenario.
- **ST-2a (Writes).** `x := v` replaces the root; E-6 per-path equality applies
  (an equal-by-paths value is a no-op and keeps the old identity). `x.a.b := v`
  mutates in place and notifies `(x.a, b)`; readers of `x` alone are not
  notified (fine-grained by construction).
- **ST-2b (Equation results).** A structured equation result is compared per
  path with its previous value (E-6): equal → cut, keep old identity;
  otherwise the root changed and readers of the root re-read. Per-key
  notification for equation results arrives with reconcile (ST-4).
