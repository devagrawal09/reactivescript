# Align language checks, lowering and the runtime

## What and why

Make real relative JS modules win over the injected `./api`, and erase declaration-only imports. Extend written `.d.rx` declarations with private aliases, generics, type imports and failure rows. Fix casts, computed keys, multiline chains, escapes, fragments and JSX spacing across the reference and Rust implementations.

Recover diagnostics independently across modules. Align `rx-tsc` with declaration-file precedence, source write types, and handler snapshots. Diagnose misplaced styles, statically shadowed typed boundaries, and unsupported action defaults. Add the fixed pure JavaScript prelude and detach store snapshots at action call time without changing ordinary JS argument identity. Block-function equations still instantiate; `SNAPSHOT_ARGUMENT` explains when to use an expression-bodied function instead.

This change includes checker and lowering parity in compiler CI. It does not include declaration generation, dev keys or the map.

## Breaking changes

- A real `./api` takes precedence; an unresolved injected API with no implementation reports `MISSING_TEST_API`.
- Corrected escape and JSX whitespace handling can change rendered text.
- `STYLE_SCOPE` and `DEAD_TYPED_BOUNDARY` reject previously accepted shapes. The latter only fires when the inner fallback is statically inert.
- Structured store arguments to actions retain their call-time state rather than following subsequent writes.

## Verification

| Check | Result |
| --- | --- |
| Interpreter, Solid oracle, compiled scenarios | Pass |
| TypeScript projection scenarios | 202 pass |
| SSR/hydration | 143 pass, 1 fail, 7 skipped; `S-solid-28` observed a late hydration frame before its expected answer |
| Rust tests, Node-API, runtime | Pass |
| Checker and projection parity | 414/414 and 235/235 |
| Lowering parity | 209/239 after esbuild normalization across three targets; the exact 30 mismatches match the CI baseline |

## Questions for Ryan

- Is the fixed pure prelude the right boundary, or should more names require foreign declarations?
- Is static-fallback-only `DEAD_TYPED_BOUNDARY` the right level of proof for an error?
- Does real-file precedence leave the injected API in the right role for tests and small examples?
