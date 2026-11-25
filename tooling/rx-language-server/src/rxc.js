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

/** 09 MO-11d: the declaration generated from a TS module, answered to the crate's read of `rx-dts:<stem>` — the
 *  project's `@reactivescript/compiler/dts` (resolved from the stem), else the repository's. One generator a project. */
const generators = new Map();
function generatorFor(stem) {
  let id;
  try { id = require.resolve("@reactivescript/compiler/dts", { paths: [path.dirname(stem)] }); } catch {
    const own = path.join(repo, "compiler/dts.mjs");
    if (!existsSync(own)) return null;
    id = own;
  }
  if (!generators.has(id)) {
    let g = null;
    try { g = require(id).createDeclarations(); } catch (e) { console.error(`rx: the declaration generator did not load (${e?.message ?? e})`); }
    generators.set(id, g);
  }
  return generators.get(id);
}
function record(stem) {
  const g = generatorFor(stem);
  if (!g) return null;
  try { return g.record(stem) ?? null; } catch (e) { console.error(`rx: rx-dts ${stem}: ${e?.stack ?? e}`); return null; }
}
function declaration(stem) {
  const r = record(stem);
  return r ? JSON.stringify(r) : null;
}

/** A file's stamp on disk (`-`: none), for an analysis's staleness. */
function stamp(f) {
  try { const s = statSync(f); return s.isFile() ? `${s.mtimeMs}:${s.size}` : "-"; } catch { return "-"; }
}
/** What the crate read during the current request: every file it asked for (found or not), and the declaration records
 *  it was given, whose own `files` (the TS modules TypeScript read) count as read too. */
let reading = null;

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
      if (f.startsWith("rx-dts:")) {
        const r = record(f.slice(7));
        if (reading) {
          reading.stems.set(f.slice(7), r);
          for (const g of r?.files ?? []) reading.deps.set(g, stamp(g));
        }
        return r === null ? 0 : put(enc.encode(JSON.stringify(r)));
      }
      if (reading) reading.deps.set(f, stamp(f));
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

/** A file's projection (`code`, `mappings`, `ranges`, UTF-16 offsets) and its diagnostics, as the editor has it. In
 *  process, also what it read: `deps` (file → stamp; stale when one changes, `stale`) and `records` (stem → the record of
 *  the declaration generated from a TS module, MO-11, whose `errors` are in that module, not in this file). Through
 *  $RXC, `rxc` runs `rx-dts` itself (MO-11d) and neither is known. */
function analyze(file, text, prelude) {
  reading = { deps: new Map(), stems: new Map() };
  try {
    const result = ask("analyze", { file, overlays: { [file]: text }, prelude });
    reading.deps.delete(file);
    return Object.assign(result, { deps: reading.deps, records: reading.stems });
  } finally { reading = null; }
}

/** Whether a file read for an analysis has changed on disk since. */
const stale = deps => { for (const [f, s] of deps ?? []) if (stamp(f) !== s) return true; return false; };

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

module.exports = { analyze, preludeFor, rxcPath, wasmPath, declaration, record, stale };
