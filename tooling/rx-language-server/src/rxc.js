// The crate's side of the server: `rxc serve`'s requests (spec/11 CP-8e). Volar asks for a file's virtual code
// synchronously, so the requests are synchronous calls: into the crate's WebAssembly build, loaded in process (one build
// for every platform), or, when $RXC names a binary, a short `rxc serve` run per request.
const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "../../..");

/** The `rxc` binary, when $RXC names one. */
function rxcPath() {
  return process.env.RXC || path.join(repo, "compiler/target/release/rxc");
}

/** The WebAssembly build: $RX_WASM, else the one bundled beside this file (the packaged extension), else the
 *  repository's (`cargo build --lib --release --target wasm32-unknown-unknown`). */
function wasmPath() {
  if (process.env.RX_WASM) return process.env.RX_WASM;
  for (const f of [path.join(__dirname, "rxc.wasm"), path.join(repo, "compiler/target/wasm32-unknown-unknown/release/reactivescript.wasm")]) if (existsSync(f)) return f;
  return undefined;
}

/** The crate in process, over `src/wasm.rs`'s ABI. */
function loadWasm(file) {
  let x;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const put = bytes => {
    const p = x.rx_alloc(bytes.length + 4);
    const m = new Uint8Array(x.memory.buffer);
    new DataView(x.memory.buffer).setUint32(p, bytes.length, true);
    m.set(bytes, p + 4);
    return p;
  };
  const env = {
    rx_read(ptr, len) {
      const f = dec.decode(new Uint8Array(x.memory.buffer, ptr, len));
      try { if (!statSync(f).isFile()) return 0; return put(readFileSync(f)); } catch { return 0; }
    },
  };
  x = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(file)), { env }).exports;
  return (method, params) => {
    const req = enc.encode(JSON.stringify({ method, params }));
    const p = x.rx_alloc(req.length);
    new Uint8Array(x.memory.buffer).set(req, p);
    const out = x.rx_call(p, req.length);
    const n = new DataView(x.memory.buffer).getUint32(out, true);
    const text = dec.decode(new Uint8Array(x.memory.buffer, out + 4, n));
    x.rx_free(out, n + 4);
    return JSON.parse(text);
  };
}

function viaProcess(method, params) {
  const r = spawnSync(rxcPath(), ["serve"], { input: JSON.stringify({ id: 1, method, params }) + "\n", maxBuffer: 1 << 28 });
  if (r.error) throw r.error;
  const line = r.stdout.toString().split("\n").find(Boolean);
  if (!line) throw new Error(`rxc serve: no answer (${r.stderr.toString().slice(0, 300)})`);
  return JSON.parse(line).result;
}

let wasm;
function ask(method, params) {
  if (process.env.RXC || !wasmPath()) return viaProcess(method, params);
  try {
    return (wasm ??= loadWasm(wasmPath()))(method, params);
  } catch (e) {
    wasm = undefined; // a trap (a panic in the crate) leaves the instance unusable: the next request makes a new one
    throw e;
  }
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

module.exports = { analyze, preludeFor, rxcPath, wasmPath };
