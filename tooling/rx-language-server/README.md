# rx-language-server

The `.rx` language server (spec/11 CP-8e), built on [Volar](https://volarjs.dev).
A `.rx` file's virtual code is its TSX projection (spec/13 TY-1c), which the
crate makes with mappings back onto the `.rx` (CP-8c). TypeScript answers hover,
go to definition, references, rename, completion and type errors on the
projection, and Volar maps the answers back. The crate's own diagnostics (parse
errors, else the checker's, each with its rule) are a second service.

- `src/rxc.js` asks the crate for a file's analysis, with the editor's unsaved
  text as overlays: its WebAssembly build in process (`src/wasm.rs`; one build
  for every platform, about a millisecond a file once loaded), or, when `RXC`
  names a binary, `rxc serve` as a process per request. It writes the
  projection's prelude to `node_modules/.reactivescript/prelude.d.ts`.
- `src/index.js` is the language plugin (exact mappings carry every feature;
  ranges only place type errors) and the diagnostics service.
- `bin/server.js` is the server, over stdio or IPC.

A `.rx` importing a TS module with no `.d.rx` (spec/09 MO-11) reads the
declaration generated from it: `src/rxc.js` answers the crate's read of
`rx-dts:<stem>` with the project's `@reactivescript/compiler/dts` (else this
repository's), one generator a project, with the project's `typescript`. The
generator's own diagnostics (`DECLARATION_BRAND`, a misplaced brand) are shown
on the `.ts`, at the brand. An analysis is cached by the `.rx`'s text and the
stamps of every file it read, the TS modules behind a generated declaration
included, so saving the `.ts` refreshes the `.rx`'s diagnostics. The
projection (the virtual code) is remade when the `.rx` changes: a brand added
in the `.ts` reaches hover and TypeScript's errors at the `.rx`'s next edit.
Through `RXC`, `rxc` runs `rx-dts` itself (MO-11d) and none of this is cached.

The project needs a `tsconfig.json` with Solid's JSX (`"jsx": "preserve"`,
`"jsxImportSource": "@solidjs/web"`) and Solid in its `node_modules`.

## Running it

From npm (published from this folder, `../RELEASING.md`):

```sh
npx @reactivescript/language-server --stdio
```

From the repository:

```sh
cargo build --lib --release --target wasm32-unknown-unknown --manifest-path ../../compiler/Cargo.toml
npm install
node bin/server.js --stdio
```

`initializationOptions: { typescript: { tsdk } }` picks TypeScript's `lib`
folder; without it, the server uses its own `typescript`.

## Type-checking from the command line

`rx-tsc` (`bin/tsc.js`) is `tsc` with `.rx` modules in the program, for CI.
It is Volar's tsc runner (the one `vue-tsc` uses) with this package's
language plugin, so it checks the same projection the editor does, and places
type errors on the `.rx`. It takes `tsc`'s arguments and reads
`tsconfig.json`, whose `include` must name the `.rx` files.

```sh
npx rx-tsc --noEmit
```

After TypeScript's errors it prints the crate's diagnostics for every `.rx`
module in the program (parse errors, else the checker's, with their rules),
and exits non-zero if there are any. A module that does not parse has no
projection, so TypeScript alone would pass it. Then the generator's
(`DECLARATION_BRAND`, at the brand in the `.ts` a `.rx` imports). Under `--watch` only
TypeScript's errors are reported.

## Editors

**VS Code** (and Cursor, VSCodium): the extension in
[`../vscode-rx`](../vscode-rx), which bundles this server and the WebAssembly
build.

**Neovim** (0.11+), in `init.lua`:

```lua
vim.filetype.add({ extension = { rx = "reactivescript" } })
vim.lsp.config("rx", {
  cmd = { "node", "/path/to/reactivescript/tooling/rx-language-server/bin/server.js", "--stdio" },
  filetypes = { "reactivescript" },
  root_markers = { "tsconfig.json", "package.json" },
})
vim.lsp.enable("rx")
```

Neovim has no `.rx` grammar yet; the server's semantic tokens color names.

**Helix**, in `languages.toml`:

```toml
[language-server.rx]
command = "node"
args = ["/path/to/reactivescript/tooling/rx-language-server/bin/server.js", "--stdio"]

[[language]]
name = "reactivescript"
scope = "source.rx"
file-types = ["rx"]
roots = ["tsconfig.json", "package.json"]
language-servers = ["rx"]
```

**JetBrains IDEs** (WebStorm, IntelliJ): install the
[LSP4IJ](https://plugins.jetbrains.com/plugin/23257-lsp4ij) plugin, add a
language server with the command
`node /path/to/reactivescript/tooling/rx-language-server/bin/server.js --stdio`,
map the file name pattern `*.rx` to it, and add the `tooling/vscode-rx`
folder under Settings › Editor › TextMate Bundles for highlighting.

**Zed** needs an extension of its own (a Zed extension declares the language
and starts the server); there isn't one yet.

The `/path/to/reactivescript` paths are a checkout of this repository; with
the npm package, the command is `npx @reactivescript/language-server --stdio`
instead (or `rx-language-server --stdio` once installed).

## Tests

```sh
cargo build --release --manifest-path ../../compiler/Cargo.toml
npm install && node test/run.js      # VERBOSE=1 prints each answer
node test/tsc.js                     # rx-tsc: a clean program, a type, a parse and a checker error
```

`test/run.js` drives the server over LSP on a copy of `examples/shop` (Solid's
types from `ref/node_modules`, via `ref/scripts/solid-next.sh`): hover, go to
definition across modules, references, completion while typing (in code and in
markup), a parse error, a TypeScript type error and a crate diagnostic, each
placed on the `.rx`; and a `.ts` with no `.d.rx` (MO-11): a `Ref` hovering as
its `T`, a rename in the `.ts` reaching the `.rx` unedited, a misplaced brand
on the `.ts`. `test/tsc.js` runs `rx-tsc` on the same copy, with the MO-11
cases: brands, a type import, an error class caught, a `Ref` read as `T`, a
TypeScript error against the `.ts`'s types, `DECLARATION_BRAND`,
`NOT_EXPORTED`. Both link `types/` and `compiler/` into the copy's
`node_modules/@reactivescript/`.
