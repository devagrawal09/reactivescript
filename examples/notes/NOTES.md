# notes — dogfooding notes (2026-10-25)

A notes app written to use the whole language at once: four modules
(`api.d.rx`, `data.rx`, `ui.rx`, `main.rx`), server functions behind the
list, the note and the save, routing as a source of a discriminated union,
an editor with drafts and validation, a keyed table, per-component
stylesheets, and a layout from a client question. S-app-notes drives it on
all five runners; served, the page makes three server-function requests
after hydration.

## What it found

| # | where | what | outcome |
| - | ----- | ---- | ------- |
| 1 | `ref/src/runtime.ts` | An optimistic functional write over a question source that nothing on screen reads (the list was unmounted when the editor saved) applied the function to a stale value: `call of non-function`. | Fixed: the source is pulled first. |
| 2 | `ref/compile/emit.ts` | A server body that calls a module-level value `fn` (`note(r)`, which drops the `owner` column) compiled to an unbound name: the hoisting (SF-7a) took imports, error classes and server fns, not fns. | Fixed: a value fn is declared again inside the extracted function. SF-3 already allowed it. |
| 3 | the language | One `catch` per `try`, as in TypeScript: handling `Conflict` one way and every other failure another needs two nested `try`s (`data.rx`, `save`). | Ruled 2026-10-25: keep TypeScript's one clause per `try`; nest. |
| 4 | the rules | A client question with a first paint still fails with `Error` (R-f-8): `await viewport() -> 1024 catch (e) => 1024`. Right by R-f-5, a little repetitive. | As ruled. |
| 5 | the harness | A flight key cannot contain a space (`resolve "k" v` splits on whitespace), so the test data avoids them. Frames join adjacent elements with no space (`backwidesave`): faithful, hard to read for a real app. | Harness only. |

The type layer (13) and the content model (SV-7d) found nothing: the app was
written typed and with its `<tbody>`, which is what they ask for.

## Ruled

Multiple typed `catch` clauses were considered and declined (2026-10-25):
statements are TypeScript's (07 §5), one `catch` per `try`; a typed catch
rethrows other classes (AC-7), so handling two kinds of failure differently
nests two `try`s.
