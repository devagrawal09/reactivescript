# Slice 8 — declarations generated from TypeScript (contract, v3)

**v2 (slice 8b, branch `slice8b/helpers`, 2026-11-25), user decisions:** RX facts in a `.ts` are stated **only** with
zero-cost *helpers* from `@reactivescript/js`. That package was `@reactivescript/types`; it is renamed now that it
carries runtime. The v1 brand types stay in the package as what the generator also reads, but they are no longer
documented. Sections 1, 4, 7 and 8 below are superseded by §0.

**v3 (slice 8c):** `ref` and `instantiates` imply `pure`. RX has no warning tier. Rows on local TS imports are errors.

## 0. Helpers

```ts
import { pure, rejects, ref, instantiates, server, client } from "@reactivescript/js"

export class NotFound extends Error {}
export const fetchUser = pure(rejects([NotFound], async (id: number) => (await get(`/u/${id}`)) as User))
export const fmt = pure((n: number) => n.toFixed(2))
export const createToggle = ref({ result: [0] }, (initial: boolean) => createSignal(initial))
export const createDebounced = ref({ args: [0], result: true }, (source: Accessor<string>, ms: number) => …)
export const listen = instantiates((el: EventTarget, type: string, h: (e: Event) => void) => …)
export const getSecret = server(async () => …)
export async function save(u: User) { … }          // no helper: io, rejects(Error), the conservative default
```

| helper | `.d.rx` fact |
| --- | --- |
| `pure(fn)` | `pure fn` (R-io-4; unchecked, CN-5) |
| `rejects([A, B], fn)` | `rejects(A \| B)` (R-f-8). The classes are **values**: an array literal of error classes, each reaching `Error` |
| `rejects([], fn)` | `rejects(nothing)` (slice 8d): io, and its promise never rejects. A written `.d.rx` may say `rejects(nothing)` too, and the brand form `Rejects<P, never>` means the same |
| `ref({ args?: number[], result?: true \| number[] \| string[] }, fn)` | `ref` parameters (indices), and a `ref` result (`true`), tuple parts (indices) or object properties (keys) (MO-10a/b). The spec is a literal |
| `instantiates(fn)` | `instantiates`, for a primitive with no `ref` (MO-10a) |
| `server(fn)` / `client(fn)` | `server fn` / `client fn` (SF-5) |

- **One way to compose: nesting.** Helpers wrap each other in any order, each at most once:
  `pure(rejects([E], fn))`. Server and client exclude each other. `ref` and `instantiates` imply `pure`; combining
  any two of those wrappers is a TypeScript error and `DECLARATION_HELPER` if it reaches the generator.
- **Where:** the helper call is the whole initializer of an exported `const` (`export const f = pure(…)`), or an
  `export default pure(…)`. Re-exports are followed as in v1. A helper call anywhere else, a non-literal `ref` spec or
  `rejects` list, a member that isn't an `Error` class, a duplicate helper, or `server` with `client` is
  **`DECLARATION_HELPER`** (renamed from `DECLARATION_BRAND`), reported at the call in the `.ts`.
- **Types:** each helper preserves `fn`'s call signature, so inference flows through and no return type is written. Its
  arguments are typed against `fn`: `rejects` takes `readonly (abstract new (...a: any[]) => Error)[]`, and `ref`'s
  indices and keys are checked against `fn`'s parameters and result. The projection still takes the export's types
  from TypeScript (TY-4b); `ref` positions read as `T` (TY-4d).
- **Runtime:** each helper is an identity function today (`sideEffects: false`, marked `/*#__NO_SIDE_EFFECTS__*/`).
  All of them go through one internal hook (`__setHook(h)`; `h(kind, fn, meta)` returns the function to export) so that
  later work (dev checks, call recording) adds behaviour without changing the surface. The error classes given to
  `rejects` reach the hook as values.
