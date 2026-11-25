import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { buildGraph } from "./graph.mjs";
import { diffGraphs } from "./diff.mjs";

const ownGenerator = fileURLToPath(new URL("../../compiler/dts.mjs", import.meta.url));
const run = (cwd, cmd, args, options = {}) => execFileSync(cmd, args, {
  cwd, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"], timeout: 30000, ...options,
});
export const plain = s => stripVTControlCharacters(String(s));
const where = (root, f) => relative(root, f).split("\\").join("/");
export const isEntry = f => f.endsWith(".rx") && !f.endsWith(".d.rx") && !!statSync(f, { throwIfNoEntry: false })?.isFile();

function scan(root, ignored = new Set(["node_modules", "dist", ".git"])) {
  const files = [];
  function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory() && !ignored.has(e.name)) walk(path);
      else if (e.name.endsWith(".rx") && (e.isFile() || e.isSymbolicLink())) files.push(path);
    }
  }
  walk(root);
  return files.sort();
}

// Read import specifiers without mistaking strings or comments for imports. A .d.rx
// is a JS import's declaration (MO-8), not a program entry, but counts for invalidation.
const tokens = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|[\w$]+|[^\s]/g;
function discover(files) {
  const modules = files.filter(f => !f.endsWith(".d.rx"));
  const imported = new Set();
  for (const f of modules) {
    const ts = (readFileSync(f, "utf8").match(tokens) ?? []).filter(t => !t.startsWith("//") && !t.startsWith("/*"));
    for (let i = 0; i < ts.length; i++) if (ts[i] === "import") {
      for (let j = i + 1, nesting = 0; j < ts.length; j++) {
        const t = ts[j];
        if (t === "{" || t === "(") nesting++;
        if (t === "}" || t === ")") nesting--;
        if (t === "from" && nesting === 0) {
          const spec = ts[j + 1];
          if (/^["'].*\.rx["']$/.test(spec ?? "")) {
            const target = resolve(dirname(f), spec.slice(1, -1));
            if (target !== f) imported.add(target);
          }
          break;
        }
        if (nesting < 0 || (!nesting && !/^[\w$,]+$|^[})]$/.test(t))) break;
        if (t === "import") break;
      }
    }
  }
  return modules.filter(f => !imported.has(f));
}

