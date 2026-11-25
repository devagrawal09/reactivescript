# Handoff: live RX eval in a Solid 2 app, the RX language server for eval snippets, and the move to upstream main

Written 2026-11-25. This covers one session of work on three branches of `devagrawal09/reactivescript`. Read this
file first. Then read [PIN-MAIN.md](PIN-MAIN.md) (the pin move, with all the evidence), `apps/eval-todo/README.md`,
`apps/eval-todo/FINDINGS.md`, and `frontend/docs/EVAL.md` ("DOM input (plan v2.2)"). The older
[HANDOFF.md](HANDOFF.md) (the `solid-model` line: frontends, plans, rust-solid, Frames) and
`apps/eval-demo/HANDOFF.md` (the eval RFC and the first eval demo) are background.

## What was asked, in order

1. Find the existing ReactiveScript eval work (the `solid-model` → `eval-demo` branches). Then build a **new Solid 2 web
   app** in which a **todo app with optimistic updates, written entirely in RX**, is evaluated live into the page with
   `createEval(() => code(), { bindings })`. JS forbids a binding named `eval` in a module, so the call keeps the
   runtime's name, `createEval`.
2. A **code editor written in RX**, and a panel where that editor **edits its own code** and rebuilds itself live.
3. **Typed input** for creating todos, plus a **larger RX app with forms and tables** to stress test RX and eval.
   Gaps found go into `apps/eval-todo/FINDINGS.md`.
4. **IDE support**: the upstream VS Code extension is built and installed. Then the "proper fix" for eval snippets:
   the language server understands them, and the fork moves to **upstream RX `main` and Solid `main`**, so the IDE and
   the eval checker speak the same RX (`guess x := v`, not `optimistic x := v`).
5. Push everything and write this file.

## Branches (all pushed to `origin` = `devagrawal09/reactivescript`; nothing was opened as a PR)

| Branch | Base | What it holds |
| --- | --- | --- |
| `eval-todo` | `eval-demo` (86e5a2d) | 6 commits at the **old pins** (RX fdbcad9, Solid rc.21 2105ffb8): plan v2.2 DOM input (5abb265), the eval-todo app (1f590f7), typed todo input (f74fe06), the inventory app (9e0aae2), tsconfig and type fixes (8f0b61d), `@eval` headers (70edf62). |
| `pin-main` | `eval-todo` | **The branch to continue on.** Everything on `eval-todo`, moved to RX `main` e650b85 and Solid `main` 30e7805e (2.0.3+), plus this file. About 31 commits; [PIN-MAIN.md](PIN-MAIN.md) lists them. |
| `lsp-eval-snippets` | `upstream/main` e650b85 (solidjs/reactivescript) | 4 commits in `tooling/`: the language server analyzes `// @eval` snippets (3599c19), tests (efaf898), README (187dd3b), version 0.3.2-eval.0 (31443c8). It belongs to upstream, not to the fork's `solid-model` line. |

`pin-main-rust-engine` and `pin-main-rust-render` were helper branches for the Rust port. Both are fully merged into
`pin-main` and weren't pushed. Their worktrees can be deleted.

Worktrees on the user's machine (WSL, `~/work/solidjs/`): `rx-eval-todo` (eval-todo), `rx-pin-main` (pin-main),
`rx-lsp-eval` (lsp-eval-snippets), and the two helpers. The main clone, `~/work/solidjs/reactivescript`, has local
`main` = upstream `main` e650b85. There are many other `rx-*` worktrees from other sessions; don't touch them.

## The eval-todo app (`apps/eval-todo/`)

A Solid 2 page on `@solidjs/web`. Its TSX goes through Solid's native compiler (`generate: "dom"`) in an esbuild plugin
(`scripts/build.ts`): esbuild strips the types first, with `jsx: preserve`. Solid resolves from `frontend/node_modules`
(the pinned build, through `nodePaths`), so the host and evaluated plans share one Solid runtime.

- `client/eval.ts`: `bindEval({ renderer })` over `@solidjs/web`, giving `createEval`. The renderer adapter does
  `createElement` (events as listeners), `insert`, `createComponent` and `memo`. It also does `setProp` for v2.2
  attributes: `value` and `checked` are set as properties, and only when they differ, or the caret jumps.
- `client/program.ts`: one editable program. `draft` is what's typed and `code` is what runs. The draft is checked in
  a worker (`client/check-worker.ts`, built to `dist/check.js`) with a 2 s timeout. It runs once the checker accepts it
  and typing pauses (300 ms). A swap re-creates the subtree, so the textarea's focus, selection and scroll are restored
  in the same `[data-eval]` panel.
- `client/server.ts`: a fake server owned by the host. It holds the stores (`db`, `inv`), the latency slider, "fail
  every request" and a request log. Server calls update the store before they resolve.
- `client/App.tsx`: panels for the todo app, the fake server, the inventory app, and editors. `editor.rx` is
  evaluated once per target (todo.rx, inventory.rx) and once on **its own** text.
