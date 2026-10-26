# 13 — Types

**Status: executable, 2026-10-25** — `npm run -s types` checks every
scenario's program (and each variant's) and S-types-1's refusals.

Types are TypeScript's (07 §2). This document says how the program is
checked against them: the checker of 08 does not type the program; the
compiler projects the checked program to TSX and TypeScript checks the
projection, with Solid's JSX types — as TSRX's `projectTsrxForTypecheck`
does for `.tsrx`. Nothing here is a second type system.

---

## TY-1 — The projection is checked by TypeScript

- **TY-1a.** After the checks of 08 pass, the program is projected
  (`ref/types/project.ts`): one TSX module per `.rx` module, one `.d.ts`
  per `.d.rx`, and a prelude that declares the language's forms. TypeScript
  checks it (`strict`, with untyped parameters `any`), and every error is a
  compile error (CN-1a), reported on the `.rx` line of the declaration,
  statement or markup item it came from.
- **TY-1b.** The projection is for checking only. It is never run, and its
  order is dependency order (E-7: equations are a system; C-1 makes it a
  DAG).
- **TY-1c.** In the product the compiler emits the projection beside the
  JavaScript (11, CP-1a) and hands it to TypeScript; an editor uses the
  same projection.

## TY-2 — What each form is, as a value

| form | to TypeScript |
| --- | --- |
| `x = e` (an equation) | a `const` of `e`'s type; with `x: T = e`, of `T` (row words such as `pending` are not types, CN-4a) |
| `source x := e`, `source x = e` | with a written type, that type — not what the initializer narrows it to; without one, the initializer's type widened: a literal to its primitive, `null`, `undefined` and `[]` to `any` (they say nothing about later writes) |
| `x := v`, `x.a := v` | `v` (or a function of the slot, W-6) checked against the target's type |
| `await e` | the answer's type (`Awaited`); `await* e` the stream's element type; `-> v` adds `v`'s type |
| `e catch (x: A \| B) => alt` | `e`'s type or `alt`'s; `x` is `A \| B` (untyped: `Error`) |
| `pre x -> i`, `latest e`, `peek e` | the node's own type; `pending? e` is `boolean` |
| `use c` / `provide c = e` | the context's type / `e` checked against it (RG-7) |
| `error C(a: T) => …` | a class `C` (a subclass of `Error` with the field `a: T`), constructed by `C(a)` |
| `fn`, `action`, `server fn` | functions of their parameters; an action and a server fn return a promise |
| `if x { … }` | the branch narrows `x` (RG-1c); a handler is a closure that runs later, and TypeScript's rules for closures apply to it |
| `for x in xs { … }` | `x` is an element of `xs` |

## TY-3 — Views

- **TY-3a.** A view is JSX over Solid's JSX types (`@solidjs/web`): an
  element's attributes, and a component's props where it is applied (its
  `props: P`; children are `P`'s `children`), are checked there.
- **TY-3b.** What a reader may insert is Solid's `JSX.Element`, which takes
  any object (a renderer's value). So inserting a record by mistake is not
  a type error; it stays Solid's `UNRECOGNIZED_INSERT_VALUE`, at run time.
  This follows Solid, which does nothing more.
- **TY-3c.** A component cannot know where it is applied: a module-level
  `Item | null` read in a component is `Item | null` there, whatever branch
  applies it. Pass the narrowed value as a prop, or narrow inside.

## TY-4 — Modules

- **TY-4a.** An `.rx` import carries types: `export type T` crosses an
  import (MO-6c), as does every export's type.
- **TY-4b.** A `.d.rx` is its JS module's `.d.ts`: each function's
  parameter types and return type (`export pure fn f(id: number): Promise<User>`),
  its `export type`s, and its error classes (MO-8). A JS module with no
  declaration file is `any`.

## TY-5 — Rules the projection states as types

- **TY-5a (SF-6a statically).** A server fn's parameters and result are
  checked to be data: a function, or an instance of a class (a `Date`),
  where the types are known is `WIRE_VALUE` at compile time. Where they are
  `any` — an untyped parameter — the run-time check stands.

## Found by the type layer (2026-10-25)

Every scenario type-checked once these were fixed; each was invisible
while types were text:

- **A parser bug.** `source issues: Issue[] key id = …` read `key id` as
  part of the type, so the source lost its key (ST-4) — S-ai2-tracker's
  rows kept identity by luck. Fixed: the type ends where the key begins.
- **Missing type imports** in `examples/shop/ui.rx` (`Product`) and the
  settings example (`Theme`, `Density`, `Settings`), removed when an
  earlier reading said types do not cross an import (MO-6c says they do).
- **A write TypeScript refuses** in `examples/todo.rx`: `for f in ["all",
  "open", "done"] { … filter := f }` writes a `string` to a
  `"all" | "open" | "done"`; the list is now typed.
- **Nullability that held only by where a component is applied**
  (S-ai2-search's `ItemView`, TY-3c), or by a handler running while its
  branch is live (S-ai2-tracker): both now narrow where they read.

## Decisions (all ruled; the last open ones 2026-10-26)

1. **TypeScript checks the projection** (ruled 2026-10-26) — no type system of our own; the
   checker's rules (08) stay the language's, the types TypeScript's.
2. **Strict, but untyped parameters are `any`** (ruled 2026-10-26) (`noImplicitAny` off):
   scenarios and small programs leave parameters untyped; a written type
   is always checked.
3. **A source without a type is widened** (TY-2; ruled 2026-10-26): a source is written
   later, so its initializer's literal type would refuse every other write.
4. **What a reader inserts is Solid's `JSX.Element`** (TY-3b; ruled 2026-10-26), not a
   narrower type of our own. Where more could be done: a narrower
   insertable type would refuse `<p>{record}</p>` statically at no run-time
   cost; noted, not adopted, since it departs from Solid's types.
