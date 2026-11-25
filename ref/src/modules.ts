// 09-modules: a program is a set of `.rx` modules. The loader resolves each `.rx` import to a path, parses every module once,
// and orders them dependencies first (MO-1). A cycle is refused (MO-5): signatures are computed in that order.
import { parseProgram, parseDeclarations, ParseError, type JsDecl } from "./parse.ts";
import type { Program } from "./ast.ts";
import type { Diagnostic } from "./errors.ts";
import { importRowOnTs } from "./check.ts";
import type { ModSig } from "./check.ts";
import { parseSignature, SignatureError } from "./signature.ts";

export type ModuleSet = { entry: string; programs: Map<string, Program>; order: string[]; diags: Diagnostic[]; declarations?: Map<string, JsDecl[]>; signatures?: Map<string, ModSig>; jsFiles?: Set<string> };   // declarations: MO-8, by `.d.rx` path; signatures: MO-9, by `.rx` path

export const isRx = (from: string) => /\.rx$/.test(from);

/** POSIX-style join and normalisation, for module keys (no file system involved). */
export function joinPath(fromFile: string, rel: string): string {
  const base = fromFile.split("/").slice(0, -1);
  const parts = rel.startsWith("/") ? [] : base;
  for (const seg of rel.split("/")) { if (seg === "" || seg === ".") continue; if (seg === "..") { if (parts.length && parts[parts.length - 1] !== "..") parts.pop(); else parts.push(".."); } else parts.push(seg); }
  return (rel.startsWith("/") ? "/" : "") + parts.join("/");
}

/** MO-10c: the file a package import resolves to, as a bundler finds it — `node_modules` up from the importer, the package's
 *  `exports` (a subpath, then the first of its conditions that a Solid build sets, in the package's order; `*` patterns),
 *  else `module` or `main`. Its declaration is beside it: the same name, `.d.rx`. */
const CONDITIONS = new Set(["solid", "browser", "import", "default"]);
export function packageDeclaration(fromFile: string, spec: string, read: (path: string) => string | undefined): string | undefined {
  const seg = spec.split("/"); const n = spec.startsWith("@") ? 2 : 1; if (seg.length < n || seg.slice(0, n).some(x => !x)) return undefined;
  const pkg = seg.slice(0, n).join("/"); const sub = seg.length > n ? "./" + seg.slice(n).join("/") : ".";
  const dirs = fromFile.split("/").slice(0, -1);
  for (let i = dirs.length; i >= (fromFile.startsWith("/") ? 1 : 0); i--) {
    const root = [...dirs.slice(0, i), "node_modules", pkg].join("/"); const pj = read(root + "/package.json"); if (pj === undefined) continue;
    let json: any; try { json = JSON.parse(pj); } catch { return undefined; }
    const pick = (t: unknown): string | undefined => {
      if (typeof t === "string") return t;
      if (Array.isArray(t)) { for (const x of t) { const r = pick(x); if (r) return r; } return undefined; }
      if (t && typeof t === "object") { for (const [k, v] of Object.entries(t)) if (CONDITIONS.has(k)) { const r = pick(v); if (r) return r; } }
      return undefined;
    };
    let target: string | undefined;
    const ex = json.exports;
    if (ex !== undefined) {
      const map: Record<string, unknown> | null = typeof ex === "object" && ex && !Array.isArray(ex) && Object.keys(ex).some(k => k.startsWith(".")) ? ex : null;
      if (!map) target = sub === "." ? pick(ex) : undefined;
      else if (sub in map) target = pick(map[sub]);
      else for (const [k, v] of Object.entries(map)) { const star = k.indexOf("*"); if (star < 0) continue; const pre = k.slice(0, star), post = k.slice(star + 1); if (sub.startsWith(pre) && sub.endsWith(post) && sub.length >= pre.length + post.length) { const t = pick(v); if (t) target = t.split("*").join(sub.slice(pre.length, sub.length - post.length)); break; } }
    } else target = sub === "." ? (typeof json.module === "string" ? json.module : typeof json.main === "string" ? json.main : "./index.js") : sub;
    if (!target) return undefined;
    return joinPath(root + "/package.json", target).replace(/\.(m?js|cjs|jsx|ts|tsx)$/, "") + ".d.rx";
  }
  return undefined;
}

/** MO-11a: the TS module for a stem, the first of these that exists. */
export const TS_CANDIDATES = [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".d.mts", "/index.ts", "/index.tsx", "/index.d.ts"];
/** MO-11d: what a generator answers at `rx-dts:<stem>` — the generated text, its diagnostics (in the TS module), and every file it
 *  read (for staleness). */
