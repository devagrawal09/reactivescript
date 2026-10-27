# rx-language-server

The `.rx` language server (spec/11 CP-8e), built on [Volar](https://volarjs.dev).
A `.rx` file's virtual code is its TSX projection (spec/13 TY-1c), which the
crate makes with mappings back onto the `.rx` (CP-8c). TypeScript answers hover,
go to definition, references, rename, completion and type errors on the
projection, and Volar maps the answers back. The crate's own diagnostics (parse
errors, else the checker's, each with its rule) are a second service.

- `src/rxc.js` asks `rxc serve` (`compiler/`, built with
  `cargo build --release`; `RXC` names another binary) for a file's analysis,
  with the editor's unsaved text as overlays, and writes the projection's
  prelude to `node_modules/.reactivescript/prelude.d.ts`.
- `src/index.js` is the language plugin (exact mappings carry every feature;
  ranges only place type errors) and the diagnostics service.
- `bin/server.js` is the server, over stdio or IPC.

The project needs a `tsconfig.json` with Solid's JSX (`"jsx": "preserve"`,
`"jsxImportSource": "@solidjs/web"`) and Solid in its `node_modules`.
`tooling/vscode-rx` starts it in VS Code; any LSP client can, with
`initializationOptions: { typescript: { tsdk } }`.

## Tests

```sh
cargo build --release --manifest-path ../../compiler/Cargo.toml
npm install && node test/run.js      # VERBOSE=1 prints each answer
```

`test/run.js` drives the server over LSP on a copy of `examples/shop` (Solid's
types from `ref/node_modules`, via `ref/scripts/solid-next.sh`): hover, go to
definition across modules, references, completion while typing (in code and in
markup), a parse error, a TypeScript type error and a crate diagnostic, each
placed on the `.rx`.
