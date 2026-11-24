# rx-map

A static map of a `.rx` program: where every source, equation, action, function and view site lives, and how they read,
write and call each other and the JS world outside the program. Nothing runs. The map is drawn from the checker's
resolved model (`rxc model`, spec/11 CP-6), so it shows what the program *can* do, which is also all the checker knows.

```sh
cargo build --release --manifest-path compiler/Cargo.toml     # once, for rxc
node tooling/rx-map/rx-map.mjs examples/notes/main.rx -o notes.map.html
node tooling/rx-map/rx-map.mjs examples/users.rx --json       # the graph, for other tools
```

`rxc` is found as `$RXC`, then `compiler/target/{release,debug}/rxc`, then on `PATH`. Give the entry module: the model
follows its `.rx` imports, and each module gets a column. The output is one HTML file with no dependencies.

## Reading it

- **Everything points up.** A thing sits below what it depends on, so every arrow points up to what it needs:
  - JS imports are on top, then modules in import order;
  - components sit below the components they render;
  - inside a frame, each row is one step deeper: sources, then equations over them, then actions that write them,
    then the view;
  - a read's arrow points at what it reads.

  Siblings with no order between them sit side by side: modules on one level, independent components, then and else.
  An arrow that has to point down is routed round the side, so it stands out.
- **Frames are regions**: a module, a component, an `if` branch, a `for` row, a `loading` or `errored` boundary.
  Everything inside a frame is created and disposed with it.
- **Control flow is colour coded**:
  - Branches (`if` / `else`) are sky and solid. Rows (`for`) are silver and stacked.
  - Boundaries are dashed: `loading` amber, `errored` red.
  - Each header shows the construct from the source (`if isEditing`, `for u in users`, `loading on(query)`,
    `errored (e: NotFound)`), plus a `reads …` chip for what its condition, list or key reads.
- **Boundaries list what can notify them.**
  - A `loading` boundary lists the names that can be pending under it ("pending from users"). They are found by
    walking up from the readers it covers, through tracked reads only.
  - Readers under a nested boundary of the same kind don't count. Readers in components rendered inside it do.
  - Probes (`latest`, `pending?`) and handlers never notify.
  - An `errored` boundary lists the async names under it, because every `await` can reject. A typed
    `fallback(e: C)` lets other failures through to the boundary above.
  - Dotted amber or red edges point from a boundary up to its notifiers. Select a boundary to see which reader brings
    each one in.
- **Colour is the role, and only the role.** Each property gets its own channel, so any combination reads at a glance:
  - **Role colours:**
    - state (sources) is blue;
    - derived (equations, props, view reads) is teal;
    - imperative (actions, handlers, effects) is orange;
    - outside (JS imports, server fns, plain fns) is slate;
    - structure (components, contexts, props passed) is violet;
    - failure (error classes) is rose.
  - **Shape, fill and icon** say the role; no role is written on a token (hover one for its role in words):
    - a source is a filled blue well;
    - an equation (and props, view reads) is outlined teal with a gradient and an ƒ;
    - an action is an orange chevron with a bolt; a handler is a small chevron;
    - an effect is a hollow orange ring;
    - JS imports, server and plain functions are slate tokens with a plug;
    - components, contexts and props passed are violet frames; error classes are rose, with a warning sign.

    A view site is the squarer, smaller version of its role's token.
  - **Marks**, on any role:
    - ⧗ and stripes: can be pending (it awaits);
    - **?**: re-asks a standing question;
    - **↗**: touches the world (io);
    - dashed border: a trust point.
  - **Two accents** cut across roles: amber for pending (⧗, `loading`, probes) and rose for failure (`errored`, error
    classes).
- **Diff has its own channel:** an outer ring and a corner badge, in green / magenta / red, which are used for nothing
  else.
  - A removed name keeps its role colour, ghosted.
  - On a changed name, the mark that changed is underlined (e.g. ⧗ when it became async).
  - Changed edges keep their own colour and dash, with a glow underneath.
- **Edges: colour is the relationship, dash is the mode.**
  - Reads are teal: tracked solid, snapshot dashed, `pre` dotted. Probes (`latest` / `pending?`) are amber.
  - Writes are orange: `:=` solid, `guess` dashed, `refresh` dash-dot, `affects` dotted.
  - Props, renders and `provide` are violet. Calls are slate.
  - What can notify a boundary is amber or rose dotted.
- **Hover** a chip to see its edges. **Click** it to pin it, read its line, and trace:
  - **what it affects**: writes and calls go out, then tracked reads carry the change on. A snapshot read stops it.
  - **what it depends on**.
- The side panel opens from the header (`guide · legend`). It has tabs:
  - **Guide** and **Legend**;
  - **Changes**, in a diff, open by default;
  - the selected name, which appears while something is selected.

  Esc clears a selection, which brings back the tab you were on. Esc again closes the panel. Whether the panel is open,
  and on which tab, is remembered.
- **Every legend row is a toggle.** It shows or hides that kind of chip or edge on the map, and shows how many this
  program has. Each section has all / none buttons. While anything is hidden, the header shows `N hidden`, which
  opens the legend. Hidden kinds are remembered.