export function project({ root = process.cwd(), entries = [], rxc = process.env.RXC, spa = true, managed = false, lastGood = new Map(), frontends = new Map() } = {}) {
  root = resolve(root);
  entries = [...new Set(entries.map(f => resolve(root, f)))];
  const binary = rxc && /[\\/]/.test(rxc) ? resolve(rxc) : rxc || "rxc";
  const require = createRequire(join(root, "package.json"));
  let napi;
  const compiler = (cwd, args, allowDiagnostics = false) => {
    try { return run(cwd, binary, args); }
    catch (e) {
      if (allowDiagnostics && e.status === 1 && e.stdout) return e.stdout;
      if (e.code === "ENOENT") throw new Error(`cannot run ${binary}; set RXC to the compiler binary`);
      throw new Error(`${plain(e.stderr?.trim() || e.message)}\nRun check for diagnostics or verify --entry and RXC.`);
    }
  };
  function nativeCompiler() {
    if (!rxc) {
      if (napi === undefined) {
        let id;
        try { id = require.resolve("@reactivescript/compiler"); }
        catch (e) { if (e.code !== "MODULE_NOT_FOUND") throw e; }
        napi = id ? require(id) : null;
      }
      return napi;
    }
  }
  // 09 MO-11d: on the napi path, a TS module's declaration is generated in process — the project's
  // `@reactivescript/compiler/dts`, else the map's own, else this repository's; one generator a project, with the
  // project's TypeScript.
  // Every file a record read counts for invalidation (`declFiles`). Through $RXC, `rxc` runs `rx-dts` itself: $RX_DTS,
  // else the nearest `node_modules/.bin/rx-dts`.
  let generator;
  const declFiles = new Set();
  function declare(stem) {
    if (generator === undefined) {
      generator = null;
      let id;
      for (const from of [require, createRequire(import.meta.url)]) {
        try { id = from.resolve("@reactivescript/compiler/dts"); break; } catch {}
      }
      id ??= statSync(ownGenerator, { throwIfNoEntry: false }) ? ownGenerator : null;
      try { if (id) generator = createRequire(import.meta.url)(id).createDeclarations(); } catch {}
    }
    if (!generator) return null;
    let r;
    try { r = generator.record(stem); } catch { return null; }
    for (const f of r?.files ?? []) declFiles.add(f);
    return r ? JSON.stringify(r) : null;
  }
  function modelOf(files, cwd, current = false) {
    if (!files.length) return [];
    const native = nativeCompiler();
    if (native?.model) {
      const model = JSON.parse(native.model(files, cwd, declare));
      if (!Array.isArray(model)) throw new Error(model.error ?? "compiler returned no model");
      return model;
    }
    // The CLI prints one JSON array per entry. Merge shared dependencies once,
    // preserving each entry's dependency order.
    const modules = new Map();
    for (const f of files) {
      for (const m of JSON.parse(compiler(cwd, ["model", ...(current && spa ? ["--spa"] : []), f]))) modules.set(resolve(cwd, m.file), m);
    }
    return [...modules.values()];
  }
  let cached;
  const stampOf = (files, deps = []) => JSON.stringify([...new Set([...files, ...entries, ...deps])].sort()
    .map(f => [f, statSync(f, { throwIfNoEntry: false })?.mtimeMs]));
  function snapshot() {
    if (managed) {
      const selected = entries.filter(isEntry);
      for (const f of entries) if (!selected.includes(f)) { lastGood.delete(f); frontends.delete(f); }
      if (!cached || cached.entries.length !== selected.length) cached = { entries: selected, hasPrograms: false };
      return cached;
    }
    const files = scan(root);
    const stamp = stampOf(files, [...cached?.graph?.absModules ?? [], ...declFiles]);
    if (stamp !== cached?.stamp) {
      const selected = entries.length ? entries.filter(isEntry) : discover(files.filter(isEntry));
      for (const f of lastGood.keys()) if (!isEntry(f)) lastGood.delete(f);
      cached = { stamp, files, entries: selected, hasPrograms: files.some(f => !f.endsWith(".d.rx")) };
    }
    return cached;
  }
  function requireEntries(s) {
    if (!s.entries.length) throw new Error(s.hasPrograms
      ? "no entry found (imports may form a cycle); pass --entry to check a module"
      : `no .rx program found under ${root}; set --root or pass --entry`);
    return s.entries;
  }
  function buildDiagnostics(s, entry) {
    const builds = s.builds ??= new Map();
    if (!builds.has(entry)) {
      const frontend = frontends.get(entry);
      const native = frontend ? undefined : nativeCompiler();
      const out = frontend ? frontend.check() : JSON.parse(native?.app ? native.app(entry, "dom", null, spa, null, null, null, declare)
        : compiler(root, ["app", entry, ...(spa ? ["--spa"] : [])]));
      builds.set(entry, out.diagnostics?.length ? out.diagnostics : out.error
        ? [{ file: entry, code: "BUILD", message: out.error }] : []);
    }
    return builds.get(entry);
  }
  function load() {
    const s = snapshot();
    if (!s.graph) {
      if (!s.entries.length) requireEntries(s);
      const modules = new Map(), stale = [], failures = [], freshness = [];
      const files = s.files ?? scan(root);
      const stamps = new Map(JSON.parse(stampOf(files, s.entries)));
      for (const entry of s.entries) {
        let saved;
        let fresh = false;
        try {
          const diagnostics = buildDiagnostics(s, entry);
          if (diagnostics.length) throw Object.assign(new Error(diagnostics.map(d => d.msg ?? d.message).join("\n")), { diagnostics });
          const model = frontends.get(entry)?.model() ?? modelOf([entry], root, true);
          const texts = new Map(model.map(m => {
            const f = resolve(root, m.file);
            let text; try { text = readFileSync(f, "utf8"); } catch { text = ""; }
            return [f, text];
          }));
          saved = { model, texts, stamps: entryStamps(stamps, texts), at: new Date().toISOString() };
          lastGood.set(entry, saved);
          fresh = true;
        } catch (e) {
          failures.push(e);
          saved = lastGood.get(entry);
          if (!saved) { freshness.push({ entry: where(root, entry), status: "no good build", modules: [] }); continue; }
          const now = entryStamps(stamps, saved.texts);
          const changed = [...new Set([...now.keys(), ...saved.stamps.keys()])]
            .filter(f => now.get(f) !== saved.stamps.get(f)).map(f => where(root, f));
          stale.push({ at: saved.at, changed });
        }
        freshness.push({ entry: where(root, entry), status: fresh ? "current" : "last good build",
          ...(!fresh ? { at: saved.at } : {}), modules: [...saved.texts.keys()].map(f => where(root, f)) });
        for (const m of saved.model) {
          const path = resolve(root, m.file);
          const prev = modules.get(path);
          if (!prev || fresh && !prev.fresh) modules.set(path, { model: m, text: saved.texts.get(path), fresh });
        }
      }
      if (failures.length && !modules.size) throw failures[0];
      if (failures.length) {
        let count;
        try { count = check().length; } catch {}
        count ||= failures.reduce((n, e) => n + (e.diagnostics?.length || 1), 0);
        const changed = [...new Set(stale.flatMap(x => x.changed))].sort().join(", ") || "(unknown)";
        const at = stale.map(x => x.at).sort()[0];
        s.warning = `program has ${count} error${count === 1 ? "" : "s"}; ${at
          ? `answers from the last good build at ${at}; changed since: ${changed}` : "answers omit entries with no good build"}`;
      }
      s.model = [...modules.values()].map(m => m.model);
      s.graph = buildGraph(structuredClone(s.model), { root, source: path => modules.get(path)?.text ?? "" });
      s.graph.freshness = freshness;
      s.graph.moduleFreshness = [...modules].map(([file, m]) => ({ file: where(root, file), current: m.fresh }));
      // Imported modules outside the scanned tree must also invalidate the snapshot.
      // So must the TS modules a generated declaration read (MO-11), and under $RXC each import's `decl.from`.
      for (const n of s.graph.nodes) if (n.decl?.from) declFiles.add(resolve(root, n.decl.from));
      if (!managed) s.stamp = stampOf(s.files, [...s.graph.absModules, ...declFiles]);
    }
    return s;
  }
  function entryStamps(stamps, texts) {
    const out = new Map(stamps);
    for (const file of texts.keys()) if (!out.has(file)) out.set(file, statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? null);
    return out;
  }
  function check(force = false) {
    const s = snapshot();
    if (force && frontends.size) { delete s.builds; delete s.diagnostics; }
    if (!s.diagnostics) {
      const entries = requireEntries(s);
      const data = frontends.size ? null : JSON.parse(compiler(root, ["check", "--json", ...(spa ? ["--spa"] : []), ...entries], true));
      const unique = new Map();
      const diagnostics = data?.diagnostics.length ? data.diagnostics : entries.flatMap(f => buildDiagnostics(s, f));
      for (const d of diagnostics) {
        const diag = { file: isAbsolute(d.file) ? where(root, d.file) : d.file,
          line: d.range?.start?.line ?? d.line ?? 1, column: (d.range?.start?.column ?? 0) + 1,
          severity: "error", code: d.code, message: plain(d.message ?? d.msg) };
        if (diag.code === "ASYNC_OUTSIDE_LOADING_BOUNDARY" && /a reader of …/.test(diag.message)) {
          try {
            const line = readFileSync(resolve(root, diag.file), "utf8").split(/\r?\n/)[diag.line - 1];
            const reader = line?.match(/\bpending\?\s+[\w$.]+/)?.[0] ?? line?.trim();
            if (reader) diag.message = diag.message.replace("a reader of …", `\`${reader}\` at ${diag.file}:${diag.line}`);
          } catch {}
        }
        unique.set(JSON.stringify(diag), diag);
      }
      if (frontends.size) return s.diagnostics = [...unique.values()];
      // Run the project's own Volar/TypeScript projection, when installed.
      let tsc;
      try { tsc = require.resolve("@reactivescript/language-server/bin/tsc.js"); } catch {}
      if (tsc && statSync(join(root, "tsconfig.json"), { throwIfNoEntry: false })?.isFile()) {
        let output;
        try { output = run(root, process.execPath, [tsc, "--noEmit", "--pretty", "false"]); }
        catch (e) { output = e.stdout || e.stderr; if (!output) throw e; }
        for (const text of plain(output).split(/\r?\n/)) {
          const match = text.match(/^(.*)\((\d+),(\d+)\): (error) (TS\d+): (.*)$/)
            ?? text.match(/^(.*):(\d+):(\d+) - (error) ([A-Z][A-Z_0-9]+): (.*)$/);
          if (!match) continue;
          const [, file, line, column, severity, code, message] = match;
          const rel = isAbsolute(file) ? where(root, file) : file;
          const diag = { file: rel, line: +line, column: +column, severity, code, message };
          if (![...unique.values()].some(d => d.file === rel && d.line === +line && d.code === code)) unique.set(JSON.stringify(diag), diag);
        }
      }
      s.diagnostics = [...unique.values()];
    }
    return s.diagnostics;
  }
  function staleTransforms() {
    return [...frontends].flatMap(([entry, frontend]) => {
      const files = frontend.transformed?.();
      if (!files?.length) return [];
      const file = where(root, entry);
      return [{ file, files: files.map(f => where(root, f)),
        fix: `Touch ${file} and reload the page. If it is still stale, restart the Vite dev server and reload.` }];
    });
  }
  function diff(ref) {
    const s = load();
    const top = run(root, "git", ["rev-parse", "--show-toplevel"]).trim();
    const sha = run(top, "git", ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).trim();
    const scratch = mkdtempSync(join(tmpdir(), "rx-map-"));
    try {
      const archive = run(top, "git", ["archive", sha], { encoding: null });
      run(scratch, "tar", ["-xf", "-"], { input: archive, stdio: ["pipe", "pipe", "pipe"] });
      const beforeRoot = resolve(scratch, relative(top, root));
      mkdirSync(beforeRoot, { recursive: true });
      const files = s.entries.map(f => {
        const p = relative(top, f);
        if (p === ".." || p.startsWith("../") || isAbsolute(p)) throw new Error(`entry ${f} is outside the Git checkout`);
        return resolve(scratch, p);
      }).filter(isEntry);
      const before = buildGraph(modelOf(files, beforeRoot), { root: beforeRoot });
      before.label = `${ref} (${sha.slice(0, 7)})`;
      const graph = diffGraphs(before, { ...s.graph, label: s.warning ? "last good build" : "working tree" });
      if (s.warning) graph.warning = s.warning;
      graph.freshness = s.graph.freshness;
      return graph;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  return { load, check, diff, staleTransforms };
}
