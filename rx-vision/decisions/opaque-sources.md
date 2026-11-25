# Opaque object sources

**Recommendation: keep ST-1 and the host boundary for now.** If direct RX
ownership proves necessary, first try explicit Solid raw values across that
boundary, not new RX syntax.

ST-1 treats object and array values as structured. `any` does not change that
classification; neither does importing a type from `.d.rx`. MO-10's `ref T`
describes a foreign accessor: destructuring its result binds the reader
directly, so a host signal can serve a graph as-is. It does not turn an RX
`source` into an atomic slot, and the foreign setter remains host IO with no
RX action-write contract (MO-10e). The map's numeric handle keeps RX
ownership and changes only when the graph is replaced.

- **Solid `markRaw` at ingestion:** Solid explicitly leaves a marked value
  out of deep wrapping; frozen objects alone still wrap. RX currently
  classifies even a marked object seed as a structured source, so this is
  not a direct-slot solution today. Experiment with honoring explicit raw
  values before wrapping, including replacement, equality, path writes,
  the interpreter, and SSR/hydration. Preserve ST-1 for ordinary records.
- **Type-driven from `.d.rx` or `Readonly<T>`:** no new keyword, but
  provenance and static readonly are not promises of runtime identity or
  deep immutability. The same value would behave differently when renamed,
  widened or moved across a module boundary.
- **`source g: frozen T` / an opaque source form:** explicit but creates
  a second kind of source. It requires a rule for aliasing, replacement,
  invalid path writes and server transport. Don't add it for this port.

Regardless of storage, `buildModel` should keep its edge indices outside
an immutable input graph rather than annotating the inputs in place.
