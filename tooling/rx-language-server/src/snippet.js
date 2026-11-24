// Eval snippets: a `.rx` file whose first line is exactly `// @eval` is the code string of a `createEval`, a component
// body (declarations, then markup) whose free names are its bindings, declared one a line right after it:
//
//   // @eval
//   // @bind read count: number              a value
//   // @bind store db: { list: { id: number }[] }   a structured value, read by path
//   // @bind action claim(number)            an action it may call
//   // @bind host save(number): string       a host function, awaited in an action
//   // @bind pure host load(): string[]      a pure host function
//
// Types: number, string, boolean, T[], { k: T, … }. The analysis is of a synthetic module made in place: line 1 imports
// the hosts and opens `export default component Eval() {`, each `@bind` line becomes its declaration (a read or store
// a source, an action an empty action, a host line blank: it is imported on line 1), the body follows unchanged and a
// last line closes the component. So the body's lines and columns are the file's own, and a binding's name in its
// declaration maps onto its name in the `@bind` line (hover there, definition goes there). Hosts are a `.d.rx` beside
// the file, given to the crate as an overlay, and inline `declare function`s in the TSX projection.
//
// Bindings are read-only: a write or guess to a read or store binding is READ_ONLY on that write.

const HOSTS = "__rx_eval_hosts";
const SCALAR = new Set(["number", "string", "boolean"]);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

const isSnippet = text => /^\/\/ @eval(\r?\n|$)/.test(text);

class BindError extends Error {}

/** A type of the binding grammar, as `{ k: "number"|"string"|"boolean" } | { k: "array", item } | { k: "record", fields }`. */
function parseType(text) {
  let i = 0;
  const s = text.trim();
  const ws = () => { while (/\s/.test(s[i] ?? "")) i++; };
  const one = () => {
    ws();
    let t;
    if (s[i] === "{") {
      i++;
      const fields = [];
      ws();
      while (s[i] !== "}") {
        const k = /^[A-Za-z_$][\w$]*/.exec(s.slice(i));
        if (!k) throw new BindError(`a field name expected in ${JSON.stringify(text)}`);
        i += k[0].length; ws();
        if (s[i++] !== ":") throw new BindError(`\`:\` expected after ${k[0]} in ${JSON.stringify(text)}`);
        if (fields.some(([n]) => n === k[0])) throw new BindError(`field ${k[0]} twice`);
        fields.push([k[0], one()]);
        ws();
        if (s[i] === "," || s[i] === ";") { i++; ws(); }
        else if (s[i] !== "}") throw new BindError(`\`,\` or \`}\` expected in ${JSON.stringify(text)}`);
      }
      i++;
      t = { k: "record", fields };
    } else if (s[i] === "(") {
      i++; t = one(); ws();
      if (s[i++] !== ")") throw new BindError(`\`)\` expected in ${JSON.stringify(text)}`);
    } else {
      const w = /^(number|string|boolean)\b/.exec(s.slice(i));
      if (!w) throw new BindError(`number, string, boolean, T[] or { … } expected in ${JSON.stringify(text)}`);
      i += w[0].length;
      t = { k: w[0] };
    }
    ws();
    while (s.slice(i, i + 2) === "[]") { i += 2; t = { k: "array", item: t }; ws(); }
    return t;
  };
  const t = one();
  ws();
  if (i !== s.length) throw new BindError(`unexpected ${JSON.stringify(s.slice(i))} in ${JSON.stringify(text)}`);
  return t;
}

const printType = t => t.k === "array" ? printType(t.item) + "[]" : t.k === "record" ? `{ ${t.fields.map(([k, v]) => `${k}: ${printType(v)}`).join(", ")} }` : t.k;
const placeholder = t => t.k === "number" ? "0" : t.k === "string" ? '""' : t.k === "boolean" ? "false" : t.k === "array" ? "[]"
  : `{ ${t.fields.map(([k, v]) => `${k}: ${placeholder(v)}`).join(", ")} }`;

