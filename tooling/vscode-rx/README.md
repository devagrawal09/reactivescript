# ReactiveScript for VS Code

Highlighting for `.rx` and `.d.rx`: TypeScript's grammar for expressions,
statements and JSX, with ReactiveScript's forms injected on top — `source`, `:=`,
equations, `effect`, `action`, `server fn`, `context`/`provide`/`use`,
`loading`/`errored`/`fallback`, `for … in`, `pre`/`peek`/`latest`/`pending?`,
`await*`, `->`, the `pure`/`server`/`client` import rows, and scoped `<style>` as CSS.

Everything else comes from the `.rx` language server
([`../rx-language-server`](../rx-language-server)), which this extension starts
for `.rx` documents: TypeScript's hover, go to definition, references, rename,
completion and type errors, asked of the TSX projection (spec/13 TY-1c) and
mapped back onto the `.rx` (spec/11 CP-8), and the compiler's own diagnostics,
each with its rule.

## Running it from the repository

```sh
cargo build --release --manifest-path compiler/Cargo.toml   # rxc, which the server asks
npm --prefix tooling/rx-language-server install
npm --prefix tooling/vscode-rx install
code --extensionDevelopmentPath=$PWD/tooling/vscode-rx examples/shop
```

The project needs a `tsconfig.json` with Solid's JSX (`"jsx": "preserve"`,
`"jsxImportSource": "@solidjs/web"`) and `@solidjs/web` in its `node_modules`;
the server writes the projection's prelude to `node_modules/.reactivescript/`.
The settings `reactivescript.server.path`, `reactivescript.rxc.path` and
`reactivescript.typescript.tsdk` point at another server, `rxc` or TypeScript.

To package it, `npx @vscode/vsce package` (the server and `rxc` are not bundled
yet: a packaged extension needs both, the second built per platform).