- `#name`, `#name:down` or `#name:up` in the URL selects or traces a name. `/` focuses search.

## The world and the HUD

The map is a slightly tilted plane under a perspective camera. Modules are plates on it, tokens stand a little off
their plate with a cast shadow, and edges run on the plate surface.

- **Move:** drag to pan (it coasts), wheel or pinch to zoom toward the pointer, `+` / `-` too. Double-click a token to
  fly to it. `F` frames everything; `Esc` clears a selection, then frames, then closes the panel. The world tilts a
  few degrees with the pointer.
- **HUD:** the header, the side panel, the minimap (bottom left: click or drag to go there), the zoom dock with the
  sound toggle (bottom right) and, in live mode, the timeline (bottom centre) float over the world as glass.
- **Code** (the declaration in the panel, tooltips, the guide, diff before / after) is highlighted; a keyword takes
  its role's colour (`source` blue, `action` orange, `await` amber, `component` violet).
- **Sound:** small synthesized cues (hover, select, toggles, flushes pitched by family, flights, travel, reloads),
  only after the first click or key, quiet, and rate limited. The dock's speaker mutes it; that is remembered
  (`rx-map:sound`).
- **Reduced motion** (the OS setting) turns every movement into a short fade: no flights of the camera, no comets,
  no flips.
- A map of more than 900 nodes keeps its tokens in their row's plane, so panning stays cheap.

## Diff: what changed between two versions

```sh
node tooling/rx-map/rx-map.mjs examples/users.rx --diff main          # main → the working tree
node tooling/rx-map/rx-map.mjs examples/users.rx --diff before.json   # a graph saved earlier with --json
```

The tool models both versions itself. It extracts the ref with `git archive` into a scratch dir and runs `rxc model`
there. A text diff alone is not enough, because the checker's facts are whole-program: one edited line can turn a
tracked read into a snapshot far from the edit. Both versions are drawn on one map:

- **Markings**: added is green `+`, removed is red, struck through and dashed, changed is amber `Δ` (for example an
  equation became async, gained `io`, or a source started re-asking). Changed edges are drawn without hovering.
- **The before / after toggle** hides the other side, traces included.
- **"What changed"** leads with behaviour, in this order:
  - what each action can now reach (its "what it affects" set, before vs after);
  - what it now writes, guesses or calls into the world;
  - reads that changed kind (tracked ↔ snapshot);
  - what was added or removed.

  Click an item to light it up.

Matching is by key: a name by its module, component and name (see "Live" below), a view site by its place in markup
(the chain of regions) and what it reads. A rename shows as one removed and one added. Both sides are modelled by the `rxc` you run, so a ref older
than a syntax change (e.g. `optimistic` before `guess`) will not parse.

## Live: the map beside a running dev build

`@reactivescript/map` is this folder as a package. Install it in an app (as a dev dependency) and the Vite front end
does the rest in a dev build: it gives every source and equation's Solid nodes a name, `rx:<key>`, and registers the
program's graph from its entry module. A host, such as the devtools' Map view, then calls `globalThis.__RX__.mount(el)`.

- The map is drawn in an iframe. While it is open, Solid's attribution engine is on, and each flush that changes
  something lights the map:
  - the chips whose value changed flash a white ring;
  - their newest value shows on the chip, and under "Live value" in the panel when one is selected;
  - a chip glows amber while a request for it is in the air, until it lands or a newer one replaces it;
  - the header counts the flushes.
- Only sources and equations are lit. Actions, effects, props and contexts have no key yet.
- A production build has none of it: no names, no graph, no import of the package.

The key of a named thing is `<module>|<scope>|<name>`, for example `src/users.rx||users` or
`src/users.rx|Row|isEditing`:

- `module` is the file, relative to the project root;
- `scope` is the enclosing component, empty at module scope;
- a name declared twice in one scope (in two `if` branches) gets `#1` on its 2nd declaration, `#2` on its 3rd.

`--json` writes the same keys, and `--diff` matches names by them.

The exports:

| export | what |
| --- | --- |
| `./graph` | `buildGraph(model, { root })` turns `rxc model`'s JSON into the graph; `addKeys(graph)` |
| `./diff` | `diffGraphs(before, after)`, `reach(graph, id)` |
| `./page` | `pageHTML(graph, { live })`: the whole page as a string. It works in Node and in the browser |
| `./live` | browser only: `register(graph, { hot }?)`, `mount(el)`, which returns the dispose |
| `./vite` | `rxMap()`: Vite dev server plugin for the live channel |
| `./mcp` | `serveMcp(options?)`: read-only stdio MCP server |

