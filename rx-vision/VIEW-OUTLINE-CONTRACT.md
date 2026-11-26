# View outline contract: static view text beside the sites

The map shows the static content of views next to their reactive sites: text and numbers only, no
elements, no rendering knowledge. E.g. Counter reads `Clicks: [count]` and `Milestone reached: [count] clicks!`.

## 1. Model (compiler: ref/src/model.ts + compiler/src/model.rs, byte-equal JSON; additive)

Each region in `rxc model` output gains `outline`: the region's own markup (not its child regions' markup) flattened in
document order into an array of parts:

```ts
type Part =
  | { text: string }                 // static text node content, whitespace-collapsed (trimmed at line ends), entities decoded
  | { site: number }                 // a reactive view site (same id space the model already uses for sites)
  | { region: number }               // where a child region (if/for/loading/errored/component render) sits
  | { attr: string, text: string }   // a static attribute that carries human text: placeholder, title, alt, aria-label, value (literal only)
  | { br: true };                    // a block boundary (between sibling block-level elements / line breaks in markup), so the map can wrap
```

Rules: elements and tags are skipped; static text is kept verbatim (numbers included); `{expr}` children become `site`;
attributes with dynamic values are sites already (no change); empty text is dropped; consecutive text parts merge;
`<style>` / `<script>` content is skipped. Max 400 parts per region (then a final `{ text: "…" }`). Spans: each part
may carry `line` for click-to-source.

## 2. Graph (`tooling/rx-map/graph.mjs`)

`regions[].outline` passes through, with `site` ids mapped to graph node ids (`"m:cN"`) and `region` ids to graph region
ids. `diffGraphs` treats outline text changes as a region change ("text changed").

## 3. Map (`map.html`)

Each region frame shows a compact "view text" strip in document order beside/under its site tokens: static text in a
quiet monospace, holes as the actual site tokens (or small inline chips linked to them; hover cross-highlights), child
regions as a small inline frame tag. In live mode holes show the current value preview, so the strip reads like a
text-only sketch of the screen. Strips collapse to one line with an expander when long; semantic zoom hides them at low
zoom. MCP `node`/`boundary` may quote the outline text around a site (`… "Clicks: " [count] …`).
