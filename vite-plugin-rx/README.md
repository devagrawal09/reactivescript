# vite-plugin-rx — `.rx` in a Vite app (prototype)

ReactiveScript's front end for Solid's Vite plugin. It compiles `.rx`
modules with the crate (`compiler/`, `rxc app`) and hands them back through
the plugin's `frontends` option.

```js
import rx from "reactivescript/vite-plugin-rx";
import solid from "@solidjs/vite-plugin";

export default {
  plugins: [solid({ frontends: { ".rx": rx() } })],
};
```

`frontends` is not released yet. It is proposed in two upstream PRs:

- solidjs/solid-vite-plugin: the `frontends` option. A front end is
  `compile(source, { id, moduleId, ssr, root, solid, addWatchFile })` returning
  `{ code, map, css }`, where `solid` is the compiler options the plugin
  would use for a JSX module in that environment.
- solidjs/solid: the compiler's secondary passes (directives, lazy, refresh,
  source names) accept any file extension. Server-function IDs hash the
  filename, so the passes must see the real `.rx` path.

## What happens to a `.rx` module

- **Entries find themselves.** JavaScript imports only a program's entry,
  whose default export mounts the app. A dependency is a factory over the
  app (09 MO-1b), and only `.rx` imports it. So an `.rx` module imported
  plainly is an entry, with no option naming it.
  - The program is checked and compiled whole from the entry, because a
    module's lowering depends on its imports' signatures (spec/11 CP-2). It
    is compiled once per target and again after any change to one of its
    files; the other files are registered with `addWatchFile`.
  - The crate's output imports dependencies as `./x.rx?rx-dep` (the
    plugin's `moduleId` carries the query), and a dependency is served from
    the build of a program that contains it.
  - A module two programs share is one module. `__rt.module` keys its
    instance by the factory itself in this build, not by its place in a
    program (CP-4b).
  - A failed check fails the module's transform with the checker's
    diagnostics, at the `.rx` line.
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
item, both in the production build and under the dev server. A page with
two programs that share `shop/catalog.rx` bundles one catalog module and
mounts both. 14 pass.

Not yet done:

- **HMR.** The refresh pass now runs on the output, but hot updates of
  `.rx` modules are untested.
- **Server rendering** is not wired. That needs Solid's plugin in SSR or
  start mode, together with the server runtime (`ref/compile/rt-server.ts`)
  and the request-scoped app that server functions run in.
- **Spawning `rxc`.** `rx()` spawns the `rxc` binary. A real package would
  use a Node-API build of the crate, as `@solidjs/compiler` does.
