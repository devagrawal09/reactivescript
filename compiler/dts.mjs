// rx-dts: the declaration of a module TypeScript can read, generated from it (spec/09 MO-11). It reads the
// syntax and symbols of the `.ts` (not its type errors) and prints ordinary `.d.rx` rows: brands from
// `@reactivescript/types` where they are written, the sound default everywhere else (contract §1–3, §7).
// The types of a generated line are TypeScript's (13 TY-4b): the text shows them for a person only.
import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export const CANDIDATES = [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".d.mts", "/index.ts", "/index.tsx", "/index.d.ts"];
export const TS_EXTENSIONS = [".d.ts", ".d.mts", ".d.cts", ".ts", ".tsx", ".mts", ".cts"];
const WRAPPERS = ["Pure", "Rejects", "Instantiates", "Server", "Client"];
const BRANDS = new Set([...WRAPPERS, "Ref"]);
const TYPES_PACKAGE = "@reactivescript/types";
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

  // ---- is a declaration in @reactivescript/types (nearest package.json, cached per directory)
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
  const inTypesPackage = f => posix(f).includes(`/node_modules/${TYPES_PACKAGE}/`) || packageName(path.posix.dirname(posix(f))) === TYPES_PACKAGE;

  // ---- records, memoized by the stamps of the files they depend on
  const memo = new Map();
  function generateFile(T) {
    const hit = memo.get(T);
    if (hit && hit.stamps.every(([f, s]) => stamp(f) === s)) return hit.record;
    const ts = tsFor(T);
    const svc = serviceFor(ts, T);
    svc.roots.add(T);
    const program = svc.ls.getProgram();
    const record = generate(ts, program, T, { inTypesPackage, isLib });
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

function generate(ts, program, T, { inTypesPackage, isLib }) {
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
  const report = (node, message, code = "DECLARATION_BRAND") => {
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
  const printType = type => {
    const s = checker.typeToString(type, sf, ts.TypeFormatFlags.NoTruncation);
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
    return inTypesPackage(decl.getSourceFile().fileName) ? decl.name.text : null;
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
        if (m.kind === ts.SyntaxKind.NeverKeyword) { fail(m, `\`Rejects<…, never>\` names no rejection: drop \`Rejects\` (a generated fn rejects \`Error\`) or name the error classes`); continue; }
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
  function lineFor(name, target, typeOnly, exprDecl) {
    if (exprDecl) {
      const e = unwrapExpr(exprDecl.expression);
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
