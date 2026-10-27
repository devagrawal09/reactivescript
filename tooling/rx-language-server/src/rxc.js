// The crate's side of the server: `rxc serve` (spec/11 CP-8e), asked one request at a time. Volar asks for a file's
// virtual code synchronously, so each request is a short `rxc serve` run with the request on stdin; a Node-API build of
// the crate would answer the same requests in process.
const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, writeFileSync, readFileSync } = require("node:fs");
const path = require("node:path");

/** The `rxc` binary: $RXC, else the repository's release build. */
function rxcPath() {
  if (process.env.RXC) return process.env.RXC;
  return path.resolve(__dirname, "../../../compiler/target/release/rxc");
}

function ask(method, params) {
  const r = spawnSync(rxcPath(), ["serve"], { input: JSON.stringify({ id: 1, method, params }) + "\n", maxBuffer: 1 << 28 });
  if (r.error) throw r.error;
  const line = r.stdout.toString().split("\n").find(Boolean);
  if (!line) throw new Error(`rxc serve: no answer (${r.stderr.toString().slice(0, 300)})`);
  return JSON.parse(line).result;
}

/** A file's projection (`code`, `mappings`, `ranges`, UTF-16 offsets) and its diagnostics, as the editor has it. */
function analyze(file, text, prelude) {
  return ask("analyze", { file, overlays: { [file]: text }, prelude });
}

/** Where a file's projection imports the prelude from: written once beside the nearest `node_modules`, so its own
 *  `@solidjs/web` resolves; a `.d.ts`, so the import needs no extension. */
const preludes = new Map();
function preludeFor(file) {
  let dir = path.dirname(file);
  while (!existsSync(path.join(dir, "node_modules")) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  const at = path.join(dir, "node_modules", ".reactivescript", "prelude");
  if (!preludes.has(at)) {
    const text = ask("prelude", {});
    mkdirSync(path.dirname(at), { recursive: true });
    const f = at + ".d.ts";
    if (!existsSync(f) || readFileSync(f, "utf8") !== text) writeFileSync(f, text);
    preludes.set(at, true);
  }
  return at;
}

module.exports = { analyze, preludeFor, rxcPath };