export type DtsRecord = { from: string; text: string; errors: { file: string; line: number; column: number; code: string; message: string }[]; files: string[] };
/** The key a host answers with a stem's record, as JSON (`null`: none). */
export const dtsKey = (stem: string) => "rx-dts:" + stem;
export function readRecord(read: (path: string) => string | undefined, stem: string): DtsRecord | undefined {
  const s = read(dtsKey(stem)); if (s === undefined) return undefined;
  let j: unknown; try { j = JSON.parse(s); } catch { return undefined; }
  if (!j || typeof j !== "object" || typeof (j as DtsRecord).text !== "string" || typeof (j as DtsRecord).from !== "string") return undefined;
  const r = j as DtsRecord;
  return { from: r.from, text: r.text, errors: Array.isArray(r.errors) ? r.errors : [], files: Array.isArray(r.files) ? r.files : [] };
}
const base = (p: string) => p.split("/").pop() ?? p;
const ruleOf = (code: string) => code === "DECLARATION_HELPER" ? "MO-11c" : code === "DECLARATION_UNAVAILABLE" ? "MO-11d" : "MO-11";
export const UNAVAILABLE_FIX = "install the generator, `npm i -D @reactivescript/compiler typescript`, or set RX_DTS to a command that prints it (`rx-dts --record <stem>`)";

