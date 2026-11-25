# Changelog

## Unreleased

**Added**

- MO-11: a `.ts` module needs no `.d.rx`. Its declaration is generated (`npx rx-dts src/api.ts` prints it). RX facts
  are stated with zero-cost helpers from the new package `@reactivescript/js`: `pure(fn)`, `rejects([E], fn)`,
  `ref({ args, result }, fn)`, `instantiates(fn)`, `server(fn)`, `client(fn)`. A `.d.rx` beside a `.ts` now overrides
  single exports instead of hiding the rest. Type-only exports erase from the runtime import. `export const` is a
  `.d.rx` form.

**Breaking**

- `import pure` / `fails(…)` / `server` / `client` on a local TypeScript import fails with `IMPORT_ROW_ON_TS`,
  naming the helper to write in the TS module. Package imports without a sibling TS module are unaffected.
- `ref` and `instantiates` already imply `pure`. Remove the `pure(…)` wrapper around either helper.
- An import of a name a `.ts` module does not export is `NOT_EXPORTED`. A `.ts` module that no generator can read,
  such as native `rxc` without `@reactivescript/compiler`'s `rx-dts` and TypeScript, is `DECLARATION_UNAVAILABLE`.

- MO-8c: a real `./api` implementation beside the importing module wins over the injected test API, even if
  `createApp({ api })` is set. A test API call with no injected implementation now throws `MISSING_TEST_API`.
- Ordered error arms replace annotated catches and fallbacks and same-content nested typed handlers.
  Put the inner handler first and a catch-all last as `_`. `LEGACY_TYPED_HANDLER`, `ERROR_ARM_ORDER`,
  `UNREACHABLE_ERROR_ARM`, and `MISSING_ERROR_ARMS` are new errors; `DEAD_TYPED_BOUNDARY` is removed.
  See [the surface rules](spec/07-surface.md#5-imperative-scope-02-sc-2-06-ac) and
  [ordered error arms](spec/ordered-error-arms.md).

  Before:
  ```rx
  try {
    try { await save() } catch (e: Conflict) { showConflict(e.version) }
  } catch (e) { report(e.message) }
  ```

  After:
  ```rx
  try { await save() } catch (e) {
    Conflict => { showConflict(e.version) }
    _ => { report(e.message) }
  }
  ```
- `STYLE_SCOPE` rejects a style block outside a supported style scope; move it into the component that owns the view.
- String and template escapes are cooked in the compiler; programs relying on the previous literal backslashes
  must escape those backslashes explicitly.
- Multiline JSX whitespace follows the view whitespace rules (07 §4). Use an explicit `{" "}` where spacing
  between pieces must survive.

**Changed**

- `catch` follows only an `await`: `await f(x) catch (e) => alt` makes a matching rejection the answer. A `catch` after
  anything else is the new compile error `CATCH_NOT_ON_AWAIT` (R-f-4). Show a failed value with an `errored` region
  where it is read; in a handler or action, read it inside `try { … } catch (e) { … }`; write validation as a value
  (`""` or a message), not a thrown class.

**Fixed**

- `affects` on a keyed or structured source that takes a guess threw `INVALID_AFFECTS_TARGET` in a dev build, so the
  action never reached its `await`, and did nothing in a production build, so `pending?` stayed false (#50,
  S-affects-keyed).
- A keyed source that takes a guess (`source rows key id = q.rows`) merges each answer by key instead of replacing every
  row, so a row's readers re-run only when its own leaves change (#51).
- The guide's action example (`guide/async.md` §3) lost an error thrown before the first `await`: the `onFlush` clear
  ran after the catch. The catch now writes the error through `onFlush` as well (#52).
- A `catch` expression read with no observer (a component `fn` called from a handler or an action) built a fresh error
  boundary, which had no value while a `refresh` was out, so the click threw `NotReadyError` and was lost. It is now a
  snapshot: the committed value, or the alternative on a matching failure (R-8, S-catch-snapshot).

**New**

- `ARGUMENT_COUNT` (AC-1f): a call of an action declared in the module with another number of arguments than its
  parameters is refused.
- `props` in a component declared without props (`component C()`) is `UNBOUND` (RG-4b); it read `undefined`.
- `guide/async.md`: "One store over the server"; the `GUESS_WHILE_LOADING` advice says what holds when a selection
  changes while a guess is out (05 DV-22).
- `@reactivescript/map` (`tooling/rx-map`): the rx-map as a package. `./live` draws the map beside a dev build and lights
  the sources and equations each flush changes. Named things are keyed `<module>|<component>|<name>`.

## 0.3.1

**New**

- Spread attributes in markup, `<button {...rest}>` and `<Inner {...rest} />`, lowered to Solid's spread and `merge`:
  later attributes override, and each field keeps updating (07 §4, S-surface-5).

## 0.3.0

`@reactivescript/compiler`, `@reactivescript/runtime`, `@reactivescript/language-server` and the editor extension,
together.

**Breaking**

- `UNGUARDED_SNAPSHOT` (R-8) is stricter: an `errored` region or `disabled` covers a failure only when it reads the
  value. A region whose content reads `x` only under `pending? x` never shows its fallback, so it no longer counts
  (#58).

**New**

- Solid libraries (MO-10): declare a primitive once in a `.d.rx` (`export pure fn createToggle(v: boolean): [ref
  boolean, (v: boolean) => void]`) and use it like .rx: it is called once, `ref` arguments go in as accessors, readers
  are read without a call, and setters are io. A package's `.d.rx` sits beside the file its import resolves to.
  `guide/libraries.md` (#57).
- The guide (shipped in `@reactivescript/compiler`) places data by its lifetime: what a visit, a write or the screen
  needs, with a module only for data whose writes outlive their page (#58, #59).

**Fixed**

- `refresh` of a keyed equation re-asks it. It used to re-ask nothing in compiled code (#58).

## 0.2.0

`@reactivescript/compiler`, `@reactivescript/runtime`, `@reactivescript/language-server` and the editor extension,
together.

**Breaking**

- `optimistic` is now `guess` (`guess todos := …`), and errors clear with `onFlush` (#47). `optimistic` is no longer
  a keyword.
- A new check, `GUESS_WHILE_LOADING` (AC-3a): a guess written before its value has been shown is an error (#53).

**New**

- `rx-tsc`, in `@reactivescript/language-server`: TypeScript's `tsc` with `.rx` files in the program, for CI (#41).
- `else if` in markup: `{if a { … } else if b { … } else { … }}`.
- A guess over an equation, as Solid's `createOptimistic(fn)` (#48).
- Destructuring (RG-4b): live in declarations, a snapshot in `let`, with rest (#49).
- Parse errors are coded and name the JS or React habit they come from; every code has a page in
  `guide/diagnostics.md`, linked from Vite, `rx-tsc` and the editor (#42).

**Fixed**

- A relative JS import (`import pure { f } from "./util.js"`) compiles to an ES import. It used to fail as "not in
  the scenario prelude", so a package.json `#imports` alias was needed. `./api` is still the app's injected API.
