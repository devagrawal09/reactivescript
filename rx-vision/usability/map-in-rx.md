# The map in RX: findings log

Rewriting `tooling/rx-map/map.html` (2763 lines of vanilla JS) as a ReactiveScript program in `tooling/rx-map/app/`
(worktree `rx-map-rx`, branch `map/rx`). Plan: `MAP-IN-RX.md`. Each entry: what happened, where (file:line), what I
did instead. Newest last within each section. Severity: **block** (no way in RX, had to leave the language), **friction**
(a way, but costly or surprising), **win**.

## Language and compiler

1. **friction — no element refs, only `ref={jsFn}`.** `ref={el => { … }}` is `REACTIVE_WRITE_IN_OWNED_SCOPE [W-2]`
   ("a statement-bodied closure in reactive scope"); `ref={someImportedFn}` compiles (Solid's `ref`). The map needs the
   board, canvas, minimap canvas and anchors for the camera and geometry. Did instead: the JS modules find elements by
   id after mount (`app/js/camera.js startCamera`, `geometry.js anchorOf`), started from `effect () { return
   startCamera() }` (`app/main.rx`). Ids were already part of the DOM contract, so this costs little here; in an app
   without ids it would.
2. **friction — a `fn` whose body declares equations "declares state".** `fn edgeView(e, boxes, focused) { ends = …; a
   = …; … }` called inside `.map(...)` is `INSTANTIATION_NOT_BOUND [E-9] edgeView(…) declares state: bind it`. The
   body's local names are only there to name sub-expressions, but they make it an instantiating fn. A `fn` block body
   also takes no `if`/`return` (grammar: `Decl* Expr`). Did instead: moved it to `app/js/edges.js edgeView` (pure JS).
3. **friction — `new` is out, so no `new Set`.** `markers = [...new Set(drawn.map(v => v.c))]` doesn't parse.
   Did instead: `app/js/util.js unique()`, `toSet()`.
4. **friction — `String(x)` is UNBOUND** (`board.rx`: `data-mod={String(f.module.index)}`). Template literals work:
   `` `${f.module.index}` ``. Same family as round 2's `Number`/`Math`.
5. **friction — `ref` is reserved as a parameter name in a `.d.rx`.** `export pure fn regionByRef(m: Model, ref:
   string): any` is `PARSE [07] param near ': string): any'` at the column of `ref`. The message doesn't say `ref` is
   a keyword. Renamed the parameter.
6. **win — computed keys work now** (`{ ...o, [k]: v }`; round 2 said they didn't), and functional writes from two
   action calls in one handler compose (`put("a"); put("b")` both land). The live reducers lean on this.
7. **win — writes from a JS callback inside an effect work.** `effect () { return listen("keydown", e => { count :=
   count + 1 }) }` compiles to `w$count.set(__rt.snapshot(v$count) + 1)`; returning the unsubscribe is the cleanup.
   This is the whole bridge to the JS world (camera layout → `setLayout`, transport → message actions).
8. **block-ish — a structured `source` is a deep store.** `export source graph: any := servedGraph()` lowers to
   `createStore(graph)` (ST-1: "structured vs atomic is the type"), so the whole graph (hundreds of nodes and edges) is
   proxied, every read in `buildModel` is tracked, and the model's own annotation (`e.i = i` on each edge) silently
   didn't stick: selecting a chip crashed in `edgeKey(undefined)` (`board.rx` edges). There is no way to say "this is an
   opaque, immutable value; hold it, don't proxy it" (`any` doesn't, a class instance is still wrappable). Did
   instead: `app/js/graphs.js` keeps graphs in a JS array; `state.rx` holds `source graphNo: number` and `model =
   buildModel(graphAt(graphNo))`. Worth a language form (`source g: frozen T`, or "a source of a type from a `.d.rx`
   is atomic").

## Runtime, build, Solid

1. **friction — bundling Solid from this checkout pulled its TypeScript sources.** `solid-js/dist/internal.js` does
   `import * as core from 'solid-js'` (a self-import); esbuild resolved that to `src/index.ts` with `"_SOLID_DEV_"` left
   as a truthy string, and the page threw in `installConsoleFooter` (`DEV.guideUrl` of undefined). Did instead:
   `app/build.mjs` pins `solid-js`, `solid-js/internal`, `@solidjs/web`, `@solidjs/signals` to their `dist` files.
2. **win — the pipeline is short.** `app()` (Node-API) returns each module as Solid's DOM output importing
   `./x.rx`; an esbuild plugin serves those from the compile result, and the page is one IIFE + the CSS: ~0.5 MB
   unminified, all of Solid included. A first static render matched the vanilla page pixel for pixel (users.rx,
   1440x900).
3. **win — Solid 2's `class={[…]}` diffs only its own classes.** A class array/object goes through `classListToObject`
   and adds/removes only what it set, so the JS effects module can add `pulse`, `fire`, `settle`, `h-kept` … on a chip
   the view owns without the next render wiping them. (A `class` string would `setAttribute` and wipe them.) Every
   view element that fx touches uses the array form.
4. **note — `<style>` is scoped and static** (CSS-1..5), and the map's 500-line stylesheet is page-global and keyed
   on `body` classes. Kept it as `app/map.css`, inlined by the build. Classes on `<body>` can't be bound from a view:
   `env.js bodyClass(name, on)` from effects (`main.rx`).

9. **bug — an empty fragment compiles to the text "null".** `component Empty() { <></> }` lowers to `return "null";`
   (a string), so the component shows `null`. Seen as "nullnull" at the end of the tooltip text, from two stub
   components (`app/live.rx` stubs, rendered by `app/tip.rx`). Did instead: real conditionals for "shows nothing".
10. **win — event objects are plain values in handlers.** `ev.preventDefault()`, `ev.key`, `ev.shiftKey` work in a
    handler (`app/main.rx` keys, `app/board.rx` onKeyDown); I'd moved `ev.target.closest(…)` into `app/js/dom.js`
    pre-emptively, which wasn't needed for method calls, only for readability.
11. **friction — a source initializer that reads an equation must `peek` it**, even at module top level where it runs
    once anyway: `source tab := saved != null ? saved.tab : …` is `SNAPSHOT_INITIALIZER [E-4]` (`app/ui.rx:14`).
    The fix is mechanical (`peek(saved)` three times in one line), and the message says exactly what to do.
12. **friction — io-ness of a JS function is per declaration, and a seed reading "the setting now" is io.**
    `source sound := soundOn()` is `IO_IN_REACTIVE [IO-2]` because `sound.d.rx` declares `soundOn` as `fn` (it reads
    module state that `setSound` changes). Did instead: seeded from `env.js loadText("rx-map:sound")` (pure).

13. **bug — string literals lose their escapes.** `{"a\nb"}` compiles to `__rt.show("anb")`, `` `c\td` `` to `"ctd"`.
    The Guide's code sample (a multi-line string for the highlighter) came out as `state` + `n` + `total` on one
    line. Did instead: the sample lives in `app/js/panel.js guideCode()` (`app/panel.rx` Guide).
14. **friction — two modules that share small components can't import each other** (`MODULE_CYCLE [MO-5]`).
    `Sample` and the inline mark glyphs live in `app/legend.rx`, which `panel.rx` imports, though they're the panel's
    as much as the legend's.
15. **friction — `for x in xs` gives no index.** The diff summary items (clicked by index) are pre-mapped to
    `{ text, i }` (`app/panel.rx` summary).
16. **friction — an action reads values from before its own writes, so it can't reuse another action's logic after
    preparing state for it.** `closePanel` wanted `before := …; pick(null)` (pick reads `before`); it repeats pick's
    branch instead (`app/ui.rx` closePanel). Correct by W-4, but it makes "call the action that does it" not compose.
17. **friction — an HTML string beside text in one element needs a wrapper.** `innerHTML` takes the whole element;
    the control tag (icon + text) is a `display: contents` span in `board.rx` FrameBox, and one built string in
    `panel.rx` / `legend.rx`.
18. **win — the panel and legend type-checked on the first `rxc check`,** including narrowing `selected` inside
    `{if selected != null { <NodePanel id={selected}/> }}`. One `effect (tab, open, before)` replaced `persist()` at
    every write site in map.html, one click handler on `#panel` replaced `bindPanel`'s re-binding after each render,
    and the legend rows' `.off` / `aria-pressed` follow `hidden` directly instead of `applyHidden` patching the DOM.
19. **gap found by porting — a "marked" chip had no state.** map.html puts `.sel` on a diff summary item's first name
    without selecting it (DOM-only). In RX that needed a real source (`state.rx marked`, cleared by `select`). A
    first attempt patched the class from JS and an effect undid it; replaced by the state.

20. **friction (trap) — `==` / `!=` are strict.** They lower to `__rt.eq(a, b)` = `raw(a) === raw(b)`, so
    `live.values[k] != null` is true for a missing key (`undefined`). It's the natural way to write "has a value" and
    nothing warns. Did instead: `present(x)` (`app/js/livestate.js`) everywhere in `live.rx` / `board.rx`.
21. **friction — leading whitespace in an element's text is dropped.** `<span class="vn-long"> · the app…</span>`
    compiled to `· the app`, so the view note read "#2 of 6· the app". JSX keeps that space; whitespace after a
    child element is kept. Did instead: `{" · …"}` (`app/live.rx` ViewNote).
22. **friction — burst messages need a JS mirror.** Several messages handled in one turn compose only through
    functional writes, and a handler can't read what the previous message wrote, so `__RX_VIEW__.values()` (read by
    the tests right after posting) can't come from the store. Did instead: one in-place reducer
    (`app/js/livestate.js`) run on a plain JS mirror and on the store's draft (`live := s => reduce(s, m, model)`,
    `app/live.rx` dispatch). The reducer is declared `pure fn` so it can be called inside the write closure, which is
    a lie (it mutates its draft argument). The same staleness hit the sound toggle (two clicks in one task:
    `app/main.rx` now reads `soundOn()` from JS) and the search check in `test/live.html` (now a tick between
    synthetic keys; vanilla rendered synchronously).