- **Unannotated** exports keep v1's conservative default (§2).
- **Import rows (MO-11e):** on a local TypeScript import, `import pure`, `fails(…)`, `server` and `client`
  are **`IMPORT_ROW_ON_TS`** errors. The error gives the exact fix, for
  example ``in api.ts, `export const fetchUser = pure(…)` (`@reactivescript/js`), then import it without `pure` ``, or
  `rejects([A, B], …)` for `fails(A | B)`. A package import with no sibling TS module keeps R-io-4's narrowing.
- **Tooling labels:** the origin is `written` / `helper` (with the helpers used) / `default`. The model field is
  `decl.helpers`. The map badge reads `helper`.

---

(v1 follows; where it disagrees with §0, §0 wins.)


Branch `slice8/dts` (worktree `../rx-slice8-dts`, from `rx/integ`). Spec: 09 **MO-11** (new), MO-8b/8d/8e
amended; 13 **TY-4b** amended, **TY-4d** new; `guide/libraries.md`, `guide/diagnostics.md`.

Problem (rounds 3–4): a JS/TS module's rows lived only in a hand-written `.d.rx` that duplicated the TS
types, hid every export it did not mention (`NOT_EXPORTED`), and was the only way to erase a type-only
import. Now the declaration of a module TypeScript can read is **generated from it**. RX-only facts are
written in the `.ts` as type-level brands. A `.d.rx` beside it overrides single exports.

## 1. Brands — `@reactivescript/types`

Types only, zero runtime (`types/index.d.ts`, `"sideEffects": false`, no JS). Every brand is a plain alias,
so it costs nothing at a use site: TS checks the implementation against the type and then forgets the brand.
The generator reads brands from the **syntax as written**: a type reference whose name resolves, through
imports and aliases of the import, to the declaration in `@reactivescript/types`. A local alias of a brand
(`type P<T> = Pure<T>`) is not followed. A brand is read where it is written.

```ts
export type Pure<R> = R;
export type Rejects<P extends PromiseLike<unknown>, E extends Error> = P;
export type Ref<T> = () => T;                 // Solid's Accessor<T>
export type Instantiates<R> = R;
export type Server<R> = R;
export type Client<R> = R;
```

**Where a brand goes: the return type of the export's call signature.** This is the one place that works for
`export function f(…): …`, `export const f = (…): … =>` and `export const f: (…) => … = …`. The only
exception is `Ref`, which also marks a parameter. The *wrapper* brands (`Pure`, `Rejects`, `Instantiates`,
`Server`, `Client`) nest at the head of the return type in any order, each at most once. Inside them is the
result. `Ref` marks the result itself, a top-level element of a returned tuple type, or a property of a
returned object type literal (MO-10b: only the result and its parts).

| in the `.ts` | `.d.rx` fact it generates |
| --- | --- |
| `f(…): Pure<R>` | `export pure fn f` (R-io-4: safe in reactive scope; unchecked, CN-5) |
| `f(…): Rejects<Promise<T>, A \| B>` | `rejects(A \| B)` (R-f-8). Each member is a class whose base chain reaches `Error` |
| `f(p: Ref<T>)` | `ref p` (MO-10a: an accessor argument) |
| `f(…): Ref<T>`, `[Ref<T>, …]`, `{ k: Ref<T> }` | `ref T` result or part (MO-10b) |
| `f(…): Instantiates<R>` | `instantiates`. Write it only where no `Ref` is present, as in `.d.rx` |
| `f(…): Server<R>` / `Client<R>` | `export server fn` / `export client fn` (12 SF-5) |
| `export class C extends Error` (a TS fact; no brand) | `export error C` |
| `export type T` / `export interface T` | `export type T`: binds no value and erases from the runtime import (MO-8d) |

No `Io` brand: io is the default, so an `Io` brand would be a second way to say the same thing.

## 2. The default (no brand) — always sound

