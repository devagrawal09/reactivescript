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
- **Colour is what a thing is**: source (blue), source with a standing question (teal), equation (green), async
  equation (amber), action (orange), function (grey), server function (slate), context (pink), error class (red),
  component and props (purple), JS import (white). View sites are the small square chips: markup reads, `on…` handlers,
  props passed down, effects.
- **Marks**: a striped chip can be pending. A red dot is `io` (R-io): it touches the world. A dashed border is a trust
  point, where the checker sees only a declared signature (`pure`, `fails`, `.d.rx`).
- **Edges**:
  - Reads: tracked (green), snapshot (grey dashed), `pre` (grey dotted), and `latest` / `pending?` probes (amber).
  - Writes: `:=` (orange), `guess` (orange dashed), `refresh` (cyan), `affects` (violet), and `provide`.
  - Also calls, props passed, and components rendered.
- **Hover** a chip to see its edges. **Click** it to pin it, read its line, and trace:
  - **what it affects**: writes and calls go out, then tracked reads carry the change on. A snapshot read stops it.
  - **what it depends on**.
- The side panel opens from the header (`guide · legend`). It has tabs:
  - **Guide** and **Legend**;
  - **Changes**, in a diff, open by default;
  - the selected name, which appears while something is selected.

  Esc clears a selection, which brings back the tab you were on. Esc again closes the panel. Whether the panel is open,
  and on which tab, is remembered.
- `#name`, `#name:down` or `#name:up` in the URL selects or traces a name. `/` focuses search.

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

Matching is by key: module, the chain of regions, and the name. A view site is matched by its place in markup and what
it reads. A rename shows as one removed and one added. Both sides are modelled by the `rxc` you run, so a ref older
than a syntax change (e.g. `optimistic` before `guess`) will not parse.

## Limits

- `.rx` imports are folded into the symbol they name, so module state is drawn once, where it lives. JS imports are
  drawn in the "outside the program" column.
- The model does not yet carry failure rows (`fails C`), `server`/`client` placement, or which boundary discharges a
  reader's failures (R-f-5). Those are the next things to add to `model.rs` / `model.ts` for the map to show them.
- Edges into a `for` row are drawn once per site, not per row.
