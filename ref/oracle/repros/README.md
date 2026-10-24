# Repros for Solid 2.0 (rc.16)

Standalone scripts against the published packages — no ReactiveScript code
involved. Run from `ref/oracle/` after `npm install`:

```
node --conditions=browser --conditions=development repros/dv3-signals.mjs [effect-in-fallback|read-in-fallback]
node --conditions=browser --conditions=development repros/dv3-web.mjs [element-fallback|array-fallback|static-fallback]
node --conditions=browser --conditions=development repros/dv4-signals.mjs [store|memo] [boundary|none]
```

---

## DV-3 — a render effect inside a re-armed boundary's fallback holds the content's reveal

**Rule.** SCENARIOS.md S-22 row 3′ (D-18): *"if `content(2)` lands before
`meta(2)` → `content(2)` — the fallback is never seen."* Pinned by
`tests/loading-on-rearm-reveal-3540.test.ts` "content lands before the
fallback: the fallback is never seen".

**Shape.** An outer `Loading`, inside it a `Loading` with `on: id` whose
fallback reads async `meta` and whose content reads async `content`; both
memos depend on `id`. After the first load, `setId(2)`; `content(2)` lands
before `meta(2)`.

**Observed.** If the fallback *creates a render effect* that reads `meta` —
which is what any compiled JSX fallback does: `<p>Meta {meta()}</p>` is an
element plus an `insert` effect — the screen keeps `content(1)` after
`content(2)` lands, and reveals `content(2)` only when `meta(2)` lands:

```
                     effect-in-fallback    read-in-fallback (the pinned shape)
setId(2)             "content c1"          "content c1"
content(2) lands     "content c1"   ✗      "content c2"   ✓
meta(2) lands        "content c2"          "content c2"
```

`dv3-web.mjs` shows the same through `solid-js`'s `<Loading>` and
`@solidjs/universal`: an element fallback fails, an array fallback
(`["Meta ", () => meta()]`) and a static fallback pass.

**Likely cause.** The fallback's render effect is a frame reader that is
pending on `meta(2)` and counts toward the change's hold, though the
fallback is never the display in this race (H-4: a reader behind content
that is not shown holds nothing). The pinned test reads `fallbackData()`
directly in the fallback function, so no render effect exists and the
case is not covered.

---

## DV-4 — a derived store's per-key `isPending` is false under a boundary that has shown content

**Rule.** RULES-DERIVED D-30: *"a derived store's leaves report the
derive's new-question refetch like any async memo"*; SCENARIOS S-37 row 2:
after `setId(2)`, `isPending(() => state.a)` is `true`.

**Shape.** `createStore(async draft => { Object.assign(draft, await fetch(id())) }, {})`,
a render effect showing `state.a` and `isPending(() => state.a)`, under a
`createLoadingBoundary` that has shown content. `setId(2)`.

**Observed.**

```
                      store, boundary   memo, boundary   store, no boundary
setId(2)              "1 -"   ✗         "1 pending"  ✓   "1 pending"  ✓
```

The async memo under the same boundary reports pending; the same store
outside a boundary reports pending. Only the store-under-boundary
combination reads `false`.

---

## DV-7 — an outer error boundary that caught a rethrow from an inner fallback does not recover

Found while lowering typed `errored` boundaries (R-f-4); it is not one of
our divergences, because the lowering avoids the shape.

**Shape.** `createErrorBoundary(inner, …)` inside `createErrorBoundary(…)`;
the inner fallback rethrows an error it does not handle
(`err => { if (!(err() instanceof NotFound)) throw err(); … }`).

**Observed** (`dv7-rethrow.mjs`):

```
which   1 (NotFound)   0      2 (Other)      0               1            0
screen  inner:nf       ok0    outer:other    outer:other ✗   inner:nf     ok0
```

After the outer boundary takes the rethrown `Other`, the content recovering
(`which = 0`) does not clear it; only a later error in the inner boundary
re-renders through it. Expected `ok0` at the ✗.

**Likely cause.** The outer boundary's error belongs to the inner
fallback's computation; when the inner switches back to its content that
computation is disposed, and the outer is not told the error's source is
gone.

**How we lower around it.** The inner fallback returns a marker carrying
the error instead of throwing; a memo around the inner boundary reads it
and throws. That memo is an ordinary dependent of the boundary, so it
re-runs and recovers when the content does (S-fail-1 instants 6–8).
