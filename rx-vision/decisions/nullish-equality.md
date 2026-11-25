# Equality and missing keys

**Recommendation: keep equality strict.** For presence checks that accept
both `null` and `undefined`, use `v != null && v != undefined` after binding
`v` once. `v ?? fallback` already handles both where the task is defaulting.

`live.values[k]` is `undefined` when the key is missing. RX compares with
strict equality after unwrapping store proxies, and its TSX projection
uses strict operators. `===`/`!==` are explicitly aliases (07 §3), so
making `== null` special would either change those aliases or require a
second equality relation. E-6's change-detection equality is separate.

- **Unify `null` and `undefined` for `== null`:** convenient and familiar
  from JS loose equality, but syntax-directed if `x == nil` (with
  `nil = null`) still behaves differently, and can make runtime behavior
  disagree with TypeScript narrowing. Don't do it.
- **Diagnostic:** consider a typed hint only when the operand can be
  undefined and the application probably means presence. `any` is common
  at the host boundary, and a deliberate null-only test is valid, so a
  blanket diagnostic would be noisy. Revisit if the trap recurs.
- **Leave strict:** no semantic or checker changes. The explicit test
  preserves the difference when callers need it.

Round 5 follow-up: the emitter uses `!__rt.eq(m, null)` for `m != null`,
not JavaScript's loose `!=`. The runtime compares strictly, so the
projection's `!== null` matches it. Changing only the projection would
incorrectly narrow away `undefined`. The explicit two-check form is
covered by `S-js-expressions`.