| export | generated line | meaning |
| --- | --- | --- |
| something with a call signature (function, arrow const, callable) | `export fn f(a, b?, ...c)` | io (R-io-4), rejects `Error` (R-f-8), not instantiating |
| class extending `Error` | `export error C` | an error class (R-f-1) |
| type alias, interface | `export type T` | type only, erased |
| any other value (`const`/`let` non-callable, other classes, enums, namespaces) | `export const x` | a JS value: what an undeclared JS import is today (io if called) |
| `export default …` | the same rows, under the name `default` | |

Re-exports (`export { f } from`, `export *`, `export { f as g }`, import-then-export) follow the alias to the
original declaration and read brands there. That may be any file TS resolves, including a package's `.d.ts`.
**Overloads:** every overload signature must carry the same brands with the same arguments and the same `Ref`
positions, else `DECLARATION_BRAND`. When they agree, their rows are the rows. A body with overloads is not read.

## 3. The generated text

It is ordinary `.d.rx`, and it is what `rx-dts` prints and what the MCP shows. Types are printed **for
display**: the written annotation's text with `Ref<X>` shown as `ref X` and the wrapper brands peeled off.
Without an annotation, TypeScript's `typeToString` is used. A type that cannot be printed shows as `any`.
The checker reads only rows from a generated line. The projection takes that export's types from TypeScript
(TY-4b), never from this text.

```rx
// generated by rx-dts from ./api.ts: rows only; the types are TypeScript's (13 TY-4b)
export pure fn fetchUser(id: number): Promise<User> rejects(NotFound | Offline)
export fn saveUser(id: number, name: string): Promise<void>
export error NotFound
export type User
export const fields: readonly Field[]
export pure fn createDebounced(ref source: string, ms: number): ref string
```

Grammar added, both in generated and hand-written files: `export const x: T` (a value export with default
rows, which replaces "expose it through `getValue()`"); a rest parameter `...xs: T[]`; the name `default`; and
a bodiless `export type T` / `export type T<A>`, which only a generated declaration may write. In a written
file that last form is `PARSE` "a type needs `= …`".

## 4. Precedence and overrides

For a relative JS import `./api` (an extension `.js`/`.mjs`/`.ts` dropped, as in MO-8a):

- **T**: the TS module for the stem, found in this order: `api.ts`, `api.tsx`, `api.mts`, `api.cts`,
  `api.d.ts`, `api.d.mts`, `api/index.ts`, `api/index.tsx`, `api/index.d.ts`.
- **W**: `api.d.rx`, if that file exists.

| T | W | the import's declaration |
| --- | --- | --- |
| no | no | none: R-io-4 / R-f-8 (unchanged) |
| no | yes | W, all of it (MO-8b, unchanged) |
| yes | no | generated G |
| yes | yes | per export: W's line where W declares the name, else G's line. W's type imports and private types serve W's lines. A name W declares that T does not export is `NOT_EXPORTED` at W's line |

Per fact: **written (W) > brand (T) > import-site narrowing > default.** A fact is *defaulted* when its line is
generated and no brand set it. `import pure { f }` and `fails(…)` / `server` / `client` on the import are
R-io-4's and R-f-8's unchecked narrowings, and they remain allowed **only on a defaulted fact**. On a branded or
written fact they are `IMPORT_ROW_MISMATCH` (MO-8b). This keeps every existing `import pure` from a `.ts`
compiling. Package imports (MO-10c) are unchanged: a shipped `.d.rx`, else R-io-4. Packages are not generated
in this slice.

## 5. Where the generator runs: one generator, `compiler/dts.mjs`

`createDeclarations({ ts? })` returns `{ record(stem, files?) }`. It keeps one TS LanguageService per tsconfig
root, so the program is incremental. The record is
`{ from, text, errors: [{ file, line, column, code, message }], files }`. `files` lists every file read, for
staleness. A stem with no T gives `null`.

The crate learns of G through the `read` every host already gives it, at the reserved key
**`rx-dts:<absolute stem>`**. The answer is the record as JSON. This is the same in ref and the crate. The
loader keeps the merged declaration under `<stem>.d.rx` (the existing key, whether or not the file exists) and
records its origin (`written` / `generated` from `from`).

