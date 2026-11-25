// rx-dts: the declaration of a module TypeScript can read, generated from it (spec/09 MO-11). It reads the
// syntax and symbols of the `.ts` (not its type errors) and prints ordinary `.d.rx` rows: the facts the helpers
// of `@reactivescript/js` state (`export const f = pure(…)`, contract §0), the v1 brand types of the same
// package where they are written (still read, no longer documented), the sound default everywhere else.
// The types of a generated line are TypeScript's (13 TY-4b): the text shows them for a person only.
import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export const CANDIDATES = [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".d.mts", "/index.ts", "/index.tsx", "/index.d.ts"];
export const TS_EXTENSIONS = [".d.ts", ".d.mts", ".d.cts", ".ts", ".tsx", ".mts", ".cts"];
const WRAPPERS = ["Pure", "Rejects", "Instantiates", "Server", "Client"];
const BRANDS = new Set([...WRAPPERS, "Ref"]);
const PACKAGE = "@reactivescript/js";
const HELPERS = new Set(["pure", "rejects", "ref", "instantiates", "server", "client"]);
// the row a helper sets, in the brand vocabulary `fnLine` prints
const FACT = { pure: "Pure", rejects: "Rejects", instantiates: "Instantiates", server: "Server", client: "Client" };
const FORM = { pure: "pure(fn)", rejects: "rejects([NotFound], fn)", ref: "ref({ args: [0], result: true }, fn)", instantiates: "instantiates(fn)", server: "server(fn)", client: "client(fn)" };
const HEAD = { Pure: "Pure<R>", Rejects: "Rejects<Promise<T>, E>", Instantiates: "Instantiates<R>", Server: "Server<R>", Client: "Client<R>" };

const posix = p => p.replace(/\\/g, "/");
const collapse = s => s.replace(/\s+/g, " ").trim();
const sha1 = s => createHash("sha1").update(s).digest("hex");

/** The TS module for a stem (contract §4 order), or null. */
export function findModule(stem, fileExists = diskFileExists) {
  for (const c of CANDIDATES) if (fileExists(stem + c)) return stem + c;
  return null;
}

function diskFileExists(f) {
  try { return statSync(f).isFile(); } catch { return false; }
}

function diskStamp(f) {
  try { const s = statSync(f); return `${s.mtimeMs}:${s.size}`; } catch { return "-"; }
}

/** A stem for a `.ts` file: the path without its TS extension. */
export function stemOf(file) {
  const f = posix(file);
  for (const e of TS_EXTENSIONS) if (f.endsWith(e)) return f.slice(0, -e.length);
  return f;
}

export function createDeclarations({ ts: given, read, fileExists, cwd } = {}) {
  const memory = typeof read === "function";
  const libDirs = new Set();
  const isLib = f => { for (const d of libDirs) if (f.startsWith(d)) return true; return false; };
  const diskText = f => { try { return readFileSync(f, "utf8"); } catch { return undefined; } };
  const readText = !memory ? diskText : f => {
    if (isLib(f)) return diskText(f);
    try { const t = read(f); return t == null ? undefined : String(t); } catch { return undefined; }
  };
  const exists = fileExists
    ? (f => (memory && isLib(f) ? diskFileExists(f) : fileExists(f)))
    : memory ? (f => readText(f) !== undefined) : diskFileExists;
  const stamp = f => {
    if (isLib(f)) return "lib";
    if (!memory) return diskStamp(f);
    const t = readText(f);
    return t === undefined ? "-" : sha1(t);
  };
  const base = posix(path.resolve(cwd ?? process.cwd()));
  const abs = p => posix(path.posix.isAbsolute(posix(p)) || path.isAbsolute(p) ? posix(path.resolve(p)) : path.posix.resolve(base, posix(p)));

  // ---- TypeScript, one per directory's resolution; one LanguageService per tsconfig root
  const tsByDir = new Map();
  function tsFor(T) {
    if (given) return remember(given);
    const dir = path.posix.dirname(T);
    if (tsByDir.has(dir)) return tsByDir.get(dir);
    let ts, from;
    for (const at of [path.join(dir, "x.js"), import.meta.url]) {
      try { from = createRequire(at).resolve("typescript"); ts = createRequire(at)("typescript"); break; } catch {}
    }
    if (!ts) throw new Error(`rx-dts: TypeScript is not installed (looked from ${dir} and from @reactivescript/compiler). Install it: npm i -D typescript`);
    if (process.env.RX_DTS_TRACE) process.stderr.write(`rx-dts: loaded typescript ${ts.version} from ${from}\n`);
    tsByDir.set(dir, remember(ts));
    return ts;
  }
  function remember(ts) {
    libDirs.add(posix(path.dirname(ts.getDefaultLibFilePath({}))) + "/");
    return ts;
  }

  const services = new Map(); // ts → Map(config key → service)
  function findUp(dir, name) {
    for (let d = dir; ; d = path.posix.dirname(d)) {
      const f = `${d === "/" ? "" : d}/${name}`;
      if (exists(f)) return f;
      if (d === path.posix.dirname(d)) return null;
    }
  }
  function serviceFor(ts, T) {
    const config = findUp(path.posix.dirname(T), "tsconfig.json");
    let byConfig = services.get(ts);
    if (!byConfig) services.set(ts, byConfig = new Map());
    const key = config ?? "<default>";
    let svc = byConfig.get(key);
    if (!svc) byConfig.set(key, svc = makeService(ts, config));
    return svc;
  }
  function makeService(ts, config) {
    const dir = config ? path.posix.dirname(config) : base;
    let options;
    if (config) {
      const json = ts.readConfigFile(config, readText);
      const host = { useCaseSensitiveFileNames: true, readDirectory: () => [], fileExists: exists, readFile: readText };
      options = ts.parseJsonConfigFileContent(json.config ?? {}, host, dir, undefined, config).options;
    } else {
      options = {
        strict: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.Preserve, allowJs: false, skipLibCheck: true,
      };
    }
    options = { ...options, noEmit: true };
    const roots = new Set();
    const host = {
      getCompilationSettings: () => options,
      getScriptFileNames: () => [...roots],
      getScriptVersion: f => stamp(posix(f)),
      getScriptSnapshot: f => { const t = readText(posix(f)); return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t); },
      getCurrentDirectory: () => dir,
      getDefaultLibFileName: o => ts.getDefaultLibFilePath(o),
      fileExists: f => exists(posix(f)),
      readFile: f => readText(posix(f)),
      useCaseSensitiveFileNames: () => true,
      ...(memory ? {} : {
        directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories, realpath: ts.sys.realpath,
      }),
    };
    return { roots, ls: ts.createLanguageService(host, ts.createDocumentRegistry()) };
  }

  // ---- is a declaration in @reactivescript/js (nearest package.json, cached per directory)
  const pkgByDir = new Map();
  function packageName(dir) {
    if (pkgByDir.has(dir)) return pkgByDir.get(dir);
    let name = null;
    const pj = `${dir === "/" ? "" : dir}/package.json`;
    if (exists(pj)) {
      try { name = JSON.parse(readText(pj)).name ?? null; } catch { name = null; }
    } else if (dir !== path.posix.dirname(dir)) name = packageName(path.posix.dirname(dir));
    pkgByDir.set(dir, name);
    return name;
  }
  const inPackage = f => posix(f).includes(`/node_modules/${PACKAGE}/`) || packageName(path.posix.dirname(posix(f))) === PACKAGE;

  // ---- records, memoized by the stamps of the files they depend on
  const memo = new Map();
  function generateFile(T) {
    const hit = memo.get(T);
    if (hit && hit.stamps.every(([f, s]) => stamp(f) === s)) return hit.record;
    const ts = tsFor(T);
    const svc = serviceFor(ts, T);
    svc.roots.add(T);
    const program = svc.ls.getProgram();
    const record = generate(ts, program, T, { inPackage, isLib });
    memo.set(T, { record, stamps: record.files.map(f => [f, stamp(f)]) });
    return record;
  }

  const subs = new WeakMap();
  function record(stem, files) {
    if (files) {
      let sub = subs.get(files);
      if (!sub) {
        const get = files instanceof Map ? f => files.get(f) : f => files[f];
        subs.set(files, sub = createDeclarations({ ts: given, read: get, cwd }));
      }
      return sub.record(stem);
    }
    const T = findModule(abs(stem), exists);
    return T ? generateFile(T) : null;
  }
  const file = tsFile => generateFile(abs(tsFile));
  return { record, file, text: tsFile => file(tsFile).text };
}

