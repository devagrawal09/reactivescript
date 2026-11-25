# RX tooling roadmap and standing decisions (user decisions, 2026-11-25)

## Direction
- RX is designed for: **agents write, humans review.** Explicit, one way to do each thing, checker-heavy, diagnostics
  that say exactly what to rewrite.
- Map / MCP / time travel: **RX first, Solid-wide later** once protocols settle (rounds 5–6 stay on RX).
- Upstream: Solid #5198 (store-guess flush record) open; #5089 comment with list-gap analysis posted; devtools #57
  (quiet devtools reads) and #58 (Structure Map mode) open; `rx/view-on-30e7805` pushed to the fork. RX → upstream as
  three PRs (language fixes; dev keys + model; tooling), branches being prepared locally.

## Language decisions
- Small **pure prelude**: Math (minus random), Number, String, pure Object statics, Array.isArray, JSON
  (spec/pure-globals.json). No Date.now/Math.random/console/DOM.
- **Declarations are generated from the sibling .ts** (slice 8). Unannotated export = **conservative** (io, may reject
  with any Error).
- **Zero-cost helpers are the only user-facing way** to state RX facts in .ts (`pure(fn)`, `rejects([E…], fn)`,
  `ref(…)`, …); brand types are internal. `import pure`/`fails` on a local .ts import is an error, with the exact helper.
  `ref` and `instantiates` imply `pure`.
- Helpers **declare only**; anything that changes production behaviour (retry, cache, dedupe, error mapping) is a
  separate, visible wrapper.
- Opaque object sources stay structured; `== null` stays strict; bursts use functional updaters (decisions/*.md).
- Map detail levels: **two** (overview cards + detail), zero layout shift.

## Order of work
1. Slice 8b: helpers as the one way (running).
2. Slice 9: reactive coverage + tests — "covered" = behaviour paths (nodes changed, edges propagated, boundary states
   incl. each typed catch, optimistic outcomes, action outcomes per error type) (running).
3. Usability round 5 "Dispatch" (after 8b).
4. Helper powers, first: **observed Calls view** (calls recorded at the helper) + **verify claims in dev**
   (undeclared rejections, impurity, untracked ref reads).
5. Then: **record/replay at the boundary**, **test doubles + chaos injection**, **shape checks in dev** (returned data
   vs TS type), **sensitivity declarations** (redaction; required before any production recording).
6. Later: production record/replay (opt-in, sampled), Solid-wide map.
