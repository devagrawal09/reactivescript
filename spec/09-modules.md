# 09 — Modules

**Status: OPEN (2026-10-23).** A program is a set of `.rx` modules. This
document says what an import binds, what crosses a module boundary, and what
the checker knows about another module (its signature, never its body). It
makes 08 CN-4b executable. `ref/src/modules.ts` loads a program,
`ref/src/check.ts` checks it module by module, and all three runners execute
it: the interpreter, the Solid oracle, and the compiler, which emits one ES
module per `.rx` module. `S-module-1` and `S-app-shop` cover it.

Rulings: file = module (07, 2026-10-22); a module boundary is a value
boundary (07 §1, 2026-10-22). The rest was taken by default and ruled 2026-10-26 —
see the list at the end.

---

## MO-1 — Instantiation

- **MO-1a.** `import { a, b as c } from "./x.rx"` binds names that `x.rx`
  exports. The path is relative to the importing file.
- **MO-1b.** Each module is instantiated **once per app**: its top-level
  sources, equations and effects exist once, and every importer reads the
  same ones. Module-level state is app state — not a JS module variable: on
  the server an app is a request (SV-4), so nothing in it outlives or is
  shared beyond its request. Dependencies are instantiated before their
  importers.
- **MO-1c.** [ruled 2026-10-25] A module has no markup at its top level
  (`TOP_LEVEL_MARKUP`). The app's view is the entry module's default
  component, `export default component App() { … }`: the runtime mounts it,
  as Solid's `render(() => <App />, el)`. A module imported for its exports
  may have a default component too; it is a component like any other.

## MO-2 — The value boundary

- **MO-2a.** An imported source is read-only in the importing module:
  `x := …` and `optimistic x := …` through an import are
  `WRITE_TO_NON_SOURCE` (rule MO-2). The exporting module exports actions as
  its write interface (`export action select(id) { selected := id }`).
- **MO-2b.** `refresh x` and `affects x` of an imported question are
  allowed: they ask, they do not write.
