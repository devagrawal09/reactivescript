# vite-plugin-rx — `.rx` in a Vite app (prototype)

A Vite plugin that compiles `.rx` modules with ReactiveScript's crate
(`compiler/`, `rxc app`) and hands them to `@solidjs/vite-plugin` as
ordinary JavaScript.

```js
import rx from "reactivescript/vite-plugin-rx";
import solid from "@solidjs/vite-plugin";

export default {
  plugins: [
    rx({ entry: "src/main.rx" }),                         // before Solid's plugin
    solid({ include: ["src/**/*.{jsx,tsx,ts,js,mjs,rx}"] }),
  ],
};
```

## What happens to a `.rx` module

- **Compiled whole.** The plugin checks and compiles the program from
  `entry`, not module by module, because a module's lowering depends on its
  imports' signatures (spec/11 CP-2). It does this once per target, and again
  after any `.rx` or `.d.rx` change.
  - A failed check fails the module's transform with the checker's
    diagnostics, at the `.rx` line.
  - Each module imports its dependencies by `.rx` path, so Vite resolves
    them as usual.
- **Already through Solid.** The crate has already passed each module through
  Solid's compiler (`compile_program`, CP-1c). A server environment gets the
  ssr target; every other environment gets dom, which is hydratable.
- **Source map onto `.rx`.** The module's source map points at the `.rx` file,
  line by line (CP-1c, decision 6).
- **Stylesheet as a CSS module.** The stylesheet is `virtual:rx-styles.css`,
  and the entry imports it (CSS-4).
- **Ordinary JavaScript to Solid's plugin.** Solid's plugin sees `.rx` as a
  non-JSX module, so it doesn't compile it again. With `.rx` in its
  `include`, its server-functions pass extracts `"use server"` (12 SF-7a), as
  it does for any module.

## Status

`node vite-plugin-rx/test.mjs` builds every app in `examples/` with Vite 8
and `@solidjs/vite-plugin` from the solid-next checkout. It then drives each
app in Chromium. For the todo app it adds and toggles an item, both in the
production build and under the dev server.

Not yet done:

- **HMR** is a full reload, because the crate's output carries no refresh
  boundaries.
- **Server rendering** is not wired. That needs Solid's plugin in SSR or
  start mode, together with the server runtime (`ref/compile/rt-server.ts`)
  and the request-scoped app that server functions run in.
- **Spawning `rxc`.** The plugin spawns the `rxc` binary. A real package would
  use a Node-API build of the crate, as `@solidjs/compiler` does.

## The upstream alternative

`@solidjs/vite-plugin` has no hook for another front end:

- `.tsrx` is routed by name inside its transform.
- Custom `extensions` are parsed as JSX text, which `.rx` is not. CP-3 also
  rules out text.

A front-end option in Solid's plugin, for example `frontends: { ".rx": compile }`
returning `{ code, map, css }` for `(id, ssr)`, would let `.rx` take the
`.tsrx` route. Solid's refresh, lazy and source-name passes, CSS handling and
server functions would then apply without this plugin.
