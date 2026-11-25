# Map visual contract: the 2.5D HUD map

The rx-map page (`tooling/rx-map/map.html` → `page.mjs`) becomes a tangible 2.5D world with a HUD. Same data, same
keys, same message protocol (SLICE1-CONTRACT section 3). Static, diff and live modes all keep working.

## Feel

- **2.5D canvas, not 3D.** The map is a slightly tilted plane with perspective (CSS 3D: `perspective`, a small
  `rotateX` tilt, depth via `translateZ` layers). Module "plates" sit on the plane like tiles. Chips are thick tokens
  standing slightly off their plate, with soft cast shadows. Arrows run on the plate surface.
- **Navigation invites play:** pan by drag with inertia, zoom on wheel/pinch toward the cursor, a gentle parallax tilt
  that follows the pointer (a few degrees), double-click a chip to fly to it and focus it, `Esc`/`F` to frame all.
  Hover lifts a chip (translateZ + shadow grows) and highlights its edges; press squashes it a little. Selecting a node
  dims the rest of the world and lights its reach paths.
- **HUD:** panels and buttons float over the world as glassy HUD elements (translucent, blurred backdrop, thin luminous
  borders, small caps micro-labels, subtle scanline/glow, corner brackets). The side panel (Guide/Legend/Node tabs),
  the header and the legend toggles are HUD. A minimap HUD in a corner shows the viewport.
- **Motion with meaning:**
  - live flush: a pulse travels along the edges from the cause to the changed chips (in causal order when known, else
    from the action/source), then the chip rings (white ring, per slice 1) and its value badge ticks/flips to the new
    value;
  - flight start: amber orbiting glow; land: the glow collapses into the chip with a small settle; abandon: the glow
    fades out sideways;
  - time travel (`{type:"step", seq, direction:"back"|"forward", changes}`): the world briefly desaturates/rewinds,
    the changed chips' values roll back/forward like an odometer, a timeline scrubber HUD appears showing seq;
  - module replacement (`{type:"hmr", module, kept:[keys], reset:[keys], rerun:[keys], added:[keys], removed:[keys]}`):
    the module plate lifts, kept chips stay pinned with a lock glint, reset chips flip over, re-run chips spin once,
    added chips rise from the plate, removed chips sink and fade, then the plate settles;
  - `reduced-motion` media query: every motion becomes a short fade.
- **Sound:** subtle synthesized WebAudio sounds (no audio files): hover tick, select, toggle, flush (soft pitched
  blip, pitch by role), flight start/land, abandon, rewind for step, a short rising chord for hmr. Starts after the
  first user gesture; global volume low; a mute toggle in the HUD, persisted in `localStorage["rx-map:sound"]`.
  Rate-limit so a burst of flushes doesn't become noise (aggregate per animation frame).

**Message shapes for step/hmr/timeline/resume are defined by `TRACE-CONTRACT.md` (v0.1), which overrides the shapes
sketched above.** Time travel UI: a timeline scrubber HUD (steps as ticks coloured by cause role, flights as amber spans,
hmr as markers), drag/arrow keys send `travel`, a "live" button sends `resume`. HMR UI: on `plan`, show the plan as a
preview (ghost overlay of what will be kept/reset/rerun/added/removed, with reasons in the panel), then animate on
`apply`/`done`, and swap in the new graph with chips moving to their new places (FLIP), `moved` chips sliding.

## Visual encoding (replaces text labels)

- Remove role text labels on chips ("SOURCE", "ACTION", "EQ", …). Role is shown by **shape + fill + icon**, colour by
  role family only (existing hues: state blue `#5b8cff`, derived teal, imperative orange, outside slate, structure
  violet, failure rose):
  - source/state: a solid filled token (a "well"), filled fully;
  - equation/derived: an outlined token with a gradient fill, a small ƒ/flow icon;
  - question (async derived): derived + the ⧗/stripes pending pattern when it can be pending;
  - action: a chevron/arrow-shaped token, orange, with a bolt icon;
  - effect: a hollow ring/diamond, orange outline;
  - outside/JS import/server: slate token with a plug icon; trust point = dashed border (existing);
  - components/regions/boundaries: violet frames; control flow frames keep their colours (if sky, for silver,
    loading amber, errored rose).
- Properties stay glyphs/patterns (⧗ + stripes pending, ? standing question, ↗ io, dashed trust). Diff keeps the
  reserved ring colours (add `#22c55e`, chg `#e879f9`, del `#ef4444`) and nothing else uses them.
- The Legend tab shows each encoding visually (the actual token rendered), and its rows remain the show/hide toggles.
  Hover a chip → a HUD tooltip may name the role in words (labels only on demand, never on the chip).
- Icons are inline SVG in the page (no icon font, no network).

## Code

- Every place RX code appears (declaration line in the Node panel, tooltips, guide examples, diff before/after) is
  syntax highlighted by a small built-in RX highlighter (keywords from `tooling/vscode-rx` TextMate grammar or
  `tooling/tree-sitter-rx`: `source`, `action`, `effect`, `if`/`for`/`match`, `await`, `loading`, `errored`,
  `component`, `import`, strings, numbers, comments, operators `:=`, types). Colours match the role hues where a
  keyword maps to a role (e.g. `source` blue, `action` orange).

## Constraints

- Self-contained page, no dependencies, no network. Works inside the devtools iframe (srcdoc) and as a static file.
- Keep performance: 300+ chips stay smooth (transform-only animations, `will-change` sparingly, no layout thrash).
- Keep the a11y basics: chips are focusable, keyboard nav works, the tooltip text names the role.
- Keep all existing behaviour: modules top to bottom in dependency order with arrows pointing up, legend toggles,
  collapsible panel with tabs, diff mode, live mode, localStorage keys (`rx-map:hidden`, `rx-map:panel`,
  `rx-map:panel:diff`).
