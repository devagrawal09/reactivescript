# ReactiveScript for VS Code

Syntax highlighting for `.rx` and `.d.rx`: TypeScript's grammar for expressions,
statements and JSX, with ReactiveScript's forms injected on top — `source`, `:=`,
equations, `effect`, `action`, `server fn`, `context`/`provide`/`use`,
`loading`/`errored`/`fallback`, `for … in`, `pre`/`peek`/`latest`/`pending?`,
`await*`, `->`, the `pure`/`server`/`client` import rows, and scoped `<style>` as CSS.

Install from this folder: `code --install-extension .` after `npx @vscode/vsce package`,
or copy it to `~/.vscode/extensions/reactivescript`.

Semantic highlighting (sources vs equations vs props, hover types, errors as you
type) comes from the TSX projection (spec/13, TY-1c), not from this grammar.