| host | how `rx-dts:` is answered |
| --- | --- |
| Vite front end (`vite.mjs`, napi) | in process: `app`/`model` take a trailing `declare(stem) → string \| null` callback. Each T file in `files` is stamped and watched |
| rx-tsc / language server (WASM) | in process: the `rx_read` host answers the key |
| MCP / rx-map (`project.mjs`) | the napi path passes the callback. With `$RXC` set, see the native line |
| `rxc` native (and napi with no callback) | `read_disk` spawns `$RX_DTS`, else the nearest `node_modules/.bin/rx-dts`, as `--record <stem>`. That command caches in `<nearest node_modules>/.cache/rx-dts/` and is fresh while `files`' mtimes and sizes match |
| ref runners (`ref/`) | in process, over the scenario's in-memory files. Conformance passes the records to `rxc conform` in `files` |
| a person | `rx-dts src/api.ts` prints the text; `--json` prints the record |

Generated files are never written beside sources.

## 6. Types (13)

- **TY-4b (amended).** A *written* line (W) types its export with its text, as today. A *generated* line types
  it with TypeScript's own declaration: the projection imports the name from the module
  (`import { f as __js_f } from "./api"`), so generics, overloads, classes, enums and type exports are TS's.
- **TY-4d (new).** A generated fn with `Ref` positions is seen through its rows. A `Ref<T>` parameter takes `T`,
  and a `Ref<T>` result or part reads as `T`. The prelude's `__.ReadAt<P, I>`, `__.ReadResult<R, Shape>` map
  `typeof __js_f`'s parameter tuple and result. In a *generic* fn those positions are `any`, because TS cannot
  map a generic signature. The cost is loss of precision only, never a false error.

## 7. Failure modes (new codes, bin S, spec/99)

| code | rule | when |
| --- | --- | --- |
| `DECLARATION_BRAND` | MO-11c | A brand the generator cannot read as a fact: a wrapper brand not at the head of a return type or on a non-callable export; a duplicate wrapper; `Server` with `Client`; `Ref` deeper than a result part, or on an optional, rest or destructured parameter; a `Rejects` member that is not an `Error` class (or `never`); overloads that disagree. Reported at the brand, in the `.ts` |
| `DECLARATION_UNAVAILABLE` | MO-11d | T exists, but no generator answered: native `rxc` without `rx-dts` or TypeScript, or a module TypeScript cannot read as an ES module (`export =`). The message names the fix (`npm i -D @reactivescript/compiler typescript`, or set `RX_DTS`) |
| `NOT_EXPORTED` (existing) | MO-11b | A W line names an export T lacks, or the `.rx` imports a name T lacks |

A TS type error in T is TypeScript's to report (rx-tsc). The generator reads syntax and symbols. It does not
require T to type-check.

## 8. Tooling

- MCP `check` reports MO-11's diagnostics like any other. MCP `node` on an imported name shows the effective
  line, `from` (W or T), and `origin`: `written`, `brand` (listing the brands) or `default`.
- The model (`rxc model`) gives each JS-import symbol `decl: { line, from, origin, brands }`.
- The map's "outside the program" column marks each import `brand` / `default` / `d.rx` (a small tag).

## 9. Verification

- Generator unit tests: every brand, defaults, generics, overloads (agree and disagree), re-exports, type-only
  exports, classes, enums, default export, and misplaced brands.
- Scenario `S-module-8` (a `.ts` with no `.d.rx`; brands; an override; a type-only import) on every runner.
  ref/crate parity: conform, `--lower`, `--project`.
- rx-tsc / LSP tests; MCP tests; a Vite test where `.rx` imports from a `.ts` with no `.d.rx`.
- `examples/` migrated. A local repro, `r4-dts`, is a copy of rx-r4-mcp with
  every shadow `.d.rx` deleted. It must build, typecheck and test.
- Production output is byte-identical for every existing scenario and example whose inputs this does not
  change. That covers every program with no T, and every program whose T imports are all declared in W.
  The diffs that remain are listed, with the reason for each.
