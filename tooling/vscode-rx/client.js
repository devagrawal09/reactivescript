// The VS Code side: starts the .rx language server (tooling/rx-language-server) over IPC for .rx documents.
const vscode = require("vscode");
const path = require("node:path");
const fs = require("node:fs");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");

let client;

/** TypeScript's lib folder: the setting, else the workspace's, else VS Code's own. */
function tsdk(config) {
  const set = config.get("typescript.tsdk");
  if (set) return set;
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    const lib = path.join(f.uri.fsPath, "node_modules", "typescript", "lib");
    if (fs.existsSync(lib)) return lib;
  }
  return path.join(vscode.env.appRoot, "extensions", "node_modules", "typescript", "lib");
}

function activate(context) {
  const config = vscode.workspace.getConfiguration("reactivescript");
  const module = config.get("server.path") || context.asAbsolutePath(path.join("..", "rx-language-server", "bin", "server.js"));
  const env = { ...process.env, ...(config.get("rxc.path") ? { RXC: config.get("rxc.path") } : {}) };
  const run = { module, transport: TransportKind.ipc, options: { env } };
  client = new LanguageClient(
    "reactivescript",
    "ReactiveScript",
    { run, debug: { ...run, options: { ...run.options, execArgv: ["--nolazy", "--inspect=6009"] } } },
    { documentSelector: [{ language: "reactivescript" }], initializationOptions: { typescript: { tsdk: tsdk(config) } } },
  );
  return client.start();
}

function deactivate() {
  return client?.stop();
}

module.exports = { activate, deactivate };