/** One `@bind` declaration (the fork's eval interface grammar). `at` is the name's offset in `decl`. */
function parseBind(decl) {
  const m = /^(read|store|action|host|pure\s+host)\s+([A-Za-z_$][\w$]*)\s*(.*)$/.exec(decl);
  if (!m) throw new BindError("expected `read|store|action|host|pure host name …`");
  const pure = m[1].startsWith("pure");
  const kind = pure ? "host" : m[1], name = m[2], rest = m[3].trim();
  const at = m[0].indexOf(name, m[1].length);
  if (!IDENT.test(name)) throw new BindError(`binding names are identifiers without \`$\`: ${name}`);
  if (kind === "read" || kind === "store") {
    const t = /^:\s*(.+)$/.exec(rest);
    if (!t) throw new BindError(`${kind} ${name} needs \`: type\``);
    const type = parseType(t[1]);
    if (kind === "store" && type.k !== "record" && type.k !== "array") throw new BindError(`store ${name} is a record or an array`);
    return { name, kind, type, at };
  }
  const p = /^\(([^)]*)\)\s*(?::\s*(.+))?$/.exec(rest);
  if (!p) throw new BindError(`${kind} ${name} needs \`(types)\`${kind === "host" ? " and `: type`" : ""}`);
  const params = p[1].trim() ? p[1].split(",").map(x => {
    const t = x.includes(":") ? x.slice(x.indexOf(":") + 1).trim() : x.trim();
    if (!SCALAR.has(t)) throw new BindError(`${name}'s parameters are number, string or boolean, not ${t || "nothing"}`);
    return t;
  }) : [];
  if (kind === "action") {
    if (p[2]) throw new BindError(`an action returns nothing a caller sees: ${name}`);
    return { name, kind, params, at };
  }
  if (!p[2]) throw new BindError(`host ${name} needs \`: type\``);
  return { name, kind, params, returns: printType(parseType(p[2])), pure, at };
}

const sig = d => d.params.map((t, i) => `a${i}: ${t}`).join(", ");

/** The synthetic module for a snippet, and what maps it back. */
function wrap(text) {
  const lines = text.split("\n");
  const starts = [0];
  for (const l of lines) starts.push(starts[starts.length - 1] + l.length + 1);
  let h = 1;
  while (h < lines.length && /^\s*\/\/\s*@bind\b/.test(lines[h])) h++;
  const binds = [], errors = [];
  for (let i = 1; i < h; i++) {
    const line = lines[i].replace(/\r$/, "");
    const m = /^(\s*\/\/\s*@bind\s*)(.*?)\s*$/.exec(line);
    const lead = m[1].length;
    try {
      const d = parseBind(m[2]);
      if (binds.some(b => b.name === d.name)) throw new BindError(`${d.name} is bound twice`);
      binds.push({ ...d, line: i, nameAt: starts[i] + lead + d.at });
    } catch (e) {
      if (!(e instanceof BindError)) throw e;
      errors.push({ line: i, message: `@bind: ${e.message}` });
    }
  }
  // a `@bind` line after the body has started is a comment the analysis would not see
  for (let i = h; i < lines.length; i++)
    if (/^\s*\/\/\s*@bind\b/.test(lines[i])) errors.push({ line: i, message: "@bind: a binding is declared in the header, right after `// @eval` (this line is a comment)" });

  const hosts = binds.filter(b => b.kind === "host");
  const segments = []; // [wrapped start, length, original start]
  let out = "";
  if (hosts.length) {
    out += "import { ";
    hosts.forEach((b, i) => { if (i) out += ", "; segments.push([out.length, b.name.length, b.nameAt]); out += b.name; });
    out += ` } from "./${HOSTS}"; `;
  }
  out += "export default component Eval() {\n";
  for (let i = 1; i < h; i++) {
    const b = binds.find(b => b.line === i);
    if (b && (b.kind === "read" || b.kind === "store")) {
      out += "source ";
      segments.push([out.length, b.name.length, b.nameAt]);
      out += `${b.name}: ${printType(b.type)} := ${placeholder(b.type)}`;
    } else if (b && b.kind === "action") {
      out += "action ";
      segments.push([out.length, b.name.length, b.nameAt]);
      out += `${b.name}(${sig(b)}) {}`;
    }
    out += "\n";
  }
  const body = h < lines.length ? starts[h] : text.length;
  segments.push([out.length, text.length - body, body]);
  out += text.slice(body);
  out += (text.endsWith("\n") ? "" : "\n") + "}\n";
  const declarations = hosts.length ? hosts.map(b => `export ${b.pure ? "pure " : ""}fn ${b.name}(${sig(b)}): ${b.returns}`).join("\n") + "\n" : undefined;
  const ts = hosts.map(b => ({ name: b.name, nameAt: b.nameAt, text: `declare function ${b.name}(${sig(b)}): Promise<${b.returns}>;` }));
  return { text: out, hosts: HOSTS, declarations, ts, binds, errors, segments, header: h, lines, starts };
}

/** An original offset for a wrapped range [s, s+n), when it lies in one segment. */
function back(w, s, n) {
  for (const [ws, len, os] of w.segments) if (s >= ws && s + n <= ws + len) return os + (s - ws);
  return undefined;
}

/** 1-based line, 0-based column (UTF-16) of an original offset. */
function lineCol(w, o) {
  let i = 0;
  while (i + 1 < w.starts.length && w.starts[i + 1] <= o) i++;
  return { line: i + 1, column: o - w.starts[i] };
}

/** The crate's diagnostic range of a whole original line (0-based `i`), trimmed. */
function lineRange(w, i) {
  const l = (w.lines[i] ?? "").replace(/\r$/, "");
  const lead = l.length - l.trimStart().length;
  return { start: { line: i + 1, column: lead }, end: { line: i + 1, column: l.trimEnd().length } };
}