- **MO-2c.** Reading an import is an ordinary read: rows, holds and lanes are
  the same as for a local name (`latest discount` in `main.rx` over
  `catalog.rx`'s question, S-app-shop instant 5).

## MO-3 — Signatures

A module is checked against its imports' **signatures**, never their bodies
(CN-4b). The checker infers a signature for every export.

| export | what an importer sees |
| --- | --- |
| `source x` | a read-only reactive name; its rows (`pending`, `lane`, `fails(…)`); whether it is a question |
| `x = e` | its rows, including `io` when it is bound to an io value |
| `fn f(ref a, b)` | its parameters (value or `ref`, E-9), whether it instantiates (RG-6), its rows, and what a promise it returns rejects with (R-f-8) |
| `action f` | `io` (R-io-2); it never fails (R-f-6) |
| `error C(…)` | an error class (R-f-1) |
| `component C` | its **summary**, below |

A component's summary is what the static application tree needs from it
(R-f-5, RG-7b), reduced to the component's own boundary:

- **what escapes its root:** the failure classes its own readers (and the
  components it applies) let out, which continue at each place it is
  applied, and the provisions it `use`s that nothing inside it provides;
- **per prop:** the classes discharged on *every* path from the
  component's reads of that prop to its root. A class not in that set comes
  out at the application with that application's argument. For
  `children`, the same holds for provisions. A prop an action reads also
  records what the action catches: an argument with another class is
  refused at the application (R-f-6).

The summary is exact for the checks it serves: a class escapes a set of
paths iff it is missing from the intersection of what the paths discharge.

`ref/check.ts --signature file.rx` prints a program's signatures as `.d.rx`
text (display only — reading a `.d.rx` in place of its module is not in
`ref/` yet):

```
export source products: pending fails(Error)   // a question
export discount: pending fails(Error)
export pure fn qtyOf(id)
export action setCoupon
export component Panel(props: { title; children: catches(Error) })
export context who: string
export component Badge(props: {}) uses(ui.rx#who)
export component Save(props: { v: action catches(nothing) })
```

## MO-4 — Rows at the boundary

- **MO-4a.** An `.rx` import's rows are its signature's. Neither escape
  applies: `import pure { f } from "./x.rx"` where `f` is `io` in the
  signature is `IMPORT_ROW_MISMATCH`, and `fails A | B` on an `.rx` import is
  `IMPORT_ROW_MISMATCH` (both assert rows at the JS boundary only — R-io-4,
  R-f-8, CN-5).
- **MO-4b.** Without `pure`, an `.rx` import is not `io` unless its signature
  says so: a pure `fn` from another module is callable in reactive scope.

## MO-5 — No cycles

- **MO-5.** Modules that import each other in a cycle are `MODULE_CYCLE`.
  Signatures are computed dependencies first; a cycle has no first. (JS
  allows cycles between modules; Rust allows them between a crate's modules
  but not between crates. Here every module is checked as its own unit.)

## MO-6 — Names

- **MO-6a.** Importing a name a module does not export is `NOT_EXPORTED`;
  an `.rx` path that does not resolve is `MODULE_NOT_FOUND`.
- **MO-6b (Lexical across modules).** An imported component, `fn` or
  action resolves names where it was declared, never where it is applied
  (RG-7a). `ui.rx`'s `Badge` calls `initials` from `store.rx`, which
  `main.rx` does not import (S-module-1). The runtimes follow: a binding
  carries its declaring region, and a component's region is owned at the
  application but resolves names from the declaration.
- **MO-6c.** An export is a declaration at the top level of a module.
  `export type T` is importable (`import { T } from "./x.rx"`) and binds no
  value: types are text to the checker (07 §2). (The first text refused the
  import, found by S-ai2-settings.)

## MO-7 — Contexts across modules

- **MO-7 (ruled 2026-10-23).** A context is a declaration (RG-7a), so it
  crosses modules like any export: `export context who: string` in
  `ui.rx`, `import { who } from "./ui.rx"` and `provide who = …` in the
  module that renders `Badge` (S-module-1). Two modules that each declare
  `accent` declare two contexts, and a provision of one is not a provision
  of the other (S-context-1). An imported component's summary names the
  contexts it needs by declaration (`uses(ui.rx#who)`), checked above each
  place it is applied. An exported context's type is its contract on both
  sides (RG-7e): a provider in one module and a reader in another agree
  through the declaration, not through each other.

## MO-8 — Declaration files for JS modules

- **MO-8a.** A JS module may have a declaration file beside it: for
  `import … from "./api"`, the file `./api.d.rx` (an extension `.js`,
  `.mjs` or `.ts` on the import is dropped). It declares each export in
  rows, once, in the same notation as an `.rx` signature (MO-3):

  ```
  export pure fn fetchUser(id: number) rejects(NotFound | Offline)   // safe to call from reactive scope (R-io-4); its promise rejects with these (R-f-8)
  export fn saveUser(id: number, name: string) rejects(Offline)     // io: dirty is the default
  export error NotFound                                             // a JS class that is an error class (R-f-1)
  export type User = { id: number; name: string }
  
```

  `pure` is still the only row word that lowers taint and points one way;
  `rejects(…)` defaults to `Error`. In every `.d.rx` — written for a JS
  module or printed for an `.rx` one — `pure fn` is pure, `fn` is io, and
  `action` is an action.
- **MO-8b.** With a declaration file, the file is the row, as a signature is
  for an `.rx` import (MO-4a): an import that names an undeclared export is
  `NOT_EXPORTED`; `pure` on the import must agree (`IMPORT_ROW_MISMATCH`
  for an io export); `fails` on the import is refused. Without one, a JS
  import is what R-io-4 and R-f-8 say: io unless `pure`, `fails(Error)`
  unless narrowed at the import. The declaration is unchecked against the
  JS, as `pure` is (CN-5): it is the boundary's one statement, written once
  instead of at every import (S-module-2).

---

## Diagnostics this document adds

| code | bin | rule |
| --- | --- | --- |
| `WRITE_TO_NON_SOURCE` (rule MO-2) | S | MO-2a |
| `IMPORT_ROW_MISMATCH` | S | MO-4a |
| `MODULE_CYCLE` | S | MO-5 |
| `NOT_EXPORTED`, `MODULE_NOT_FOUND` | S | MO-6a; MO-8b for a declared JS module |
| `CONTEXT_NOT_FOUND` across modules | S | MO-7, RG-7b |

## Implementation

- `ref/src/modules.ts` loads an entry and every `.rx` module it imports,
  sets each import's resolved key, orders them dependencies first, and
  reports cycles and missing modules. Scenarios declare modules in a
  `## Modules` section (fences beginning `-- module: ./x.rx`); a `file:`
  program finds its modules beside it on disk.
- `checkModules` checks each module in that order, against the signatures
  computed so far, and produces its signature. The failure check (R-f-5)
  and the provision check (RG-7b) are one pass over the static application
  tree: each step up from a reader records what it discharges — failures at
  a boundary or a catch, provisions at a `provide` — and an imported
  component's summary is one such step.
- The interpreter instantiates each dependency in a region of its own; the
  oracle declares it in a scope of its own inside the mounted root. The
  compiler emits `mN.mjs` per dependency — a factory over the app that
  `__rt.module` runs once — and `main.mjs` for the entry, which
  instantiates its dependencies at the start of its view.

## Decisions (all ruled; the last open ones 2026-10-26)

1. **Module state is a singleton per app** (MO-1b; ruled 2026-10-26), as module-level
   signals are in Solid.
2. **No import cycles** (MO-5; ruled 2026-10-26).
3. **`.rx` rows are the signature's** (ruled 2026-10-26): `pure` must agree and `fails` is
   refused on an `.rx` import (MO-4a).
4. **Contexts are declared** (MO-7, ruled 2026-10-23). The keyword
   `context`, and defaults allowed except on a `source` context, ruled
   2026-10-26 (07 #13). Ruled 2026-10-26 with the rest: an exported context's type is its contract, a
   module's own context infers its rows unless it writes them.
5. **The `.d.rx` notation** (ruled 2026-10-26): `catches(…)` on a prop is what the component
   discharges for it; `action catches(…)` is what an action reading it
   catches; `fails(…)` after a component is what escapes its root;
   `uses(…)` the provisions it needs.