- `src/*.rx` are **eval snippets**, not modules, loaded as text. Each starts with `// @eval`, then one
  `// @bind <declaration>` per binding (the grammar of `frontend/eval/interface.ts`). The host's interfaces in
  `src/interface.ts` are the contract. `test/todo.test.ts` asserts each header says the same thing.
  - `todo.rx`: `source shown = db.list` is guessed for toggle and delete, `adding` is guessed for a new row, and the
    code awaits a host. A failure rolls back and sets `status`. The draft input comes from v2.2 DOM input.
  - `inventory.rx`: table, search, category filter, sort, column toggle, add/edit form with validation, row
    toggle/delete, summary counts.
  - `editor.rx`: a textarea (`value={code}` and `onInput={e => { edit(e.target.value) }}`), a keystroke count, and the
    checker's verdict.
- Run it: `sh scripts/setup.sh` at the repo root (see the environment notes below), then
  `cd apps/eval-todo && npm install && npm run dev` (http://127.0.0.1:4190; `PORT` changes it). Checks: `npm test`
  (24), `npx tsc -p .` (no errors under client/ or src/), `npm run build`.

## Plan v2.2 "DOM input" (`frontend/plan/resolve-v2.ts`, `types.ts`, `solid-plan.ts`; `eval/compile.ts`)

Evaluated code may carry element attributes and a handler that takes its event. It's gated by `opts.dom`, which only
`compileEval` sets: authored plans and the plan fuzz still refuse both.
- Attributes: literals are set once. Any other value is reactive, set in a `createRenderEffect` through
  `Renderer.setProp`, with one CP-6 reader per attribute.
- The event's `target` / `currentTarget` are typed per element (`plan/types.ts`). `<input>` has `value: string` and
  `checked: boolean`, `<textarea>` and `<select>` have `value`, and any other element has neither. A handler that
  takes its event is a plain handler.
- A plan that uses either form is `version: 2.2`. **That version is also used by slice 6 Frames plans**
  (FINDINGS #3), and needs a schema decision.
- Not verified like the rest: there's no static twin, no fuzz and no Rust leg.

## The language server for eval snippets (`lsp-eval-snippets`, `tooling/rx-language-server`)

A file whose first line is exactly `// @eval` is analyzed as a module built in place. Hosts are imported from an
overlay `.d.rx`, each `@bind` becomes a declaration, the body goes inside `export default component Eval() {…}`, and
everything maps back onto the file's own lines.
- In the IDE: hover, completion, type errors, and go-to-definition (to the `@bind` line). `INTERFACE` flags a bad
  `@bind` line. `READ_ONLY` flags a write or `guess` to a read/store binding.
- No crate change was needed. Files without the header behave as before.
- Tests: LSP 16/16, snippets 16/16, rx-tsc 10/10. Running them needs a local, git-ignored `ref/node_modules` in that
  worktree.
- The user's VS Code (WSL side) has `solidjs.reactivescript@0.3.2-eval.0` installed from this branch's vsix.
  Rebuild with: `cargo build --lib --release --target wasm32-unknown-unknown --manifest-path compiler/Cargo.toml &&
  npm --prefix tooling/rx-language-server install && cd tooling/vscode-rx && npm install && npm run package`. Then
  run `code --install-extension reactivescript-*.vsix --force` and reload the window.
- It checks against upstream `main`, so the snippets are clean only on `pin-main`. On `eval-todo` they still say
  `optimistic`, which is flagged.
- The Vite route exists upstream (`@reactivescript/compiler/vite`, a front end for `@solidjs/vite-plugin` ≥
  3.0.0-next.57), but it compiles `.rx` **modules**. Snippets would be `?raw` imports. Moving the host page to Vite +
  `solid()` was offered and not done.

## The move to upstream main (`pin-main`): read [PIN-MAIN.md](PIN-MAIN.md)

Pins: RX `e650b85`, Solid `30e7805e`. Detail is in `PIN-MAIN.md`, `rust-solid/docs/PIN-MAIN-ENGINE.md` and
`PIN-MAIN-RENDER.md`. Results at handoff:

- **Frontend gate PASS, 149/149.**
- Rust: `cargo test` 175, fmt and clippy clean. All seven rust-solid fuzz modes are byte-identical to their recorded
  1–1000 summaries (checked independently).
- **Re-recorded, each with evidence:**
  - Plan fuzz: 85 agree → 30 agree + 55 "upstream". Plan, Rust and createEval still equal native Solid on all 55.
    Only compiled RX differs, in host-op order: Solid #4730 doesn't lower upstream emit's block-bodied `<Show>` to a
    ternary. An enhancement note is drafted in PIN-MAIN.md and **not filed**.
  - Upstream strict tsc baseline: 12 → 40. All 28 new diagnostics come from upstream 0b30229's duplicate `Shape`
    import in `ref/src/check.ts`.
  - Also: TSX fuzz list, host-log lengths (Solid #5017), SSR keys, and three Rust summaries.
- Frames harness: settling now waits on in-flight and queued work, and accounts for Chrome's 6 connections per host
  (0a483dd, 63b593e). This fixed placement seeds 11/33/42.

## Environment notes (the user's machine: WSL2 on Windows, zsh, Node 24.16, Rust 1.97)

- No `chromium` on PATH. Browser tests **hang** without
  `CHROMIUM=/usr/bin/google-chrome npm run verify:subset`. Playwright can use `/usr/bin/google-chrome` too.
- `RX_REPO=~/work/solidjs/reactivescript sh scripts/setup.sh` clones the pinned RX from the local clone, which is
  faster. Setup builds Solid with pnpm 11.1.1 and the native compiler.
- The user's real browser is Windows Chrome, paired with the `browse` tools: use them for browser passes and close
  your tabs afterwards. WSL forwards `127.0.0.1` ports. To open Chrome from WSL:
  `cmd.exe /c start chrome <url>`. The `code` CLI works from WSL.
- Dev servers: the user's is on 4190, so use 4191+ for your own and stop them afterwards. Since the machine restarted,
  nothing is serving on 4190. Restart it from `rx-pin-main/apps/eval-todo` if the user wants it.

## Gotchas found the hard way

- **The pinned upstream RX parser hangs forever** on text that ends in an unclosed tag (`<p>`, or `…\n<p>` after a
  body). Partial typing in an editor hits this constantly, so checking runs in a worker with a timeout. This is **not
  yet reported upstream**; check whether `e650b85` still does it, then draft a repro.
- esbuild applies tsconfig `paths` by itself. With the app's `tsconfig.json` (made for the editor), Solid resolved
  past the `browser` condition and the page got a second, server copy ("Client-only API called on the server side").
  `scripts/build.ts` sets `tsconfigRaw: {}`.
- Solid 2 batches writes: a signal read straight after its set returns the old value until the flush. Defer a
  check-then-commit to the next task.
- Solid 2 removed `classList`; use `class={{ … }}`. `For` passes rows as values. The `Errored` fallback is
  `(err, reset) =>`.
- In an action, the code's plain writes **and the host's own writes during the action** show only when the
  transaction settles (FINDINGS 18–19). Guesses show at once.
- `browse pair` prints a one-time code. The user enters it in the extension's Options.

## Open items, roughly by value

1. **Upstream's newer RX surface is refused by the plan builders, and so by `createEval`**: a guess on a writable
   signal or store (d3cab00), spreads, object rest, non-path destructuring, `.d.rx` libraries. The language server
   accepts these, so the IDE and the page disagree on them. Port them (start with guess-on-writable), or have the
   language server flag them in snippets.
2. **Plan version 2.2 collision** (DOM input vs Frames plans). Pick a schema: a new version, or feature flags.
3. **Eval checker vs LSP checker**: the page uses upstream's TS reference implementation (`ref/`) through the fork's
   frontend, and the IDE uses upstream's Rust crate. They agree on the snippets today; nothing enforces it.
4. **Unverified at the new pins**: held-out fuzz ranges (1001–3000) for plan, eval, SSR, render and placement; the
   placement 1–1000 summary; plan fuzz v2.1 seed 419 (only compiled RX differs, unexplained); engine paths not ported
   (they fail closed; see PIN-MAIN.md, "Open").
5. **The RX subset as an app language** (FINDINGS):
   - no statement `if` in handlers or actions
   - no `-`, `*`, number parsing, sort, string comparison, `includes`, reduce, spreads or append
   - no components (rows written twice)
   - an action can't call an action
   - no `e.key`, so no Enter-to-add
   
   Each finding has a repro string.
6. **Eval semantics from the RFC** (`docs/eval/RFC.md`): `preserve` (keep state across code swaps, which the
   self-editing editor would want), diagnostics as a value, debounced or committed code, structured value results.
   The RFC is still unposted; its handoff lists the open decisions.
7. **Upstream notes to file, once the user OKs it**: the #4730 `<Show>` enhancement (drafted in PIN-MAIN.md) and the
   parser hang (not drafted).
8. Housekeeping: delete the helper worktrees and branches. Decide whether `eval-todo` is still needed now that
   `pin-main` contains it.

## How the user works

- Short, plain answers. Ask at most two decisions at a time, with the recommended option first, and act once there's
  enough to act on.
- Multi-part work goes to background agents in parallel, each with complete context. Report one line when each
  finishes. Check agents' claims before repeating them.
- A UI change is done when the repo's checks pass and a browser pass on the user's machine agrees (their Windows
  Chrome through `browse`). Then commit locally.
- **Never push, PR, file or comment without an explicit OK.** An OK covers only the action it names. Never touch other
  sessions' worktrees, `main`, or the pinned checkouts (`reactivescript/`, `solid-next/`, which are gitignored and
  read-only).
- Never loosen a check to get green. Re-record only with evidence, written down.