23. **friction — an effect can't depend on "anything under this store path".** Redrawing the timeline canvas needs
    `effect (live.tl.rev, model)` with a hand-kept `rev` counter (`app/live.rx`).
24. **win — the bridge pattern carries all host traffic.** One `effect () { return startLive({ receive: (m) => {
    dispatch(m) }, … }) }` (`app/live.rx`); actions calling other modules' actions (`openTab`, `select`,
    `swapGraph`) just work. fake.html (incl. the 146-check conformance run in the page) passed on the first build.

## Debugging with the RX map / MCP

1. **The static map of this program** (`rx-map.mjs app/main.rx`): 7 modules, 471 nodes, 424 edges at the first
   panel commit. Drawing it needed no setup.
2. **bug (tooling) — `rx-map --json` piped was cut at 64 KB** (`process.stdout.write` then `process.exit(0)`;
   `tooling/rx-map/rx-map.mjs:104`). Fixed: `writeFileSync(1, …)`.
3. **MCP `check` / `overview` / `find` / `reach` refuse while the program doesn't compile** — with two agents editing
   modules in parallel the program is broken most of the time, so every static tool answered only with the
   diagnostics. Did instead: ran the MCP on a `git archive HEAD` copy of `app/`. A "last good model" fallback would
   have made the live tree usable.
