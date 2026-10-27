# vite-plugin-rx — `.rx` in a Vite app (prototype)

ReactiveScript's front end for Solid's Vite plugin. It compiles `.rx`
modules with the crate (`compiler/`, `rxc app`) and hands them back through
the plugin's `frontends` option.

```js
import rx from "reactivescript/vite-plugin-rx";
import solid from "@solidjs/vite-plugin";

export default {
  plugins: [solid({ frontends: { ".rx": rx({ entry: "src/main.rx" }) } })],
};
```

`frontends` is not released yet. It is proposed in two upstream PRs:

- solidjs/solid-vite-plugin: the `frontends` option. A front end is
  `compile(source, { id, ssr, root, solid, addWatchFile })` returning
  `{ code, map, css }`, where `solid` is the compiler options the plugin
  would use for a JSX module in that environment.
- solidjs/solid: the compiler's secondary passes (directives, lazy, refresh,
  source names) accept any file extension. Server-function IDs hash the
  filename, so the passes must see the real `.rx` path.

## What happens to a `.rx` module

- **Compiled whole.** `rx()` checks and compiles the program from `entry`,
  not module by module, because a module's lowering depends on its imports'
  signatures (spec/11 CP-2). It does this once per target, and again after
  any change to one of the program's files; the other files are registered
  with `addWatchFile`.
  - A failed check fails the module's transform with the checker's
    diagnostics, at the `.rx` line.
  - Each module imports its dependencies by `.rx` path, so Vite resolves
    them as usual.
- **Already through Solid's compiler.** The crate passes each module
  through `compile_program` (CP-1c) with the plugin's `generate`,
  `moduleName` and hydratable setting.
- **Source map onto `.rx`.** Line by line (CP-1c, decision 6).
- **Then Solid's plugin, as for `.tsrx`.** Its lazy and refresh passes,
  server functions (12 SF-7a), and the entry's stylesheet as a CSS module
  (CSS-4).

## Status

`SOLID_VITE_PLUGIN=../solid-vite-plugin node vite-plugin-rx/test.mjs`
builds every app in `examples/` with Vite 8 and a built checkout of the
plugin branch (its `@solidjs/compiler` linked to the patched compiler). It
then drives each app in Chromium. For the todo app it adds and toggles an
item, both in the production build and under the dev server. 13 pass.

Not yet done:

- **HMR.** The refresh pass now runs on the output, but hot updates of
  `.rx` modules are untested.
- **Server rendering** is not wired. That needs Solid's plugin in SSR or
  start mode, together with the server runtime (`ref/compile/rt-server.ts`)
  and the request-scoped app that server functions run in.
- **Spawning `rxc`.** `rx()` spawns the `rxc` binary. A real package would
  use a Node-API build of the crate, as `@solidjs/compiler` does.
