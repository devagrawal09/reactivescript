# No warnings in RX

RX diagnostics are errors. The `spec/99` rows solely about dead code are:

- `DEAD_TYPED_BOUNDARY`: an inner catch-all consumes every failure before it can reach the outer typed fallback. Use one boundary with an ordered class dispatch and at most one default, last.
- `STYLE_SCOPE` (pruned selector only): the selector can only target a different component, outside its scope. Bind local selectors to elements/classes through component-local identifiers; render another component's styles via an explicit class-map interface.

`DECLARATION_HELPER` and `IMPORT_ROW_ON_TS` can report redundant forms, but neither diagnostic solely reports dead code: invalid helpers can make facts unreadable and import rows can assert contradictory facts. A private type marker forbids redundant purity wrappers; local TS import rows have no valid use. Duplicate declarations and shadowed imports concern binding identity, not unreachable code. The performance and runtime attribution rows (including `WASTED_RECOMPUTE`) aren't dead-code diagnostics.
