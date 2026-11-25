import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { buildGraph } from "./graph.mjs";
import { diffGraphs } from "./diff.mjs";

const run = (cwd, cmd, args, options = {}) => execFileSync(cmd, args, {
  cwd, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"], timeout: 30000, ...options,
});
export const plain = s => stripVTControlCharacters(String(s));
const where = (root, f) => relative(root, f).split("\\").join("/");

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

export function project({ root = process.cwd(), entries = [], rxc = process.env.RXC, spa = true, managed = false } = {}) {
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
  function modelOf(files, cwd) {
    if (!files.length) return [];
    if (!rxc) {
      if (napi === undefined) {
        let id;
        try { id = require.resolve("@reactivescript/compiler"); }
        catch (e) { if (e.code !== "MODULE_NOT_FOUND") throw e; }
        napi = id ? require(id).model ?? null : null;
      }
      if (napi) return JSON.parse(napi(files, cwd));
    }
    // The CLI prints one JSON array per entry. Merge shared dependencies once,
    // preserving each entry's dependency order.
    const modules = new Map();
    for (const f of files) {
      for (const m of JSON.parse(compiler(cwd, ["model", f]))) modules.set(resolve(cwd, m.file), m);
    }
    return [...modules.values()];
  }
  let cached;
  const stampOf = (files, deps = []) => JSON.stringify([...new Set([...files, ...entries, ...deps])].sort()
    .map(f => [f, statSync(f, { throwIfNoEntry: false })?.mtimeMs]));
  function snapshot() {
    if (managed) return cached ??= { entries, hasPrograms: entries.length > 0 };
    const files = scan(root);
    const stamp = stampOf(files, cached?.graph?.absModules);
    if (stamp !== cached?.stamp) {
      const selected = entries.length ? entries : discover(files);
      cached = { stamp, files, entries: selected, hasPrograms: files.some(f => !f.endsWith(".d.rx")) };
    }
    return cached;
  }
  function requireEntries(s) {
    if (!s.entries.length) throw new Error(s.hasPrograms
      ? "no entry found (imports may form a cycle); pass --entry to check a module"
      : `no .rx program found under ${root}; set --root or pass --entry`);
    for (const f of s.entries) if (!statSync(f, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`entry ${f} not found; check --root and --entry`);
    }
    return s.entries;
  }
  function load() {
    const s = snapshot();
    if (!s.graph) {
      s.model = modelOf(requireEntries(s), root);
      s.graph = buildGraph(structuredClone(s.model), { root });
      // Imported modules outside the scanned tree must also invalidate the snapshot.
      if (!managed) s.stamp = stampOf(s.files, s.graph.absModules);
    }
    return s;
  }
  function check() {
    const s = snapshot();
    if (!s.diagnostics) {
      const data = JSON.parse(compiler(root, ["check", "--json", ...(spa ? ["--spa"] : []), ...requireEntries(s)], true));
      const unique = new Map();
      for (const d of data.diagnostics) {
        const diag = { file: isAbsolute(d.file) ? where(root, d.file) : d.file,
          line: d.range?.start?.line ?? d.line ?? 1, column: (d.range?.start?.column ?? 0) + 1,
          severity: d.severity ?? "error", code: d.code, message: plain(d.message) };
        if (diag.code === "ASYNC_OUTSIDE_LOADING_BOUNDARY" && /a reader of …/.test(diag.message)) {
          try {
            const line = readFileSync(resolve(root, diag.file), "utf8").split(/\r?\n/)[diag.line - 1];
            const reader = line?.match(/\bpending\?\s+[\w$.]+/)?.[0] ?? line?.trim();
            if (reader) diag.message = diag.message.replace("a reader of …", `\`${reader}\` at ${diag.file}:${diag.line}`);
          } catch {}
        }
        unique.set(JSON.stringify(diag), diag);
      }
      // Run the project's own Volar/TypeScript projection, when installed.
      let tsc;
      try { tsc = require.resolve("@reactivescript/language-server/bin/tsc.js"); } catch {}
      if (tsc && statSync(join(root, "tsconfig.json"), { throwIfNoEntry: false })?.isFile()) {
        let output;
        try { output = run(root, process.execPath, [tsc, "--noEmit", "--pretty", "false"]); }
        catch (e) { output = e.stdout || e.stderr; if (!output) throw e; }
        for (const text of plain(output).split(/\r?\n/)) {
          const match = text.match(/^(.*)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/)
            ?? text.match(/^(.*):(\d+):(\d+) - (error|warning) ([A-Z][A-Z_0-9]+): (.*)$/);
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
      }).filter(f => statSync(f, { throwIfNoEntry: false })?.isFile());
      const before = buildGraph(modelOf(files, beforeRoot), { root: beforeRoot });
      before.label = `${ref} (${sha.slice(0, 7)})`;
      return diffGraphs(before, { ...s.graph, label: "working tree" });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  return { load, check, diff };
}