const diag = (w, file, i, code, message) => ({ file, line: i + 1, code, rule: "eval", message, range: lineRange(w, i) });

/** The crate's answer for the wrapped module, onto the snippet: mappings into the synthetic parts dropped, the hosts'
 *  import replaced by declarations, diagnostics in the preamble on their `@bind` line (else line 1), and READ_ONLY. */
function unwrap(w, file, r) {
  let code = r.code ?? null;
  let mappings = r.mappings ?? [], ranges = r.ranges ?? [];
  const hostNames = [];
  const m = code != null && w.ts.length ? new RegExp(`import \\{[^}]*\\} from "\\./${w.hosts}";`).exec(code) : null;
  if (m) {
    // TypeScript has no module for the hosts: they are declared where the import was
    let rep = "";
    for (const d of w.ts) {
      if (rep) rep += " ";
      hostNames.push([m.index + rep.length + "declare function ".length, d.nameAt, d.name.length]);
      rep += d.text;
    }
    const a = m.index, b = m.index + m[0].length, delta = rep.length - m[0].length;
    code = code.slice(0, a) + rep + code.slice(b);
    const shift = g => (g >= b ? g + delta : g);
    mappings = mappings.filter(([g]) => g < a || g >= b).map(([g, s, n]) => [shift(g), s, n]);
    ranges = ranges.filter(([g, gn]) => g + gn <= a || g >= b).map(([g, gn, s, n]) => [shift(g), gn, s, n]);
  }
  mappings = [...mappings.flatMap(([g, s, n]) => { const o = back(w, s, n); return o === undefined ? [] : [[g, o, n]]; }), ...hostNames];
  ranges = ranges.flatMap(([g, gn, s, n]) => { const o = back(w, s, n); return o === undefined ? [] : [[g, gn, o, n]]; });

  // READ_ONLY: the projection writes a source as `__.set(target)`, the target's name mapped onto the write
  const text = w.lines.join("\n");
  const body = w.starts[w.header] ?? text.length;
  const readOnly = new Set(w.binds.filter(b => b.kind === "read" || b.kind === "store").map(b => b.name));
  const written = [];
  if (code != null) for (const [g, s, n] of mappings) {
    if (s < body || code.slice(g - 7, g) !== "__.set(") continue;
    const name = text.slice(s, s + n);
    if (!readOnly.has(name)) continue;
    const guess = /\bguess\s+$/.exec(text.slice(Math.max(0, s - 40), s));
    const start = guess ? s - guess[0].length : s;
    const eol = text.indexOf("\n", s), op = text.indexOf(":=", s);
    const end = op >= 0 && (eol < 0 || op < eol) ? op + 2 : s + n;
    const at = lineCol(w, start);
    written.push({ file, line: at.line, code: "READ_ONLY", rule: "eval", message: `writing the read-only binding ${name}: evaluated code writes only through an action it is passed`, range: { start: at, end: lineCol(w, end) } });
  }

  // the crate's diagnostics: the body's lines and columns are the file's; the preamble's are its @bind lines
  const last = w.lines.length - 1;
  const named = message => w.binds.find(b => new RegExp(`(^|[^\\w$])${b.name}([^\\w$]|$)`).test(message));
  const diagnostics = (r.diagnostics ?? []).map(d => {
    const L = d.range?.start.line ?? 1;
    if ((d.file && d.file !== file) || !d.range) {
      const b = named(d.message);
      return { ...d, file, line: (b ? b.line : 0) + 1, range: lineRange(w, b ? b.line : 0) };
    }
    if (L <= w.header) {
      const b = L === 1 ? named(d.message) : w.binds.find(b => b.line === L - 1);
      const i = b ? b.line : L - 1;
      return { ...d, line: i + 1, range: lineRange(w, i) };
    }
    const endCol = (w.lines[last] ?? "").replace(/\r$/, "").length;
    const eof = { line: last + 1, column: endCol };
    if (L - 1 > last) return { ...d, line: last + 1, range: { start: eof, end: eof } };
    // the closing line is the file's last: a position past its end is the end of the file
    const clamp = p => (p.line - 1 > last ? eof : p.line - 1 === last ? { line: p.line, column: Math.min(p.column, endCol) } : p);
    return { ...d, range: { start: clamp(d.range.start), end: clamp(d.range.end) } };
  });
  const errors = w.errors.map(e => diag(w, file, e.line, "INTERFACE", e.message));
  return { ...r, code, mappings, ranges, diagnostics: [...errors, ...written, ...diagnostics] };
}

/** The diagnostic codes a snippet adds to the crate's. */
const CODES = new Set(["INTERFACE", "READ_ONLY"]);

module.exports = { isSnippet, wrap, unwrap, parseBind, HOSTS, CODES };
