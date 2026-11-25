# TS module values and types at the RX boundary

Keep MO-8's explicit declaration boundary. `x?: T` is just a type on an
already-supported value parameter. In contrast, `export const` introduces a
new class of imported value: TS const doesn't make an object immutable or
say whether it is a reactive accessor. Use `export pure fn getValue(): T`
for a stable value, or the existing `ref` result for a live reader.

For a TS-only `Card` or `Route`, put `export type` in the sibling `.d.rx`;
then the ordinary named import erases. The runtime compiler deliberately
doesn't resolve TS symbols (including type/value names and re-exports).
Erasing by syntactic usage risks deleting module evaluation; adding a
second import spelling bypasses the one declaration boundary. Keep the
existing rule and point `import type { … }` users at the `.d.rx` fix.