// ------------------------------------------------------------------------------------------------------------
// One module's record

function generate(ts, program, T, { inPackage, isLib }) {
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(T);
  const errors = [], seenErrors = new Set();
  const files = new Set([T]);
  const lines = []; // [position in T, position at the original (export *), order, text]
  const S = ts.SymbolFlags;
  const header = `// generated by rx-dts from ./${path.posix.basename(T)}: rows only; the types are TypeScript's (13 TY-4b)`;
  const done = () => ({
    from: T, text: [header, ...lines.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).map(l => l[3])].join("\n") + "\n",
    errors: errors.sort((a, b) => (a.file === b.file ? 0 : a.file === T ? -1 : b.file === T ? 1 : a.file < b.file ? -1 : 1) || a.line - b.line || a.column - b.column),
    files: [...files],
  });
  if (!sf) return done();

  const where = node => {
    const s = node.getSourceFile();
    const { line, character } = s.getLineAndCharacterOfPosition(node.getStart(s));
    return { file: posix(s.fileName), line: line + 1, column: character };
  };
  const report = (node, message, code = "DECLARATION_HELPER") => {
    const at = where(node);
    const key = `${at.file}:${at.line}:${at.column}:${message}`;
    if (seenErrors.has(key)) return;
    seenErrors.add(key);
    errors.push({ ...at, code, message });
  };
  const addFile = node => {
    const f = posix((node.getSourceFile?.() ?? node).fileName);
    if (!isLib(f)) files.add(f);
  };

  const exportEquals = sf.statements.find(s => ts.isExportAssignment(s) && s.isExportEquals);
  if (exportEquals) {
    report(exportEquals, "`export =` is a CommonJS export, which .rx cannot import as an ES module: write ES exports (`export function …`), or declare it in a `.d.rx` beside it", "DECLARATION_UNAVAILABLE");
    return done();
  }

  const strip = n => { while (n && ts.isParenthesizedTypeNode(n)) n = n.type; return n; };
  let enclosing = null; // the file a helper's implementation is in, so its types print as that file names them
  const printType = type => {
    const s = checker.typeToString(type, enclosing ?? sf, ts.TypeFormatFlags.NoTruncation);
    return /import\(|\n/.test(s) ? "any" : collapse(s);
  };

  function brandOf(node) {
    if (!node || !ts.isTypeReferenceNode(node)) return null;
    const id = ts.isQualifiedName(node.typeName) ? node.typeName.right : node.typeName;
    let sym = checker.getSymbolAtLocation(id);
    if (!sym) return null;
    if (sym.flags & S.Alias) { try { sym = checker.getAliasedSymbol(sym); } catch { return null; } }
    if (!(sym.flags & S.TypeAlias)) return null;
    const decl = sym.declarations?.find(ts.isTypeAliasDeclaration);
    if (!decl || !BRANDS.has(decl.name.text)) return null;
    return inPackage(decl.getSourceFile().fileName) ? decl.name.text : null;
  }

  const isLibError = sym => sym?.name === "Error" && (sym.declarations ?? []).some(d => isLib(posix(d.getSourceFile().fileName)) || program.isSourceFileDefaultLibrary(d.getSourceFile()));
  // the base chain of a class (or a lib interface such as TypeError) reaches the global Error
  function reachesError(type, chain, seen = new Set()) {
    if (!type || seen.has(type)) return false;
    seen.add(type);
    if (isLibError(type.symbol)) return true;
    if (!(type.flags & ts.TypeFlags.Object) || !(type.objectFlags & (ts.ObjectFlags.Class | ts.ObjectFlags.Interface))) return false;
    const target = type.target ?? type;
    for (const b of checker.getBaseTypes(target) ?? []) {
      if (reachesError(b, chain, seen)) { for (const d of type.symbol?.declarations ?? []) chain.push(d); return true; }
    }
    return false;
  }
  function errorClass(sym) {
    if (!sym) return null;
    const lib = (sym.declarations ?? []).some(d => isLib(posix(d.getSourceFile().fileName)));
    if (!(sym.flags & S.Class) && !lib) return null;
    const chain = [];
    if (!reachesError(checker.getDeclaredTypeOfSymbol(sym), chain)) return null;
    return chain;
  }

  // ---- display: the written text, with Ref<X> as `ref X` where it is read and wrappers peeled
  function show(node, refs, top = true) {
    const s = node.getSourceFile();
    const own = brandOf(strip(node));
    if (own) return showBrand(strip(node), own, refs, top);
    let out = "", pos = node.getStart(s);
    const visit = n => {
      const b = ts.isTypeReferenceNode(n) && brandOf(n);
      if (b) { out += s.text.slice(pos, n.getStart(s)) + showBrand(n, b, refs, false); pos = n.getEnd(); }
      else ts.forEachChild(n, visit);
    };
    ts.forEachChild(node, visit);
    return collapse(out + s.text.slice(pos, node.getEnd()));
  }
  function showBrand(n, b, refs, top) {
    const arg = n.typeArguments?.[0];
    if (!arg) return "any";
    if (b !== "Ref") return show(arg, refs, top);
    const inner = show(arg, refs, true);
    const a = strip(arg);
    const loose = ts.isUnionTypeNode(a) || ts.isIntersectionTypeNode(a) || ts.isFunctionTypeNode(a) || ts.isConstructorTypeNode(a) || ts.isConditionalTypeNode(a);
    if (refs.has(n)) return `ref ${loose ? `(${inner})` : inner}`;
    return top ? `() => ${inner}` : `(() => ${inner})`;
  }

  // ---- one call signature written in syntax: its rows and its display
  function readSignature(sig, name) {
    const allowed = new Set(), refs = new Set(), brands = new Map();
    const refParams = [], refParts = [];
    let errored = false, rejectsNode = null, rejects = [];
    const fail = (node, message) => { report(node, message); errored = true; };

    let result = null;
    if (sig.type) {
      let cur = sig.type;
      for (;;) {
        cur = strip(cur);
        const b = brandOf(cur);
        if (!b || b === "Ref") break;
        allowed.add(cur);
        if (brands.has(b)) fail(cur, `\`${b}<…>\` is written twice at the head of ${name}'s return type: write it once`);
        else brands.set(b, cur);
        if (b === "Rejects") rejectsNode = cur.typeArguments?.[1] ?? null;
        cur = cur.typeArguments?.[0];
        if (!cur) break;
      }
      result = cur ? strip(cur) : null;
    }
    if (brands.has("Server") && brands.has("Client")) {
      const later = [brands.get("Server"), brands.get("Client")].sort((x, y) => x.pos - y.pos)[1];
      fail(later, `\`Server<…>\` and \`Client<…>\` both mark ${name}: a fn runs on the server or on the client, not both (12 SF-5); keep one`);
    }
    if (result) {
      if (brandOf(result) === "Ref") { allowed.add(result); refs.add(result); refParts.push("result"); }
      else if (ts.isTupleTypeNode(result)) {
        result.elements.forEach((el, i) => {
          const e = strip(ts.isNamedTupleMember(el) ? el.type : el);
          if (brandOf(e) === "Ref") { allowed.add(e); refs.add(e); refParts.push(i); }
        });
      } else if (ts.isTypeLiteralNode(result)) {
        for (const m of result.members) {
          const e = ts.isPropertySignature(m) && strip(m.type);
          if (e && brandOf(e) === "Ref") { allowed.add(e); refs.add(e); refParts.push(m.name.getText()); }
        }
      }
    }
    const params = sig.parameters.filter(p => !(ts.isIdentifier(p.name) && p.name.text === "this"));
    params.forEach((p, i) => {
      const t = strip(p.type);
      if (!t || brandOf(t) !== "Ref") return;
      allowed.add(t);
      const pn = ts.isIdentifier(p.name) ? p.name.text : `_${i}`;
      if (p.dotDotDotToken) fail(t, `\`Ref<T>\` cannot mark the rest parameter ...${pn}: a ref argument is one accessor; declare it as its own parameter \`${pn}: Ref<T>\``);
      else if (p.questionToken || p.initializer) fail(t, `\`Ref<T>\` cannot mark the optional parameter ${pn}: a ref argument is always passed; make it required (\`${pn}: Ref<T>\`)`);
      else if (!ts.isIdentifier(p.name)) fail(t, `\`Ref<T>\` cannot mark a destructured parameter: name it (\`(p: Ref<T>)\`) and destructure inside`);
      else { refs.add(t); refParams.push(i); }
    });

    // every other brand in the signature is misplaced
    const scan = (node, inParam) => {
      const visit = n => {
        if (ts.isTypeReferenceNode(n) && !allowed.has(n)) {
          const b = brandOf(n);
          if (b === "Ref") fail(n, inParam
            ? `\`Ref<T>\` marks a whole parameter (\`p: Ref<T>\`), not a part of one: write the accessor inside as \`() => T\``
            : `\`Ref<T>\` marks the result, a top-level element of a returned tuple or a property of a returned object type (MO-10b); nested deeper it is a value: write \`() => T\``);
          else if (b) fail(n, inParam
            ? `\`${b}<…>\` marks the return type, not a parameter: \`function ${name}(…): ${HEAD[b]}\``
            : `\`${b}<…>\` goes at the head of the return type: \`function ${name}(…): ${HEAD[b]}\``);
        }
        ts.forEachChild(n, visit);
      };
      visit(node);
    };
    for (const tp of sig.typeParameters ?? []) scan(tp, true);
    for (const p of params) if (p.type) scan(p.type, true);
    if (sig.type) scan(sig.type, false);

    if (rejectsNode) {
      const members = [];
      const split = n => { n = strip(n); if (ts.isUnionTypeNode(n)) n.types.forEach(split); else members.push(n); };
      split(rejectsNode);
      for (const m of members) {
        if (m.kind === ts.SyntaxKind.NeverKeyword) continue;   // `Rejects<P, never>`: `rejects(nothing)`, as `rejects([], fn)`
        const type = checker.getTypeFromTypeNode(m);
        const chain = (ts.isTypeReferenceNode(m) || ts.isExpressionWithTypeArguments(m)) ? errorClass(type.symbol) : null;
        if (!chain) { fail(m, `\`Rejects<…, ${collapse(m.getText())}>\`: ${collapse(m.getText())} is not an error class; each member must be a class whose base chain reaches \`Error\` (R-f-1)`); continue; }
        for (const d of type.symbol.declarations ?? []) addFile(d);
        for (const d of chain) addFile(d);
        rejects.push(collapse(m.getText()));
      }
    }

    const display = plain => {
      const showRefs = plain ? new Set() : refs;
      const shownParams = params.map((p, i) => {
        const pn = ts.isIdentifier(p.name) ? p.name.text : `_${i}`;
        const rest = p.dotDotDotToken ? "..." : "";
        const isRef = showRefs.has(strip(p.type));
        const ref = isRef ? "ref " : "";
        const opt = !rest && (p.questionToken || p.initializer) ? "?" : "";
        const type = isRef ? show(strip(p.type).typeArguments[0], showRefs)
          : p.type ? show(p.type, showRefs) : printType(checker.getTypeAtLocation(p));
        return `${rest}${ref}${pn}${opt}: ${type}`;
      });
      let ret;
      if (sig.type) ret = show(sig.type, showRefs);
      else {
        const s = checker.getSignatureFromDeclaration(sig);
        ret = s ? printType(checker.getReturnTypeOfSignature(s)) : "";
      }
      const typeParams = sig.typeParameters?.length ? `<${sig.typeParameters.map(tp => show(tp, showRefs)).join(", ")}>` : "";
      return { typeParams, params: shownParams, ret };
    };
    const rows = { brands: [...brands.keys()].sort(), rejects: [...rejects].sort(), refParams, refParts };
    return { errored, rows, display, firstBrand: [...allowed].sort((x, y) => x.pos - y.pos)[0] ?? null };
  }

  function fnLine(name, display, rows) {
    const b = new Set(rows.brands);
    const anyRef = rows.refParams.length > 0 || rows.refParts.length > 0;
    const where = b.has("Server") ? "server " : b.has("Client") ? "client " : "";
    let line = `export ${where}${b.has("Pure") ? "pure " : ""}fn ${name}${display.typeParams}(${display.params.join(", ")})`;
    if (display.ret) line += `: ${display.ret}`;
    if (rows.rejects.length) line += ` rejects(${rows.rejects.join(" | ")})`;
    else if (b.has("Rejects")) line += " rejects(nothing)";   // `rejects([], fn)`: io, and its promise never rejects (R-f-8)
    if (b.has("Instantiates") && !anyRef) line += " instantiates";
    return line;
  }

  const DEFAULT = { brands: [], rejects: [], refParams: [], refParts: [] };
  // overloads: every signature carries the same rows, which are the rows; else the defaults
  function fromSignatures(name, sigs) {
    const read = sigs.map(s => readSignature(s, name));
    const first = read[0];
    if (read.some(r => r.errored)) return fnLine(name, first.display(true), DEFAULT);
    const key = r => JSON.stringify(r.rows);
    const bad = read.findIndex(r => key(r) !== key(first));
    if (bad > 0) {
      const at = read[bad].firstBrand ?? first.firstBrand ?? sigs[bad].name ?? sigs[bad];
      report(at, `the overloads of ${name} carry different brands: every overload signature must carry the same brands, with the same arguments and the same \`Ref\` positions`);
      return fnLine(name, first.display(true), DEFAULT);
    }
    return fnLine(name, first.display(false), first.rows);
  }

  // a callable known only to the checker (a const typed by a named function type, a default expression, …)
  function fromChecker(name, signature) {
    const params = signature.parameters.map((p, i) => {
      const d = p.valueDeclaration;
      const rest = d && ts.isParameter(d) && d.dotDotDotToken ? "..." : "";
      const opt = !rest && d && ts.isParameter(d) && (d.questionToken || d.initializer) ? "?" : "";
      const pn = d && ts.isParameter(d) && !ts.isIdentifier(d.name) ? `_${i}` : p.name.startsWith("__") ? `_${i}` : p.name;
      const type = printType(checker.getTypeOfSymbolAtLocation(p, sf));
      return `${rest}${pn}${opt}: ${opt ? type.replace(/ \| undefined$/, "") : type}`;
    });
    const typeParams = signature.typeParameters?.length ? `<${signature.typeParameters.map(t => t.symbol.name).join(", ")}>` : "";
    return fnLine(name, { typeParams, params, ret: printType(checker.getReturnTypeOfSignature(signature)) }, DEFAULT);
  }

  // a brand on an export that has no written call signature cannot be read
  function noBrands(node, name) {
    const visit = n => {
      if (ts.isTypeReferenceNode(n)) {
        const b = brandOf(n);
        if (b === "Ref") report(n, `\`Ref<T>\` is read only on a function's parameters and result: ${name} is not written as a function (\`(…) => Ref<T>\` or \`function ${name}(…)\`)`);
        else if (b) report(n, `\`${b}<…>\` marks a function's return type: ${name} is not written as a function; write \`function ${name}(…): ${HEAD[b]}\` or \`const ${name} = (…): ${HEAD[b]} => …\``);
      }
      ts.forEachChild(n, visit);
    };
    if (node) visit(node);
  }

  const typeParamNames = decls => {
    const d = decls.find(d => d.typeParameters?.length);
    return d ? `<${d.typeParameters.map(t => t.name.text).join(", ")}>` : "";
  };
  const unwrapExpr = e => { while (e && (ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression?.(e))) e = e.expression; return e; };
  const isFnExpr = e => e && (ts.isArrowFunction(e) || ts.isFunctionExpression(e));
  const callSigsOf = t => {
    t = strip(t);
    if (!t) return null;
    if (ts.isFunctionTypeNode(t)) return [t];
    if (ts.isTypeLiteralNode(t) && t.members.length && t.members.every(ts.isCallSignatureDeclaration)) return [...t.members];
    return null;
  };

  const typeOfSymbol = (sym, at) => (checker.getTypeOfSymbol ? checker.getTypeOfSymbol(sym) : checker.getTypeOfSymbolAtLocation(sym, at ?? sf));

  // ---- helpers (contract §0): `export const f = pure(rejects([E], fn))`, read from the call chain as written
  /** The helper a call calls (`pure`, `rx.pure`, `p` imported as `pure as p`), or null. */
  function helperOf(call) {
    if (!call || !ts.isCallExpression(call)) return null;
    let callee = call.expression;
    while (ts.isParenthesizedExpression(callee)) callee = callee.expression;
    const id = ts.isPropertyAccessExpression(callee) ? callee.name : ts.isIdentifier(callee) ? callee : null;
    if (!id) return null;
    let sym = checker.getSymbolAtLocation(id);
    if (!sym) return null;
    if (sym.flags & S.Alias) { try { sym = checker.getAliasedSymbol(sym); } catch { return null; } }
    if (!(sym.flags & S.Function)) return null;
    const decl = sym.declarations?.find(d => ts.isFunctionDeclaration(d) && d.name && HELPERS.has(d.name.text));
    return decl && inPackage(decl.getSourceFile().fileName) ? decl.name.text : null;
  }
  const helperArity = kind => (kind === "rejects" || kind === "ref" ? 2 : 1);
  const unwrapLiteral = e => {
    e = unwrapExpr(e);
    while (e && ts.isAsExpression(e) && ts.isTypeReferenceNode(e.type) && e.type.typeName.getText() === "const") e = unwrapExpr(e.expression);
    return e;
  };

  // the climb from a helper call to the node it is the whole of: through parentheses, `satisfies`, and outer
  // helpers whose function argument it is
  function chainTop(call) {
    const up = n => { let p = n.parent; while (p && (ts.isParenthesizedExpression(p) || ts.isSatisfiesExpression?.(p))) { n = p; p = n.parent; } return [n, p]; };
    let top = call, [n, p] = up(call);
    while (p && ts.isCallExpression(p) && p.arguments.at(-1) === n && helperOf(p) && p.arguments.length === helperArity(helperOf(p))) {
      top = p;
      [n, p] = up(p);
    }
    return { top, holder: p, whole: n };
  }
  // the module-level const a chain initializes, or why it is not one
  function placeOf(call) {
    const { top, holder, whole } = chainTop(call);
    const kind = helperOf(top);
    if (holder && ts.isExportAssignment(holder) && !holder.isExportEquals && holder.expression === whole) return { top, ok: true };
    if (holder && ts.isVariableDeclaration(holder) && holder.initializer === whole && ts.isIdentifier(holder.name)) {
      const list = holder.parent, stmt = list.parent, name = holder.name.text;
      if (!ts.isVariableStatement(stmt) || stmt.parent !== stmt.getSourceFile())
        return { top, why: `\`${kind}(…)\` marks an export: ${name} is not at module level; write \`export const ${name} = ${kind}(…)\` there` };
      if (!(list.flags & ts.NodeFlags.Const))
        return { top, why: `\`${kind}(…)\` marks a \`const\`: write \`export const ${name} = ${kind}(…)\` (a \`${list.flags & ts.NodeFlags.Let ? "let" : "var"}\` can be reassigned, so its facts cannot be read)` };
      if (!exportedLocals(stmt.getSourceFile()).has(checker.getSymbolAtLocation(holder.name)) && !stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword))
        return { top, why: `\`${kind}(…)\` marks an export, and ${name} is not exported: write \`export const ${name} = ${kind}(…)\`, or drop \`${kind}\`` };
      return { top, ok: true };
    }
    return { top, why: `\`${kind}(…)\` is read only as the whole initializer of an exported const (\`export const f = ${kind}(…)\`) or as \`export default ${kind}(…)\`; here it states nothing: move it there` };
  }
  const exportedByFile = new Map();
  function exportedLocals(file) {
    let set = exportedByFile.get(file);
    if (set) return set;
    exportedByFile.set(file, set = new Set());
    const m = checker.getSymbolAtLocation(file);
    for (const e of m ? checker.getExportsOfModule(m) : []) {
      set.add(e);
      if (e.flags & S.Alias) { try { set.add(checker.getAliasedSymbol(e)); } catch {} }
    }
    return set;
  }

  // every helper call in a file must be placed: report the ones that are not, once per chain
  const scanned = new Set();
  function scanHelpers(file) {
    const fileName = posix(file.fileName);
    if (scanned.has(fileName) || isLib(fileName) || inPackage(fileName) || fileName.includes("/node_modules/")) return;
    scanned.add(fileName);
    // names a helper can be called by here: its own, and the local names of imports from the package
    const names = new Set(HELPERS);
    for (const st of file.statements) {
      if (!ts.isImportDeclaration(st) || !st.importClause?.namedBindings || !ts.isNamedImports(st.importClause.namedBindings)) continue;
      for (const el of st.importClause.namedBindings.elements) if (el.propertyName && HELPERS.has(el.propertyName.text)) names.add(el.name.text);
    }
    if (![...names].some(n => file.text.includes(n))) return;
    const visit = n => {
      if (ts.isCallExpression(n)) {
        let c = n.expression;
        while (ts.isParenthesizedExpression(c)) c = c.expression;
        const text = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : null;
        if (text && names.has(text) && helperOf(n)) {
          const place = placeOf(n);
          if (!place.ok) report(place.top, place.why);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(file);
  }

  // an accessor: a type callable with no argument (Solid's `Accessor<T>`); its call signature, or null
  function accessorSig(type) {
    if (!type) return null;
    const t = type.flags & ts.TypeFlags.TypeParameter ? checker.getApparentType(type) : type;
    return t.getCallSignatures().find(s => s.parameters.every(p => {
      const d = p.valueDeclaration;
      return d && ts.isParameter(d) && (d.questionToken || d.initializer || d.dotDotDotToken);
    })) ?? null;
  }
  const accessorOf = type => { const sig = accessorSig(type); return sig ? printType(checker.getReturnTypeOfSignature(sig)) : null; };

  // the implementation's parameters and result, from its syntax when it is a function expression, else its type
  function implShape(impl) {
    if (isFnExpr(impl)) {
      const sig = checker.getSignatureFromDeclaration(impl);
      const params = impl.parameters.filter(p => !(ts.isIdentifier(p.name) && p.name.text === "this")).map((p, i) => ({
        name: ts.isIdentifier(p.name) ? p.name.text : `_${i}`, node: p, named: ts.isIdentifier(p.name),
        rest: !!p.dotDotDotToken, opt: !p.dotDotDotToken && !!(p.questionToken || p.initializer),
        type: checker.getTypeAtLocation(p), text: p.type ? show(p.type, new Set()) : null,
      }));
      const ret = sig ? checker.getReturnTypeOfSignature(sig) : null;
      const typeParams = impl.typeParameters?.length ? `<${impl.typeParameters.map(tp => show(tp, new Set())).join(", ")}>` : "";
      return { params, ret, retText: impl.type ? show(impl.type, new Set()) : null, typeParams };
    }
    const sig = checker.getTypeAtLocation(impl).getCallSignatures()[0];
    if (!sig) return null;
    const params = sig.parameters.map((p, i) => {
      const d = p.valueDeclaration, isParam = d && ts.isParameter(d);
      const rest = !!(isParam && d.dotDotDotToken), opt = !rest && !!(isParam && (d.questionToken || d.initializer));
      const named = !(isParam && !ts.isIdentifier(d.name)) && !p.name.startsWith("__");
      return { name: named ? p.name : `_${i}`, node: d, named, rest, opt, type: checker.getTypeOfSymbolAtLocation(p, impl), text: null };
    });
    const typeParams = sig.typeParameters?.length ? `<${sig.typeParameters.map(t => t.symbol.name).join(", ")}>` : "";
    return { params, ret: checker.getReturnTypeOfSignature(sig), retText: null, typeParams };
  }

  function readRejects(arg, fail, out) {
    const list = unwrapLiteral(arg);
    if (!list || !ts.isArrayLiteralExpression(list)) return fail(arg, "`rejects` takes an array literal of error classes, as written: `rejects([NotFound, Offline], fn)`");
    for (const el of list.elements) {
      const text = collapse(el.getText());
      const id = ts.isIdentifier(el) ? el : ts.isPropertyAccessExpression(el) ? el.name : null;
      let sym = id && checker.getSymbolAtLocation(id);
      if (sym && sym.flags & S.Alias) { try { sym = checker.getAliasedSymbol(sym); } catch { sym = null; } }
      const chain = sym ? errorClass(sym) : null;
      if (!chain) { fail(el, `\`rejects([…])\`: ${text} is not an error class; list the classes themselves, each a class whose base chain reaches \`Error\` (R-f-1)`); continue; }
      for (const d of sym.declarations ?? []) addFile(d);
      for (const d of chain) addFile(d);
      if (!out.includes(text)) out.push(text);
    }
  }

  function readRefSpec(arg, fail) {
    const spec = unwrapLiteral(arg);
    const form = "`ref({ args: [0], result: true }, fn)`";
    if (!spec || !ts.isObjectLiteralExpression(spec)) { fail(arg, `\`ref\` takes its spec as an object literal, as written: ${form}`); return null; }
    const out = { args: null, result: null };
    for (const prop of spec.properties) {
      const key = ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) ? prop.name.text : null;
      if (key !== "args" && key !== "result") { fail(prop, `\`ref\`'s spec has \`args\` (parameter indices) and \`result\` (\`true\`, tuple indices or object keys), written as literals: ${form}`); continue; }
      if (out[key]) { fail(prop, `\`${key}\` is written twice in \`ref\`'s spec: write it once`); continue; }
      const v = unwrapLiteral(prop.initializer);
      if (key === "result" && v.kind === ts.SyntaxKind.TrueKeyword) { out.result = { whole: v }; continue; }
      const els = ts.isArrayLiteralExpression(v) ? v.elements : null;
      const nums = els && els.length && els.every(ts.isNumericLiteral);
      const strs = key === "result" && els && els.length && els.every(e => ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e));
      if (!nums && !strs) {
        fail(prop.initializer, key === "args"
          ? "`args` lists parameter indices as a literal: `args: [0]`"
          : "`result` is `true`, or a literal list of tuple indices (`result: [0]`) or of object keys (`result: [\"value\"]`)");
        continue;
      }
      out[key] = { parts: els.map(e => ({ node: e, key: nums ? Number(e.text) : e.text })) };
    }
    if (!out.args && !out.result && !spec.properties.length) { fail(spec, "`ref({}, …)` marks nothing: name `args` or `result`, or drop `ref`"); return null; }
    return out;
  }

  /**
   * The line for an export whose value is a helper chain; null when the innermost argument is not a function
   * (the caller then prints the default). `placed`: the chain is where it is read (else its facts are not).
   */
  function helperLine(name, outer, placed) {
    const saved = enclosing;
    enclosing = outer.getSourceFile();
    try { return readHelpers(name, outer, placed); } finally { enclosing = saved; }
  }
  function readHelpers(name, outer, placed) {
    const kinds = new Map(), rejects = [];
    let errored = !placed, spec = null, specNode = null, cur = outer;
    const fail = (node, message) => { report(node, message); errored = true; };
    for (;;) {
      const kind = helperOf(cur);
      if (!kind) break;
      const n = helperArity(kind);
      if (cur.arguments.length !== n || cur.arguments.some(ts.isSpreadElement)) {
        fail(cur, `\`${kind}\` takes ${n === 2 ? "its literal and then the function" : "the function"} as written: \`export const ${name} = ${FORM[kind]}\``);
        return null;
      }
      if (kinds.has(kind)) fail(cur, `\`${kind}(…)\` wraps ${name} twice: write it once`);
      else {
        kinds.set(kind, cur);
        if (kind === "rejects") readRejects(cur.arguments[0], fail, rejects);
        if (kind === "ref") { specNode = cur.arguments[0]; spec = readRefSpec(specNode, fail); }
      }
      cur = unwrapExpr(cur.arguments[n - 1]);
    }
    if (kinds.has("server") && kinds.has("client")) {
      const later = [kinds.get("server"), kinds.get("client")].sort((x, y) => y.pos - x.pos)[0];
      fail(later, `\`server(…)\` and \`client(…)\` both wrap ${name}: a fn runs on the server or on the client, not both (12 SF-5); keep one`);
    }
    const implicit = kinds.has("ref") ? "ref" : kinds.has("instantiates") ? "instantiates" : null;
    if (implicit && kinds.has("pure")) {
      fail(kinds.get("pure"), `\`${implicit}(…)\` already makes ${name} pure: remove the \`pure(…)\` wrapper`);
    }
    if (kinds.has("ref") && kinds.has("instantiates")) {
      fail(kinds.get("instantiates"), `\`ref(…)\` already makes ${name} instantiating: remove the \`instantiates(…)\` wrapper`);
    }
    const impl = cur;
    const shape = impl && implShape(impl);
    if (!shape) {
      report(impl ?? outer, `the innermost argument of \`${helperOf(outer)}(…)\` is the implementation, a function: \`export const ${name} = ${FORM[helperOf(outer)]}\``);
      return null;
    }
    if (isFnExpr(impl)) {
      const branded = readSignature(impl, name);
      if (branded.firstBrand) fail(branded.firstBrand, `${name} is wrapped in helpers: state its facts with the helpers only (\`pure(…)\`, \`rejects([…], …)\`, \`ref({…}, …)\`), not with brand types`);
    }

    // `ref` positions, checked against the implementation
    const refParams = [], refParts = [];
    if (spec?.args) for (const { node, key: i } of spec.args.parts) {
      const p = Number.isInteger(i) ? shape.params[i] : undefined;
      if (!p) { fail(node, `\`ref({ args: [${node.getText()}] })\`: ${name} has no parameter ${node.getText()} (it takes ${shape.params.length})`); continue; }
      if (p.rest) { fail(node, `\`ref({ args: [${i}] })\`: ...${p.name} is a rest parameter; a ref argument is one accessor, its own parameter`); continue; }
      if (p.opt) { fail(node, `\`ref({ args: [${i}] })\`: ${p.name} is optional; a ref argument is always passed: make it required`); continue; }
      if (!p.named) { fail(node, `\`ref({ args: [${i}] })\`: parameter ${i} is destructured; name it and destructure inside`); continue; }
      if (!accessorSig(p.type)) { fail(node, `\`ref({ args: [${i}] })\`: ${p.name} is not an accessor (\`() => T\`); its type is ${printType(p.type)}`); continue; }
      if (!refParams.includes(i)) refParams.push(i);
    }
    let retShown = null;
    const ret = shape.ret;
    if (spec?.result && ret) {
      if (spec.result.whole) {
        const x = accessorOf(ret);
        if (x === null) fail(spec.result.whole, `\`ref({ result: true })\`: ${name}'s result is not an accessor (\`() => T\`); it is ${printType(ret)}`);
        else { refParts.push("result"); retShown = `ref ${/[|&]|=>/.test(x) ? `(${x})` : x}`; }
      } else if (checker.isTupleType(ret)) {
        const target = ret.target, elems = checker.getTypeArguments(ret);
        const marked = new Set();
        for (const { node, key } of spec.result.parts) {
          if (typeof key !== "number") { fail(node, `\`ref({ result: [${node.getText()}] })\`: ${name} returns a tuple; name its accessor elements by index`); continue; }
          const ok = Number.isInteger(key) && key < target.fixedLength && target.elementFlags[key] & ts.ElementFlags.Required;
          if (!ok) { fail(node, `\`ref({ result: [${key}] })\`: ${name}'s result has no required element ${key}`); continue; }
          if (accessorOf(elems[key]) === null) { fail(node, `\`ref({ result: [${key}] })\`: element ${key} of ${name}'s result is not an accessor (\`() => T\`); it is ${printType(elems[key])}`); continue; }
          marked.add(key);
        }
        refParts.push(...[...marked].sort((a, b) => a - b));
        if (marked.size) retShown = `${target.readonly ? "readonly " : ""}[${elems.map((t, i) => {
          const f = target.elementFlags[i];
          if (marked.has(i)) return `ref ${accessorOf(t)}`;
          if (f & ts.ElementFlags.Variable) return `...${printType(t)}[]`;
          return `${printType(t)}${f & ts.ElementFlags.Optional ? "?" : ""}`;
        }).join(", ")}]`;
      } else {
        const marked = new Set();
        for (const { node, key } of spec.result.parts) {
          if (typeof key !== "string") { fail(node, `\`ref({ result: [${key}] })\`: ${name} does not return a tuple; name its accessor properties by key (\`["value"]\`)`); continue; }
          const prop = ret.getCallSignatures().length ? null : checker.getPropertyOfType(ret, key);
          if (!prop) { fail(node, `\`ref({ result: ["${key}"] })\`: ${name}'s result has no property ${key}`); continue; }
          if (prop.flags & S.Optional) { fail(node, `\`ref({ result: ["${key}"] })\`: ${key} is optional in ${name}'s result; a ref part is always there`); continue; }
          if (accessorOf(checker.getTypeOfSymbolAtLocation(prop, impl)) === null) { fail(node, `\`ref({ result: ["${key}"] })\`: ${key} in ${name}'s result is not an accessor (\`() => T\`)`); continue; }
          marked.add(key);
        }
        refParts.push(...[...marked]);
        if (marked.size) retShown = `{ ${checker.getPropertiesOfType(ret).map(p => {
          const t = checker.getTypeOfSymbolAtLocation(p, impl);
          const opt = p.flags & S.Optional ? "?" : "";
          return `${p.name}${opt}: ${marked.has(p.name) ? `ref ${accessorOf(t)}` : printType(opt ? checker.getNonNullableType(t) : t)}`;
        }).join("; ")} }`;
      }
    }

    const rows = errored ? DEFAULT : {
      brands: [...kinds.keys(), ...(implicit ? ["pure"] : [])].filter(k => FACT[k]).map(k => FACT[k]).sort(), rejects: [...rejects].sort(), refParams, refParts,
    };
    const refShown = new Set(errored ? [] : refParams);
    const params = shape.params.map((p, i) => {
      const rest = p.rest ? "..." : "", opt = p.opt ? "?" : "";
      if (refShown.has(i)) return `ref ${p.name}: ${accessorOf(p.type)}`;
      let type = p.text ?? printType(p.type);
      if (opt && !p.text) type = type.replace(/ \| undefined$/, "");
      return `${rest}${p.name}${opt}: ${type}`;
    });
    const retText = (!errored && retShown) || shape.retText || (ret ? printType(ret) : "");
    return fnLine(name, { typeParams: shape.typeParams, params, ret: retText }, rows);
  }

  function lineFor(name, target, typeOnly, exprDecl) {
    if (exprDecl) {
      scanHelpers(exprDecl.getSourceFile());
      const e = unwrapExpr(exprDecl.expression);
      if (helperOf(e)) { const l = helperLine(name, e, true); if (l) return l; }
      if (isFnExpr(e)) return fromSignatures(name, [e]);
      const type = typeOfSymbol(target, exprDecl);
      const call = type.getCallSignatures();
      if (call.length) return fromChecker(name, call[0]);
      return `export const ${name}: ${printType(type)}`;
    }
    if (!target || !target.flags || !(target.flags & (S.Value | S.Type))) return `export const ${name}: any`;
    const decls = target.declarations ?? [];
    for (const d of decls) addFile(d);
    if (typeOnly || !(target.flags & S.Value)) return `export type ${name}${typeParamNames(decls)}`;
    if (target.flags & S.Function) {
      const fns = decls.filter(d => ts.isFunctionDeclaration(d));
      if (fns.length) {
        const sigs = fns.length > 1 ? (fns.filter(d => !d.body).length ? fns.filter(d => !d.body) : fns) : fns;
        return fromSignatures(name, sigs);
      }
    }
    if (target.flags & S.Class) {
      const chain = errorClass(target);
      if (chain) { for (const d of chain) addFile(d); return `export error ${name}`; }
      return `export const ${name}: ${printType(typeOfSymbol(target))}`;
    }
    if (target.flags & S.Variable) {
      const d = decls.find(ts.isVariableDeclaration) ?? target.valueDeclaration;
      if (d && ts.isVariableDeclaration(d)) {
        const init = unwrapExpr(d.initializer);
        if (helperOf(init)) {
          scanHelpers(d.getSourceFile());
          const l = helperLine(name, init, placeOf(init).ok === true);
          if (l) return l;
        }
        const sigs = d.type ? callSigsOf(d.type) : isFnExpr(unwrapExpr(d.initializer)) ? [unwrapExpr(d.initializer)] : null;
        if (sigs) return fromSignatures(name, sigs);
        noBrands(d.type, name);
        const type = checker.getTypeOfSymbolAtLocation(target, d);
        const call = type.getCallSignatures();
        if (call.length) return fromChecker(name, call[0]);
        return `export const ${name}: ${d.type ? show(d.type, new Set()) : printType(type)}`;
      }
    }
    const type = checker.getTypeOfSymbolAtLocation(target, target.valueDeclaration ?? sf);
    const call = !(target.flags & (S.Enum | S.ValueModule)) ? type.getCallSignatures() : [];
    if (call.length) return fromChecker(name, call[0]);
    return `export const ${name}: ${printType(type)}`;
  }

  const isTypeOnly = d => (
    (ts.isExportSpecifier(d) && (d.isTypeOnly || d.parent.parent.isTypeOnly)) ||
    (ts.isImportSpecifier(d) && (d.isTypeOnly || d.parent.parent.isTypeOnly)) ||
    (ts.isImportClause(d) && d.isTypeOnly) ||
    (ts.isNamespaceImport(d) && d.parent.isTypeOnly) ||
    (ts.isNamespaceExport?.(d) && d.parent.isTypeOnly) ||
    (ts.isImportEqualsDeclaration(d) && d.isTypeOnly)
  );

  // `export *` statements, transitively: their position in T and the files they pass through
  const stars = sf.statements.filter(s => ts.isExportDeclaration(s) && !s.exportClause && s.moduleSpecifier);
  const starFiles = (file, seen = new Set()) => {
    if (!file || seen.has(file)) return;
    seen.add(file);
    addFile(file);
    for (const s of file.statements) {
      if (!ts.isExportDeclaration(s) || !s.moduleSpecifier) continue;
      const m = checker.getSymbolAtLocation(s.moduleSpecifier);
      const target = m?.valueDeclaration?.getSourceFile?.() ?? m?.declarations?.[0]?.getSourceFile?.();
      if (target && !s.exportClause) starFiles(target, seen);
    }
  };
  for (const s of stars) {
    const m = checker.getSymbolAtLocation(s.moduleSpecifier);
    const f = m?.declarations?.[0]?.getSourceFile?.();
    if (f) starFiles(f, new Set([sf]));
  }
  const starPos = name => {
    for (const s of stars) {
      const m = checker.getSymbolAtLocation(s.moduleSpecifier);
      if (m && checker.getExportsOfModule(m).some(e => e.name === name)) return s.getStart(sf);
    }
    return sf.end;
  };

  scanHelpers(sf);
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  const exports = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [];
  exports.forEach((exp, order) => {
    const name = exp.name;
    const own = (exp.declarations ?? []).filter(d => d.getSourceFile() === sf);
    const pos = own.length ? Math.min(...own.map(d => d.getStart(sf))) : starPos(name);
    let typeOnly = false, s = exp, exprDecl = null;
    const assign = (exp.declarations ?? []).find(ts.isExportAssignment);
    if (assign && !ts.isIdentifier(assign.expression) && !ts.isPropertyAccessExpression(assign.expression)) exprDecl = assign;
    else {
      const seen = new Set();
      while (s && s.flags & S.Alias && !seen.has(s)) {
        seen.add(s);
        for (const d of s.declarations ?? []) { if (isTypeOnly(d)) typeOnly = true; addFile(d); }
        const next = checker.getImmediateAliasedSymbol(s);
        if (!next) { s = checker.getAliasedSymbol(s); break; }
        s = next;
      }
    }
    const original = own.length ? 0 : Math.min(...(s?.declarations ?? []).map(d => d.getStart()), Infinity);
    lines.push([pos, original, order, lineFor(name, s, typeOnly, exprDecl)]);
  });
  return done();
}
