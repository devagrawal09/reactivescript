# 03 — Regions

**Status: OPEN (2026-10-21).** Ownership, lifetime, and the regions that `if`,
`for`, components, boundaries and effects introduce. Synchronous only; holds
(05) add nothing here except that a region's *mount* can be held.

A region is a lexical scope with a lifetime (V-8). Everything declared in a
region — sources, equations, effects, readers, nested regions — is released
when the region ends. Regions nest; the program is the root region.

---

## O — Ownership

- **O-1 (Every declaration has a region).** A source, equation, effect, or
  reader is declared in exactly one region: the innermost enclosing block.
  There is no unowned declaration.
- **O-2 (Release).** When a region ends: its effects' cleanups run (EF-5), its
  readers leave the view, its sources and equations cease to exist, and its
  nested regions end first (innermost out). Nothing outside the region may
  hold a reference to any of them afterward (O-3 is the only way out).
- **O-3 (Escape).** A value declared in region `R` may be stored into a source
  or returned to a region that outlives `R` only through an explicit `escape`.
  Without it the program is rejected. (Solid: `runWithOwner`; the
  `RUN_WITH_DISPOSED_OWNER` warning is this rule's runtime shadow.)
- **O-4 (Writer scope).** A source may be written by imperative code in its own
  region or any nested region, or by a handler that received the source — not
  a snapshot of it — as an argument. An exported source exports its reader;
  exporting the writer is a separate, explicit declaration.
- **O-5 (Inference).** Regions are never annotated. The compiler assigns every
  declaration its region syntactically and checks O-3 by the escape analysis of
  closures and stored references.

---

## RG — Region-introducing forms

### RG-1 Conditional

`if c { A } else { B }` in a view. `c` is an equation. Exactly one of `A`, `B`
is a live region at any instant; the other does not exist.

- **RG-1a (Dispose and recreate).** When `c`'s truthiness changes, the live
  branch region ends (O-2) and the other is created fresh in the same instant:
  its sources re-run their initializers (E-4), its effects run their first
  apply (EF-2). A branch keeps no state across being left and re-entered.
- **RG-1b (Equality of the condition).** The branch switches only when `c`'s
  truthiness changes, not when `c` changes to another truthy value (E-6 on
  `Boolean(c)`). A truthy→truthy change is seen through RG-1c, not by
  recreation.
- **RG-1c (Narrowed binding).** Inside the branch taken by `if (x) { … }` where
  the condition is a bare reactive name, `x` denotes an equation equal to the
  outer `x` with the falsy case removed from its type. It keeps updating while
  the branch is live. (Solid: `<Show when={x}>{(x) => …}</Show>`'s narrowed
  accessor, without the callback.) Compound conditions narrow nothing.

### RG-2 Repetition

`for x in xs { Decl*; Markup }` in a view. `xs` is an equation over an
ordered collection. Each element has a row region.

- **RG-2a (Identity).** In core, rows are identified by element identity
  (`Object.is`). A row region lives while an identical element is present in
  `xs`; a reorder moves the region; an element that disappears ends its region;
  a new element creates one. Duplicates get one region per occurrence, in
  order. (Solid: `<For>` default. Keyed identity: 06-stores ST-4.)
- **RG-2b (Row binding is constant).** Within a row, `x` is a constant for the
  row's lifetime — it cannot change without the row being replaced. The row's
  index is an equation. (Structured mutation of `x` in place is 06-stores'
  question; in core, values are immutable.)
- **RG-2c (Row declarations).** `Decl*` inside the row are declared in the row
  region: a `source` per row re-initializes only when the row is created; an
  equation per row may read `x`, the index, and anything in enclosing regions.

### RG-3 Effects

`effect (…) B` is a region: its apply block's cleanup (EF-5) is the region's
release. An effect cannot declare sources, equations, or nested effects inside
`B` (SC-2 has no declarations), so the region contains only the cleanup.

### RG-4 Components

A component is a function from a props value to a region whose tail is a view.

- **RG-4a (Application is a view form).** `<C attr={e} …>children</C>` is
  markup. It may appear only in a view; there is no expression-position
  application. Applying `C` creates a region nested in the view's region, with
  the view's lifetime (an `if` branch or `for` row that contains `<C/>` owns
  it).
- **RG-4b (Props are one structured equation).** `props` is a single value
  whose fields are equations: `props.x` and `{ x } = props` are projections and
  keep updating. A prop is never a snapshot unless the body takes one (E-4,
  `peek`). Spread, rest, `merge`, and `omit` are operations on this value
  (06-stores treats its path semantics). Named parameters are not a separate
  form; destructuring covers the signature use.
- **RG-4c (Children).** `children` is a view value evaluated in the *caller's*
  region: its readers are the caller's, its lifetime is the caller's, and the
  child only decides where it is placed. A child that needs to create its
  content more than once, or conditionally own it, asks for a function prop
  instead, which is ordinary.
- **RG-4d (No return channel).** A component body evaluates to its view and
  nothing else. To expose a value upward, the caller passes a source and the
  child writes it (O-4), or passes a handler the child calls. (Solid: `ref`
  props.)

### RG-6 Instantiation

A call to a function with a `ref` parameter or a node-declaring body (E-9).

- **RG-6a (Once, in the caller's region).** The call creates a region nested
  in the region of the call site; the body's sources, effects, and nested
  regions are owned by it. The call is not re-evaluated; its result is a value
  (often an equation) bound in the caller.
- **RG-6b (Arguments).** Ref arguments are equations passed by reference and
  keep updating inside the body. Value arguments are snapshots at
  instantiation (E-4). An expression passed to a ref parameter is wrapped as an
  equation at the call site.
- **RG-6c (Composition).** Pure transforms compose by lifting (`double(count)`
  is an equation); primitives compose by instantiation (`debounce(ref query,
  300)` owns an effect). A function's kind is visible in its signature; the
  call site need not know which it is, only that the first re-evaluates and
  the second does not.

### RG-5 Boundaries

`loading` and `errored` are regions whose content is a nested region that the
boundary can take out of the current instant (05-holds). In the synchronous
fragment they are inert wrappers.

---

## Scenarios

- `S-region-1`: `if` branch with a source — state resets on re-entry (RG-1a).
- `S-region-2`: truthy→truthy change keeps the branch; narrowed binding
  updates (RG-1b, RG-1c).
- `S-region-3`: `for` reorder moves rows; duplicate elements; row-local source
  survives reorder, resets on remove/add (RG-2a, RG-2c).
- `S-region-4`: a closure declared in a row stored into an outer source —
  rejected without `escape` (O-3).
