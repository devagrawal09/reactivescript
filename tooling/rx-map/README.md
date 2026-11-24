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
  - **Shape:** a pill is a name, a square is a view site.
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
- The model does not yet carry failure rows (`fails C`) or `server`/`client` placement. So "can fail from" means every
  async name, and a typed fallback's class isn't matched against what each name throws. "Can be pending" is read off
  the declaration (does it `await`?), because the model's question flag also marks sources with a standing question
  that never await.
- Edges into a `for` row are drawn once per site, not per row.