/** Load `entry` and everything it imports from `.rx`. `read` returns a module's source, or undefined when there is none. */
export function loadModules(entry: string, read: (path: string) => string | undefined): ModuleSet {
  const programs = new Map<string, Program>(); const order: string[] = []; const diags: Diagnostic[] = []; const declarations = new Map<string, JsDecl[]>(); const signatures = new Map<string, ModSig>();
  const jsFiles = new Set<string>();
  const state = new Map<string, "busy" | "done">();
  const declDiag = (code: string, line: number, file: string, msg: string) => { diags.push({ code, rule: "MO-8", line, file, msg }); };
  const tsModule = (stem: string) => TS_CANDIDATES.map(x => stem + x).find(p => read(p) !== undefined);
  /** MO-8e: `./x` in a `.d.rx` is `x.d.rx`, else the TS module's generated declaration (MO-11), else `x.rx`. A path ending in `.rx` is that module. */
  const declTarget = (fromFile: string, spec: string): { path: string; rx: boolean; ts?: string } | undefined => {
    if (!spec.startsWith(".") && !spec.startsWith("/")) return undefined;
    const s = spec.replace(/\.(mjs|js|ts)$/, "");
    if (s.endsWith(".d.rx")) { const p = joinPath(fromFile, s); return read(p) !== undefined ? { path: p, rx: false } : undefined; }
    if (s.endsWith(".rx")) { const p = joinPath(fromFile, s); return read(p) !== undefined ? { path: p, rx: true } : undefined; }
    const stem = joinPath(fromFile, s);
    if (read(stem + ".d.rx") !== undefined) return { path: stem + ".d.rx", rx: false };
    const ts = tsModule(stem); if (ts) return { path: stem + ".d.rx", rx: false, ts };
    if (read(stem + ".rx") !== undefined) return { path: stem + ".rx", rx: true };
    return undefined;
  };
  /** MO-11: a relative JS import's declaration, `<stem>.d.rx` — the written file (W), the one generated from the TS module (G), or
   *  both merged per export (MO-11e: W's line where W declares the name). False: there is a TS module and no generator answered. */
  const loadJsDeclaration = (stem: string): boolean => {
    const dts = stem + ".d.rx";
    if (declarations.has(dts)) return true;
    const ts = tsModule(stem);
    const rec = ts ? readRecord(read, stem) : undefined;
    const written = read(dts);
    if (!rec) { if (written !== undefined) { loadDeclaration(dts); return true; } return !ts; }      // MO-8, unchanged
    for (const e of rec.errors) diags.push({ code: e.code, rule: ruleOf(e.code), line: e.line, file: e.file, msg: e.message });
    if (written === undefined && rec.errors.some(e => e.code === "DECLARATION_UNAVAILABLE")) return true;   // reported at the TS module
    let gen: JsDecl[];
    try { gen = parseDeclarations(rec.text, true); } catch (e) { if (e instanceof ParseError) throw Object.assign(new ParseError(`${dts} (generated from ${rec.from}): ${e.message}`), { code: e.code }); throw e; }
    gen = gen.filter(x => x.kind !== "import").map(x => ({ ...x, origin: "generated" as const, generatedFrom: rec.from }));
    if (written === undefined) { declarations.set(dts, gen); return true; }
    let ws: JsDecl[];
    try { ws = parseDeclarations(written); } catch (e) { if (e instanceof ParseError) throw Object.assign(new ParseError(`${dts}: ${e.message}`), { code: e.code }); throw e; }
    ws = ws.map(x => x.kind === "import" ? x : { ...x, origin: "written" as const });
    const exportsOf = (ds: JsDecl[]) => new Set(ds.filter(x => x.kind !== "import" && (x.kind !== "type" || x.exported)).map(x => (x as { name: string }).name));
    const mine = exportsOf(ws), theirs = exportsOf(gen);
    for (const x of ws) if (x.kind !== "import" && x.kind !== "type" && !theirs.has(x.name))   // a written type is the declaration's own: it binds no value
      diags.push({ code: "NOT_EXPORTED", rule: "MO-11e", line: x.line, file: dts, msg: `${base(dts)}: ${base(rec.from)} exports no ${x.name} — a written line overrides an export of the TS module; remove the line, or export ${x.name} from ${base(rec.from)}` });
    declarations.set(dts, [...ws, ...gen.filter(x => !mine.has((x as { name: string }).name))]);
    resolveDeclImports(dts);
    return true;
  };
  const rxKind = (path: string, name: string): "type" | "value" | "missing" => {
    const decls = programs.get(path)?.decls ?? (() => { const src = read(path); if (src === undefined) return undefined; try { return parseProgram(src).decls; } catch { return undefined; } })();
    if (!decls) return "missing";
    const d = decls.find(x => "name" in x && x.name === name && !!(x as { exported?: boolean }).exported);
    if (!d) return "missing";
    return d.k === "typedecl" ? "type" : "value";
  };
  const loadDeclaration = (dts: string) => {
    if (declarations.has(dts)) return;
    const src = read(dts); if (src === undefined) return;
    let ds: JsDecl[];
    try { ds = parseDeclarations(src); } catch (e) { if (e instanceof ParseError) throw Object.assign(new ParseError(`${dts}: ${e.message}`), { code: e.code }); throw e; }
    declarations.set(dts, ds);
    resolveDeclImports(dts);
  };
  const resolveDeclImports = (file: string) => {
    const ds = declarations.get(file); if (!ds) return;
    const who = file.split("/").pop() ?? file;
    for (const d of ds) {
      if (d.kind !== "import") continue;
      const hit = declTarget(file, d.from);
      if (!hit) { declDiag("MODULE_NOT_FOUND", d.line, file, `${who}: no module ${d.from} (a \`.d.rx\` imports types from a \`.d.rx\` or an \`.rx\`)`); continue; }
      d.target = hit.path; d.rx = hit.rx;
      if (hit.ts && !loadJsDeclaration(hit.path.slice(0, -".d.rx".length))) {
        diags.push({ code: "DECLARATION_UNAVAILABLE", rule: "MO-11d", line: d.line, file, msg: `${who}: ${d.from} is the TS module ${base(hit.ts)}, whose declaration is generated (MO-11d), and no generator answered: ${UNAVAILABLE_FIX}` });
        continue;
      }
      if (!hit.rx) {
        loadDeclaration(hit.path);
        const td = declarations.get(hit.path) ?? [];
        const where = hit.path.split("/").pop();
        for (const n of d.names) {
          const x = td.find(y => y.kind !== "import" && y.name === n.name && (y.kind !== "type" || y.exported));
          if (!x) declDiag("NOT_EXPORTED", d.line, file, `${who}: ${where} exports no type ${n.name}`);
          else if (x.kind === "fn" || x.kind === "const") declDiag("TYPE_IMPORT", d.line, file, `${who}: \`${n.name}\` is a value, not a type — a declaration file imports types only (\`import { T } from "./x"\`)`);
        }
        continue;
      }
      if (state.get(hit.path) !== "done" && state.get(hit.path) !== "busy") visit(hit.path, []);
      for (const n of d.names) {
        const k = rxKind(hit.path, n.name);
        if (k === "missing") declDiag("NOT_EXPORTED", d.line, file, `${who}: ${hit.path.split("/").pop()} exports no type ${n.name}`);
        else if (k === "value") declDiag("TYPE_IMPORT", d.line, file, `${who}: \`${n.name}\` is a value, not a type — a declaration file imports types only (\`import { T } from "./x"\`)`);
      }
    }
  };
  const visit = (path: string, stack: string[]) => {
    if (state.get(path) === "done") return;
    const src = read(path);
    if (src === undefined) return;                                    // reported at the import that names it
    let p: Program;
    try { p = parseProgram(src); } catch (e) { if (e instanceof ParseError) throw Object.assign(new ParseError(`${path}: ${e.message}`), { code: e.code }); throw e; }
    programs.set(path, p); state.set(path, "busy");
    for (const d of p.decls) {
      // MO-8c: a local file takes precedence over any scenario prelude. Keep
      // the specifier itself unchanged for the bundler.
      if (d.k === "import" && !isRx(d.from) && d.from.startsWith(".")) {
        const stem = joinPath(path, d.from);
        const exts = [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".cjs", ".cts", ".json"];
        if ([stem, ...exts.flatMap(ext => [stem + ext, stem + "/index" + ext]), stem + "/package.json"].some(p => read(p) !== undefined)) jsFiles.add(stem);
      }
      const pkgDts = d.k === "import" && !isRx(d.from) && !d.from.startsWith(".") && !d.from.startsWith("/") ? packageDeclaration(path, d.from, read) : undefined;   // MO-10c
      if (d.k === "import" && !isRx(d.from) && (d.from.startsWith(".") || pkgDts)) {             // MO-8: a JS module with a declaration file beside it
        const dts = pkgDts ?? joinPath(path, d.from.replace(/\.(m?js|ts)$/, "") + ".d.rx");
        const stem = dts.slice(0, -".d.rx".length);
        if (pkgDts) loadDeclaration(dts);
        else if (!loadJsDeclaration(stem)) {                                        // MO-11d: a TS module, and no generator
          const ts = tsModule(stem)!;
          diags.push({ code: "DECLARATION_UNAVAILABLE", rule: "MO-11d", line: d.line, file: path, msg: `${d.from} is the TS module ${base(ts)}, whose declaration is generated (MO-11d), and no generator answered: ${UNAVAILABLE_FIX}` });
        }
        const ds = declarations.get(dts);
        const ts = !pkgDts && (d.pure || d.fails || d.side) ? tsModule(stem) : undefined;
        if (ts) for (const { name } of d.names) {
          const decl = ds?.find(x => x.kind !== "import" && x.name === name);
          if (decl?.kind === "type" || decl?.kind === "error") continue;
          const msg = importRowOnTs(name, base(ts), d.pure, d.fails, d.side, decl);
          if (msg) diags.push({ code: "IMPORT_ROW_ON_TS", rule: "MO-11e", line: d.line, file: path, msg });
        }
        if (ds) { d.declared = dts; d.declaredErrors = ds.filter(x => x.kind === "error").map(x => x.name); d.declaredPure = ds.filter(x => x.kind === "fn" && x.pure).map(x => x.name); d.declaredSide = Object.fromEntries(ds.flatMap(x => x.kind === "fn" && x.side ? [[x.name, x.side]] : [])); }
        continue;
      }
      if (d.k !== "import" || !isRx(d.from)) continue;
      const to = joinPath(path, d.from); d.resolved = to;
      if (state.get(to) === "busy") { diags.push({ code: "MODULE_CYCLE", rule: "MO-5", line: d.line, file: path, msg: `${[...stack, path].slice(stack.indexOf(to) >= 0 ? stack.indexOf(to) : 0).concat(to).join(" → ")}: modules may not import each other in a cycle (signatures are computed dependencies first)` }); continue; }
      if (state.get(to) !== "done" && !signatures.has(to) && read(to) === undefined) {   // MO-9: no body — its signature, read in place
        const sig = read(to.replace(/\.rx$/, ".d.rx"));
        if (sig !== undefined) { try { signatures.set(to, parseSignature(sig, to)); } catch (e) { if (e instanceof SignatureError) throw new ParseError(e.message); throw e; } continue; }
      }
      if (signatures.has(to)) continue;
      if (state.get(to) !== "done" && read(to) === undefined) { diags.push({ code: "MODULE_NOT_FOUND", rule: "MO-6", line: d.line, file: path, msg: `no module ${d.from} (from ${path})` }); continue; }
      visit(to, [...stack, path]);
    }
    state.set(path, "done"); order.push(path);
  };
  visit(entry, []);
  return { entry, programs, order, diags, declarations, signatures, jsFiles };
}

/** One program with no `.rx` imports — the common case, and every scenario before 09. */
export function singleModule(p: Program, entry = "main.rx"): ModuleSet { return { entry, programs: new Map([[entry, p]]), order: [entry], diags: [] }; }
