# The map, as an RX program

`map.html`'s page rewritten in ReactiveScript. RX owns the state and the views; small JS modules own the imperative
parts and the math. Plan: `rx-vision/MAP-IN-RX.md`. Same DOM contract (ids, classes, data attributes, messages) as
`map.html`, so the harness tests are the acceptance tests.

```sh
node app/build.mjs                 # app/page.mjs: pageHTML(graph, { live, fake }), as ../page.mjs
MAP_PAGE=app node test/run.mjs     # the harnesses against it
node test/shots.mjs /tmp/shots     # vanilla vs RX screenshots, side by side (index.html)
```

## Build

`build.mjs` compiles `main.rx` with the compiler's Node-API `app()`, bundles it (esbuild, from `ref/node_modules`)
with Solid's dists and `@reactivescript/runtime` into one IIFE (`boot.js` is the entry), and puts it and `map.css`
into `shell.html`. `app/page.mjs` is generated and not committed until the cut-over.

## Modules

RX (`*.rx`):

| module | owns |
| --- | --- |
| `state.rx` | the graph (by number), its model and board tree, selection, focus (what is lit), hover, hidden kinds, diff view, all-edges, the measured layout |
| `ui.rx` | the side panel's tab / open / before, `pick` (select + panel), `openTab`, search (query, hits, current) |
| `board.rx` | the world: `Board`, `FrameBox`, `Token`, the edge layer |
| `panel.rx` | `Side` (tabs, node / region / guide / legend / changes / plan panels), `PanelButton` |
| `live.rx` | live mode: the host link, live values, flights, held, boundaries, timeline, travel, hmr, pop-out, fake HUD |
| `main.rx` | the page: world + HUD, the bridges (camera, minimap, layout, body classes, keys, hash, tooltip) |

JS (`js/*.js`, each with a `.d.rx` beside it):

| module | what |
| --- | --- |
| `env.js` | what the page was served with (graph, live, fake, pop-out), media queries, `<body>` classes, hash, localStorage |
| `graphs.js` | graphs by number (a `source` holding a graph would be a store over all of it) |
| `vocab.js` | roles, families, shapes, icons (SVG strings), edge styles |
| `model.js` | `buildModel(graph)`: indexes, ranks, control heads, boundary notifiers; `boardTree`, traces, `searchHits` |
| `edges.js` | an edge as the edge layer draws it |
| `geometry.js` | anchors, boxes (`measureAnchors`), edge and flow paths |
| `camera.js` | pan / zoom / tilt / fly / frame, crisp zoom, layout notifications (`onLayout`) |
| `minimap.js` | the minimap canvas |
| `fx.js` | transient effects on board elements: comets, sparkle, rings, orbs, fire, rewind, hmr animations, FLIP, toast |
| `sound.js` | the WebAudio cues |
| `hl.js` | the RX highlighter, `md` |
| `values.js` | value previews: lists, the chip badge, `valueAt` |
| `livestate.js` | the live reducer (one, run on a JS mirror and on the store's draft), `present()` |
| `transport.js` | the host link: postMessage, the in-page fake, `__RX_VIEW__`, the pop-out window |
| `scrub.js` | the timeline canvas and track pointer |
| `swap.js` | a module replacement's graph swap (FLIP bookkeeping) |
| `fakehost.js` | the embedded fake host (fake.mjs + hmr.mjs) and its timer |
| `panel.js` | panel lookups and texts RX can't write (escapes, `in`, edge descriptions) |
| `tip.js` | the tooltip's place |
| `dom.js` | reading events (`closestId`, `leftId`, …) |
| `util.js` | `unique`, `toSet` |

## Rules of thumb

- A `source` holding an object is a Solid store (deep proxy). Hold big immutable things by number or in JS.
- An element the JS modules also touch (chips, frames, plates) uses `class={[…]}`: Solid then adds and removes only
  its own classes, and fx's transient classes survive a re-render.
- Burst-safe writes: a message handler writes functionally (`x := s => f(s, msg)`) so several messages handled in one
  turn compose.
- No DOM element refs: JS finds elements by id / `data-id` after mount.
- `==` / `!=` are strict (`__rt.eq` is `===`): a missing key is `undefined`, not `null`. Use `present(x)`.
- String literals lose their escapes (`"a\nb"` → `"anb"`): put such strings in JS.
- `<></>` renders the text "null": don't use an empty fragment.
- Two synthetic events in one task see the first one's writes only after Solid's microtask flush; a handler that
  must see its own last state reads it from JS (e.g. `soundOn()`).
