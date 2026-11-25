# The map, written in RX

Decision (user): the rx-map page is rewritten as a ReactiveScript program. It's also the hardest usability round so
far: every place RX makes this harder or easier is a finding.

## Shape

- New package dir `tooling/rx-map/app/` holding the `.rx` program (`main.rx` + modules) and its JS modules.
- **RX owns the state and the views:** the graph, selection/trace, hidden kinds, panel/tabs, search, live values,
  flights, runs, held writes, boundaries, timeline/viewing, HMR plan/apply, diff mode, pop-out connection state, the HUD.
- **JS modules own the imperative and the math**, imported across the trust boundary (`pure` / `.d.rx` declarations):
  layout (bands, clusters, sizing), edge routing geometry, camera (pan/zoom/inertia/FLIP), WebAudio synth, the RX syntax
  highlighter's tokenizer, message transport (postMessage / `__RX__.connect`), localStorage. Keep these small, typed,
  and testable on their own; prefer plain functions over classes.
- **Build:** `build.mjs` compiles the program with this repo's compiler (Node-API `app()`), bundles it with its own copy
  of Solid 2 + `@reactivescript/runtime` into one self-contained page string (`page.mjs` stays the export, so
  `pageHTML(graph, opts)` keeps its signature). A dev-only bundler dependency (esbuild) is fine; the shipped package keeps
  zero runtime dependencies. The page's Solid copy lives only inside the iframe, so the map's own nodes never appear in
  the app's flush records.
- **Same DOM contract:** keep the class names, data attributes, element ids and message protocol the existing harness
  tests use (`test/live.html`, `test/fake.html`, `test/engine.html`, conformance in the page), so those tests are the
  acceptance tests. Where a test pokes an internal, change the test to use the public DOM/messages instead, never the
  other way round.
- **Cut-over:** the vanilla `map.html` stays the shipped page until the RX page passes the whole suite plus a visual
  side-by-side review (screenshots at 1440x900 and 1440x360 for static, diff, live, fake, travel, hmr, failures, held,
  pop-out, big). Then `page.mjs` switches and `map.html` is deleted. The in-flight layout and view-outline work lands on
  the vanilla page first and gets ported.

## Findings log

`rx-vision/usability/map-in-rx.md`: every RX friction or win while building it (language, compiler errors, rx-tsc,
runtime, the map/MCP used to debug the map itself), with file:line and what you did instead. This is the main output
besides the code.
