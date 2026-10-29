# Evaluation of the old prototype's core patches on the new pin

The original worktree (`/Users/devagr/reactivescript`, branch `proto/sound-tsx-frontend` at f3c6771) carried 12
modified upstream files. They are kept verbatim, per file, in `patches/legacy-f3c6771/` as evidence only (a scratch
three-way rehearsal produced 11 conflicting files / 44 regions on aa85cbde; they are not applied). Each was evaluated by
its regression tests, which are kept in this package even where the patch is no longer needed. "Status" is measured on
the unmodified pinned upstream (reactivescript aa85cbde, Solid ac28157); see RESULTS.md for the exact run.

| Legacy patch | What it did | Evaluation on aa85cbde | Carried? |
| --- | --- | --- | --- |
| `ref/package.json` | made `ref/` host the TSX package (exports, scripts, oxc/playwright/entities deps) | obsolete: this package has its own package.json/lockfile; upstream ref is untouched | no |
| `ref/scripts/solid-next.sh` | also ran `pnpm run types` | upstreamed (`pnpm run --if-present types`) | no |
| `ref/src/ast.ts` | added `hasAwait` helper | unused by the migrated lowering; AST stays unextended | no |
| `ref/src/failure.ts` | added `wireCacheKey` (order-independent argument key) | needed only by native `serverFunction` caching, so moved into this package (`tsx/wire-key.ts`); primitives.test.ts keeps its tests | no (moved) |
| `ref/src/check.ts` + `ref/src/signature.ts` | `errorKey`: failure identity by declaration rather than alias spelling; key-aware signature printing; server signature rows | **defect still present**: reproduced with handwritten RX (`upstream-repros/alias-failure-identity`, UPSTREAM-ISSUES.md #1). The fix is a cross-cutting checker refactor with an unexamined Rust counterpart, not a narrow patch, so it is not carried; affected tests stay failing in the baseline | no |
| `ref/src/runtime.ts` (interpreter, ~313 lines) | own/non-self `pre` history (selfPre/prePacket), keyed row retention, EF-2 pending→equal, optimistic guess proposals, ownership disposal order, optional chaining, server-fn factory cache | mixed: suites exercising these now partly pass (upstream rewrote parts of the runtime) and partly diverge only in the interpreter while compiled/native agree (category "reference interpreter divergence" in the baseline). Not carried: the patch is broad, interpreter-only and would make the reference runtime disagree with the Rust crate's model checks | no |
| `ref/compile/emit.ts`, `rt.ts`, `rt-web.ts`, `rt-server.ts` | compiled server-fn factory (`app.serverFn`) with cache keys; related emitter changes | upstream replaced this surface with `serverRef`/`serverCall` (SF-2/SF-6). The three server-identity tests that drive `app.serverFn` directly are recorded as adapter/API breakage, not ported yet | no |

Net result: the temporary upstream patch queue (`patches/`) is **empty** at the pin. No reference-only fix is claimed
as production (Rust) compiler coverage. Removal/adoption conditions are tracked per issue in UPSTREAM-ISSUES.md.