4. **win — `reach state.rx||hidden down 2` found a real bug before it was noticed**: `hidden → ui.rx||hits →
   main.rx effect#3` (fly to the first search hit). Toggling a legend row while a search was active would have moved
   the camera. Fixed by keying the effect on `query` (`app/main.rx`). `node state.rx||focus` also listed exactly the
   four writers and three readers I expected, with the per-field reads (`ids`, `edges`).
5. **friction — `overview` lists every JS import as a top-level name** (`state.rx||isDiff import`, …: 12 of the 35
   lines for state.rx), which buries the sources and equations. Component-level detail is fine.
6. **win — `node live.rx||dispatch` confirmed the design in one call**: its snapshot reads of `model` and
   `selected`, the one write to `live`, the calls to `ingest` / `reduce` / `openTab`; `reach live up` showed every
   writer goes through `dispatch`.
7. **misleading — `reach live down` treats a store as one node**: every reader of any field (Token, FrameBox, the
   scrub effect, the panel's tab list) shows as depending on all of `live`; you can't ask "who reads `live.hmr`".
8. **friction — `find query: "live"` returned ~40 rows** (it matches the module name, so every import in live.rx
   counts), and **`reach` without `direction` fails** ("missing direction; see tools/list") instead of defaulting
   to down.

## Workarounds retired by language fixes (rx/integ e2555d3, fix/lang-r4)

| workaround | retired by | status |
| --- | --- | --- |
| Guide code sample built in JS (`app/js/panel.js guideCode()`) because `"a\nb"` compiled to `"anb"` | string escapes decode (S-surface-escapes) | **retired** (`0e11382`): the sample is an RX string literal in `app/panel.rx` Guide |
| View note text written as `{" · the app is read-only…"}` because leading whitespace in element text was dropped | JSX text whitespace follows Solid's rules (S-surface-jsx-text) | **retired** (`0e11382`): plain text in `app/live.rx` ViewNote |
| Avoiding `<></>` (it rendered "null") | `<></>` renders nothing | nothing to retire in code: the stubs that hit it had already been replaced; the legend's empty `<span></span>` cells are map.html's markup, not a workaround |
| `present(x)` instead of `x != null` (strict `==`) | none: decision `nullish-equality.md` keeps `==` strict and asks for explicit presence checks | **kept** — `present()` is now the sanctioned form |
| graphs held by number (`app/js/graphs.js`) | none: decision `opaque-sources.md` keeps object sources structured | **kept** |
| JS mirror + the reducer run twice (`app/js/livestate.js`) | the documented burst pattern (W-6 updaters compose in arrival order; `synchronous-message-bursts.md`) | **retired** (`43cc16f`): one `live := s => reduce(s, m, model)` per message (`app/live.rx` dispatch); everything that depended on the mirror's "state so far" moved into the reducer; `__RX_VIEW__.values()`, the pop-out's state, the scrub and the swap read the committed store through `() => live`. No mirror left; harness and real-host unchanged |

After the mirror went (the burst pattern in practice):

- **win** — arrival order inside the one updater made every "state before this message" rule simple (a flight's
  default time, an hmr phase for a stale plan, whether a landed flight re-asks a snapshot).
- **win** — a closure handed to JS from an effect (`state: () => live`) compiles to `() => __rt.snapshot(v$live)`: an
  untracked read of the committed store, exactly the accessor JS needs.
- **friction** — no primitive for "transient effects after commit": a queue in state (`fx`, `fxSeq`), a played-counter
  in JS, a cap so it doesn't grow (`app/js/livestate.js playFx`, `app/live.rx` effect on `live.fxSeq`). Effects now
  play one microtask later, after the DOM they act on is rendered; a host's reply to `snapshot?` arrives after the
  burst instead of inside it.
- **friction** — a draft updater (mutates the draft Solid hands it, otherwise pure) can only be declared `fn … : void`
  (io) or, falsely, `pure fn`; returning a new state would copy up to 2000 timeline steps per message.
- **friction** — store data handed across windows or back into the store (pop-out state, `pendingDone`) needs a
  manual `JSON.parse(JSON.stringify(…))`; no runtime "unwrap to plain data".

## Phase 4: the board on layout.mjs (two levels)

- **win — the layout crossed the trust boundary cleanly.** `layout.mjs` (pure, JSDoc'd) is declared in
  `app/js/layout.d.rx`; the board is an equation over the graph number (`app/state.rx:13`), a plain memo, so the big
  layout output never becomes a store. No layout code of RX's own: the views draw `layoutWorld`'s boxes.
- **win — levels follow `LEVELS`.** The level is state set by an action the camera calls (`app/main.rx:63`), with
  `levelFor` / thresholds from layout.mjs; when the vanilla page went from three levels to two, the RX side needed no
  level-specific code changes (only the tests' stale `setLevel(3)`).
- **friction — the layout tests poked the vanilla page's globals** (`w.eval("anchors")`, `RXL`, `zoomUnder`,
  `moduleEls`, …). Per the plan they now go through one test hook both pages expose, `window.__RX_MAP__` (layout, BW/BH,
  cam, level, setLevel, flyTo, frameAll, zoomAt, freeRect, toScreen, boxOf, anchor, module, region, zoomUnder,
  LEVELS, draw). Same assertions.
- **note — heavy pages and a loaded machine:** screenshots of the 228-token tracker graph timed out at 5 s for both
  pages; the shot rig now uses 30 s timeouts and a fresh browser per scenario.
- **outside the map — real-host round 3 "(a) travel shows the recorded DOM at every seq" fails at seq 10 with the
  vanilla page and the RX page alike** (the shelf app's own DOM under `openView`, current solid-view build): not a map
  regression.

## Review 1 follow-ups (fable-review-1 finding 8)

- **`pure` that couldn't back itself — retired.** `graphAt` read a JS array `putGraph` appended to and was declared
  `pure` so an equation could call it. Now the graph comes in through a host signal, MO-10's foreign accessor
  (`app/js/graphs.js graphSignal(): [ref any, (g) => void]`, `[graph, setGraph] = graphSignal()` in `app/state.rx`):
  `model = buildModel(graph)` is an ordinary tracked read, the graph is not wrapped (decisions/opaque-sources.md), and
  `graphAt` / `putGraph` are plain `fn`, called only from actions. **win:** the sanctioned pattern took four lines and
  removed the last lie in a `.d.rx`.
- **`legend.rx:68`** interpolated `props.text` into `innerHTML` unescaped; now `esc(props.text)`. The 43 `innerHTML`
  sites are the price of icons as SVG strings: a view form for "markup from a trusted string" or SVG icons as
  components would remove most.
- **v0.7 `uncarried`** is shown: the Reload tab gets a "Not carried · N" list and says a refresh fallback was used
  (`app/live.rx` PlanPanel, `app/js/livestate.js` reduce).
- **page.mjs inputs** are written into its second line (compiler, runtime, Solid dists, esbuild versions) and listed
  in the README; `--check` stays.
- **Dev globals in the minified page** (`__RX_NODES__` 1, `__RX_BOUNDARIES__` 1, `__RX_TRACE__` 1, `__RX_HMR__` 4,
  `rx:${` 1, `MISSING_TEST_API` 1, `jsError` 1): unchanged until the runtime's dev/prod split (slice7b) lands; then
  rebuild and recount.
- **Shot rig lessons:** a scenario that clicks a chip broke when users.rx began opening at the overview (no chip to
  click) — select through the page's `select()`; marks a scenario exists to show (held, tripped, plan badges) are only
  drawn at the detail level, so those scenarios now fly there; and a capture on a loaded machine can catch a half
  rasterised frame, so a shot is taken only when two captures agree.
- **A real camera difference the side-by-side found:** the RX first view was framed ~58 px right of vanilla's (the
  camera port predated map.html's "count the undrawn minimap as ≤ 200 px"). The harness had no check for it; only the
  screenshots showed it.

## Cut-over (rx/integ a863e5c) and after

- **The RX page is the only map now** (`map.html` deleted; `page.mjs` built from `app/`). With the runtime's dev/prod
  split (slice7b) the minified page has no dev registry: `__RX_NODES__` / `__RX_BOUNDARIES__` / `__RX_TRACE__` /
  `__RX_HMR__` / `rx:${` / `MISSING_TEST_API` / `jsError` all 0. The `__RX_*` names left are the page's own contract
  (`__RX_VIEW__`, `__RX_MAP__`, the fake host's, the boot config, the app's `__RX__` the pop-out reads).
- **friction — state that JS owns, mirrored into RX, then styled by an effect, lags by a commit.** The camera decides
  the level synchronously; the `lvN` class on `<body>` came from `effect (level) { bodyClass(…) }` in `main.rx`, one
  commit later, and a zero-duration `flyTo` only applied on the next animation frame. Under the harness's virtual
  time, outline.html saw level 1 with the detail styles still on. Fixed by letting the owner do both at once: the
  camera switches the class itself, and `flyTo(…, 0)` applies now, as `zoomAt` did (rx/integ `3f31320`). Rule: a DOM
  side effect of JS-owned state belongs in the JS that owns it, not in an RX effect over a mirror of it.
- **First RX-only feature (rx/integ `d164e98`):** overview cards read at the framed zoom (a 16 px floor on the name's
  scale; a card too small narrows, wraps at camel humps and sheds parts inside its own plate). It touched
  `app/js/layout.js fitCards` (JS: measuring and fitting is the module's job), one `nameParts` helper declared in
  `layout.d.rx` and used by the card view in `board.rx` (`{for part in nameParts(c.name) { {part}<wbr /> }}`), and
  CSS. `layout.html`'s "every card sits inside its plate" caught the first attempt spilling App's short card.

## Round 4 follow-up: the Calls view (rx/integ 5e0aa67)

- **No runtime change was needed for "who called it, and why".** The bridge already saw what makes a JS call (a
  question's flight, an action run) and Solid's rerun record already carries `causes` (the inputs that changed, with
  prev/value). TRACE v0.9 only forwards them on a flight start (`cause`), adds `error` to a rejected ask's abandon, and
  the graph's `call` edges name the imports. Conformance now checks a re-asked question says what re-asked it, and the
  real host (shelf app) passes with Solid's own causes.
- **bug fixed — "last changed by JS call listItems" for an action's guess**: the bridge credited any change to a
  static call edge; a value written in the same flush (`:=`, a guess) now keeps its writer's origin.
- **friction — every live feature grows the JS side.** Calls bookkeeping (matching ends to starts, settling, steps) is
  ~100 lines in `app/js/livestate.js` because the burst pattern makes the reducer a JS draft updater; RX holds the views
  (`app/live.rx` Calls tab, row, the import panel's section), which compiled first try.
- **friction — actions still don't compose** (`ui.rx openFor`/`closeFor` repeat `pick`'s restore logic; finding 16).
- **win — "the guide reopens on every reload" had a real cause found by reading the state model:** a plan opened the
  panel on Reload; the pop-out's re-attach sent `reset`, the plan went, the panel stayed open on its first tab. The plan
  now remembers what it took over and gives it back.
- **Not done:** per-token change history (tool change 2); overlapping re-asks of one key are still one published
  flight (the protocol pairs start/end per key; a superseded ask shows as stale only when the bridge sends its abandon).

## Round 5 follow-up (rx/integ 27f0a8a)

- **bug — strict `!=` again, user-visible:** the panel's "declared by default (no helper)" line (round 5's wrong label)
  was `{if n.decl != null}` (`app/panel.rx`), true for nodes with no `decl` at all; six more latent sites. All now
  `present()`. A lint for `x.field != null` on optional/any fields would have caught every one.
- **friction — `<select value={x}>` with `{for}` options shows the first option** (the value is applied before the
  options exist); each option now carries `selected` (`app/live.rx` Calls filter).
- **friction — an `effect` after markup is a bare `PARSE [07] expected a declaration or markup`**; the message
  doesn't say a component's declarations come first.
- **friction, recurring — every live feature lands in the JS reducer** (failed re-ask view, swallowed-rejection
  detection, call grouping: ~150 lines of `app/js/livestate.js`); RX holds the views.
- **Detail-level switch (.50) left as is:** at .45 the smallest detail text is 10 px, under the 11 px floor; the "~60%"
  in the report is one ×1.13 wheel notch past .50. Badges (8.3/9.3 px) and frame labels aren't among the sizes
  `levelThresholds` uses: worth adding there.
