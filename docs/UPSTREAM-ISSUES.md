# Upstream issues found while migrating (pinned reactivescript aa85cbde, Solid ac28157)

Each issue is reproduced with handwritten RX (or a direct upstream API call) on the clean pinned checkout, without
this package's lowering. Nothing here has been filed upstream: opening issues needs the user's approval.
No upstream patch is carried for either issue (see PATCHES.md for why), so the affected tests stay visibly failing
in `baselines/known-failures.json`.

## 1. Aliased error-class imports lose declaration identity (reference checker)

- Repro: `upstream-repros/alias-failure-identity/` (`main.rx`, `reader.rx`, `types.rx`).
  `reader.rx` throws `Missing` imported as `Absent`; `main.rx` wraps `<Reader/>` in
  `errored fallback(e: Lost)`, where `Lost` is the same `Missing` imported under another alias.
- Command (clean upstream, from `reactivescript/ref`):
  `node --experimental-strip-types -e '…loadModules("main.rx", …); checkModules(set)'` (see README "Repros").
- Observed: `UNHANDLED_FAILURE main.rx:4 a reader of value at reader.rx:3 (in <Reader>) (in <App>) can fail with
  Absent and no catch or errored boundary above it discharges Absent`.
- Expected: no diagnostic; both aliases name one declaration (R-f-1 identities are declarations, not spellings).
- Cause: failure classes are tracked by local alias names in `ref/src/check.ts` (for example the
  `errclass`/`import` lookups that return `e.f.name`). The old prototype's fix was a cross-cutting
  `errorKey` refactor of check.ts and signature.ts (`patches/legacy-f3c6771/ref_src_check.ts.patch`).
- Rust: `compiler/src` mirrors the checker (crate parity, ref/crate.ts). A reference-only fix would diverge from the
  crate; the Rust side has not been examined or patched.
- Affected suites: `failure-identities.test.ts` (most cases) and `contracts.test.ts` typed-failure cases.

## 2. `parseProgram` does not terminate on some non-program inputs (reference parser)

- Repro: `parseProgram("<p>x</p>}")` never returns (killed after 10 s); several TSX fragments behave the same.
- Expected: a ParseError (as for other malformed input).
- Impact here: none on lowering (TSX is parsed by Oxc), but tooling that probes arbitrary strings with the RX parser
  must guard against it; `scripts/find-legacy-rx-views.ts` therefore only parses literals in RX positions.
- Rust parser behavior on the same input was not checked.