The live page speaks the trace protocol (`TRACE-CONTRACT` v0.1): every message has `source: "rx-map"` and `v: 1`
(a message without `v` is read as v1; another `v`, an unknown `type` and a key the map doesn't have are ignored).

- From the host: `flush` (with optional `origin`, `cause`, `order`), `flight`, `reset`, `timeline`, `step`, `resume`,
  `travel-denied`, and `hmr` in phases `plan` → `apply` → `done` (or `failed`).
- To the host (`parent.postMessage`, or `window.__RX_FAKE__.post` when an in-page fake host is there): `hello` on
  load, `travel` and `resume` from the timeline, `select` when a token is selected. An in-page host can also call
  `window.__RX_VIEW__.connect()` (subscribe and say hello) and `window.__RX_VIEW__.receive(msg)`.

What it shows:

- **A flush:** a comet runs along the edges from the cause (`cause`, then the changed names each one reads, in `order`
  when given) to each changed token; the token rings white and its value badge rolls to the new value.
- **A flight:** an amber orbit; on landing it collapses into the token, which settles; abandoned, it slips away.
- **Time:** the timeline has a tick per flush in the colour of its cause, amber spans for flights and diamonds for
  reloads. Drag it or use the arrow keys to `travel`; **LIVE** sends `resume`. A `step` greys the world for a moment
  and rolls the changed values back (or forward); while viewing the past the frame of the screen is lit.
- **A reload:** on `plan`, the **Reload** tab lists what is kept, reset, re-run, added, removed and moved, with
  reasons, and the tokens are marked (added ones wait as ghosts on their plate). On `apply` the plate lifts, kept
  tokens glint, reset ones flip, re-run ones spin, removed ones sink; then the new graph is swapped in and each token
  slides to its new place.

`page.mjs` is generated from `map.html`: run `npm run build` after editing the page. `npm test` checks that it is
current and runs the live harnesses (`test/live.html`, with made-up flush, flight, timeline, step, resume and hmr
messages, and `test/engine.html`) in headless Chromium; `--shots <dir>` also
saves a screenshot. Set `SOLID_PACKAGES` to a Solid checkout's `packages` dir with built dists for the engine
harness.

## MCP: let an agent inspect your app

Run `rx-map mcp --root /absolute/path/to/app` as a local stdio server. Use Node 20 or newer. Without `--entry`, it
finds `.rx` modules under the root that no other module imports, excluding `node_modules`, `dist`, and declaration-only
`.d.rx` files. Use repeatable `--entry src/App.rx` to choose specific programs. Models refresh when `.rx` files change.

Set `RXC` to the absolute path to `rxc` if it isn't on `PATH`. Without `RXC`, the server prefers the project's installed
compiler's `model` export for modeling; `check` still needs the CLI.

OpenCode (`opencode.jsonc`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "rx": {
        "type": "local",
        "command": ["node", "/absolute/path/to/rx-map.mjs", "mcp", "--root", "/absolute/path/to/app"],
        "environment": { "RXC": "/absolute/path/to/rxc" }
      }
    }
  }
}
```

Claude Code (`.mcp.json`):

```json
{
  "mcpServers": {
    "rx": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/rx-map.mjs", "mcp", "--root", "/absolute/path/to/app"],
      "env": { "RXC": "/absolute/path/to/rxc" }
    }
  }
}
```

Inspector (replace `--method tools/list` with `--method tools/call --tool-name find --tool-arg query=user` to call a tool):

```sh
npx -y @modelcontextprotocol/inspector --cli -e RXC=/absolute/path/to/rxc node /absolute/path/to/rx-map.mjs mcp --root /absolute/path/to/app --method tools/list
```

Static tools: `check`, `overview`, `find`, `node`, `reach`, `boundary`, `diff`. Start with `overview` or use `find` to
look up a key for `node` or `reach`. `boundary` lists its own keys. `diff` defaults to `HEAD`. The `rx://graph` and
`rx://model` resources return JSON; any tool also accepts `format: "json"` for its structured answer.

To add the live tools, install this package in the app, import `rxMap` from `@reactivescript/map/vite`, and add `rxMap()`
to the Vite `plugins` array. Start Vite and open the app. The compiler's dev entry must register the graph with
`{ hot: import.meta.hot }`. No overlay needs to be open. The server tries `localhost:3000` and `localhost:5173` by
default; use `--dev http://localhost:3001` or `RX_DEV_URL` to override.

Live tools: `live_status`, `tail`, `value`, `why`, `pending`. They read the newest connected page. `tail` defaults to
20 records out of the most recent 2000; pass `since` as the last received sequence number to skip older records.
Times are in milliseconds on the page's clock. `value` needs an observed preview; if none is available yet, change the
value in the app. These tools don't execute actions or write state, but previews can contain application data. Keep
the Vite endpoint on a trusted dev network.

## Limits

- `.rx` imports are folded into the symbol they name, so module state is drawn once, where it lives. JS imports are
  drawn in the "outside the program" column.
- The model does not yet carry failure rows (`fails C`) or `server`/`client` placement. So "can fail from" means every
  async name, and a typed fallback's class isn't matched against what each name throws. "Can be pending" is read off
  the declaration (does it `await`?), because the model's question flag also marks sources with a standing question
  that never await.
- Edges into a `for` row are drawn once per site, not per row.
- Live mode lights names, not rows: every row of a `for` shares its nodes' key, so a change in any row lights the one
  chip. A node's first value (a question's first answer) is not a change to Solid, so it doesn't light. The start of a
  request is read off the node, because Solid's flight record comes only when the request ends.
