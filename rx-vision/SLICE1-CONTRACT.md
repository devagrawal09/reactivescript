# Slice 1 contract: identity + live overlay

Shared by every workstream. If you need to change it, stop and report back. Do not change it unilaterally.

## Goal

In a dev build of an `.rx` app, every named reactive node carries a stable key as its Solid `name`. The map's graph is
shipped with the dev build. The solid-start-devtools dock gets a "Map" view that draws the rx-map and lights nodes as
real flushes change them. Production builds are unchanged, byte for byte.

## 1. The key

```
<module>|<scope>|<name>[#n]
```

- `module`: POSIX path of the `.rx` file, relative to the project root (Vite's `root` in the front end, the cwd for
  `rxc`). Example: `src/users.rx`.
- `scope`: the enclosing component's name, or the empty string for module scope. Example: `App`; `` for a module-level
  `source page`.
- `name`: the RX binding name.
- `#n`: present only when the same `module|scope|name` is declared more than once in that module, for example in two
  `if` branches. The 2nd declaration in source order is `#1`, the 3rd `#2`, and so on.

Examples: `src/users.rx||users`, `src/users.rx|Row|isEditing`.

The runtime marks it as an RX key by setting the Solid node's `name` option to `rx:` + key, for example
`rx:src/users.rx||users`. One RX declaration may create several Solid nodes (a question = a store plus an optimistic
layer). All of them get the same name.

Which declarations get keys: sources (`source x := …`, `source x = …`) and equations (memos, questions,
keyed/deferred, structured equations). Actions, effects, props and contexts do not get keys in slice 1.

## 2. Compiler / runtime (reactivescript, branch `slice1/identity`)

- The compiler computes the key statically. The resolved model (`ref/src/model.ts`, `compiler/src/model.rs`) gains a
  `key` field on each symbol that gets one, with the same string in both.
- **Emit, dev only:** the TS ref emitter and the Rust crate emitter wrap each keyed declaration's creating call as
  `__rt.key("<key>", () => <original call>)`. Without the dev flag, output is byte-identical to today: every existing
  runner, `crate --lower` and `crate --project` stays green.
- **Runtime** (`ref/compile/rt-web.ts` → `@reactivescript/runtime`): `key(k, f)` sets the current key while `f` runs.
  Each Solid primitive the helpers create while a key is current gets `{ name: "rx:" + k }`. With no key current,
  behaviour is unchanged (`source(name, …)` keeps ignoring `name`). In production builds, `key` is just
  `(k, f) => f()`.
- **Node-API:**
  - `app(entry, target?, moduleName?, spa?, dev?)` gains a trailing `dev` flag.
  - A new `model(entries: string[], root?: string): string` export returns `rxc model`'s JSON, with module paths
    relative to `root`.
- **Vite front end** (`compiler/vite.mjs`):
  - When `context.solid.dev` is true and the target is the client (`dom`), it compiles with `dev`.
  - For a program's **entry** module only, and only if `@reactivescript/map/live` resolves from the project root, it
    prepends:
    ```js
    import { register as __rxMap } from "@reactivescript/map/live";
    __rxMap(<graph JSON from @reactivescript/map/graph buildGraph(model, { root })>);
    ```
  - If the package isn't installed, nothing is added. SSR and production builds never get it.

## 3. Map package (reactivescript, branch `slice1/map`, `tooling/rx-map` becomes `@reactivescript/map`)

- `package.json` name `@reactivescript/map`, `type: module`, exports:
  - `./graph`: `buildGraph(model, { root })`, `addKeys`. Named nodes get `key` = the format in section 1, without
    `rx:`. View sites keep their current keys (module | region path | kind:name). `diffGraphs` must still work.
  - `./page`: `pageHTML(graph, { live?: boolean }) → string`, the full self-contained map page. `rx-map.mjs` uses it too.
  - `./live` (browser): `register(graph)` sets
    `globalThis.__RX__ = { graphs: [...], mount(el: HTMLElement): () => void }`.
    - `mount` puts an `<iframe>` with `srcdoc = pageHTML(mergedGraph, { live: true })` into `el`.
    - It turns on `solid-js/attribution` (`attribution.enable({ log: false, values: "full" })`), released on dispose.
    - It subscribes to the engine's records (see `solid-start-devtools/src/dev-toolbar/timeline/tracker.ts` for how
      the devtools do it).
    - It forwards to the iframe with `postMessage`.
- Messages, iframe ← parent; every message has `source: "rx-map"`:
  - `{ type: "flush", seq, at, changes: [{ name, key, preview?, origin? }] }`
    - `key` is `name` without the `rx:` prefix, or null for non-RX nodes.
    - `preview` is a short string of the new value, at most 80 characters.
  - `{ type: "flight", key, state: "start" | "land" | "abandon" }`, when the engine's flight records carry a
    node name.
  - `{ type: "reset" }`
- **Live mode in the page:**
  - A header badge shows live, with the flush count.
  - A changed chip pulses with a white ring, about 1.2s, so it doesn't clash with the reserved diff colours.
  - Its latest value shows in a small value badge, and in the panel under "Live value".
  - A node with a flight open glows amber until it lands.
  - The Guide tab gains a "Live" note.
  - Unknown keys are ignored.
- A static page (no `live`) behaves exactly as today.

## 4. Devtools (solid-start-devtools fork, branch `feat/rx-map`)

- In the Structure view, a third mode, "Map", appears only when `globalThis.__RX__?.mount` is a function at the time
  the view opens. It calls `mount(container)` and the returned dispose function when leaving the mode.
- No dependency on any `@reactivescript/*` package.

## 5. Done when

- In the `with-reactivescript` template app, linked to these builds and opened in the user's browser on the Mac, the
  dock's Map view shows the app's map.
- Clicking a button lights exactly the chips of the nodes that changed, and their values update.
- A production `vite build` output contains no `rx:` string and no `@reactivescript/map` import.
- Existing checks pass in each repo.
