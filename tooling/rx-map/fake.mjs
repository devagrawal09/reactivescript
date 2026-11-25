// Fake host for the trace protocol (TRACE-CONTRACT §4). Deterministic from `seed`. Speaks the same messages the
// real `./live` bridge will, so the map, the conformance suite and a recording can all sit on one contract.
// Pure ESM, no dependencies, Node and the browser. The CLI at the bottom is Node-only and loaded on demand.
import { declText, keyParts, parseDecl, planHmr } from "./hmr.mjs";

const SOURCE = "rx-map";
const V = 1;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hash(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A short string of a value, at most 80 characters. Same shape as `@reactivescript/map/live`'s preview. */
export function preview(v) {
  let s;
  try { s = show(v, 2); } catch { s = "?"; }
  return s.length > 80 ? s.slice(0, 79) + "…" : s;
}
function show(v, depth) {
  switch (typeof v) {
    case "string": return JSON.stringify(v.length > 60 ? v.slice(0, 60) + "…" : v);
    case "undefined": return "undefined";
    case "function": return `ƒ ${v.name || "anonymous"}`;
    case "bigint": return `${v}n`;
    case "symbol": return v.toString();
    case "object": break;
    default: return String(v);
  }
  if (v === null) return "null";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "Invalid Date" : v.toISOString();
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v.then === "function") return "Promise";
  const arr = Array.isArray(v);
  if (depth <= 0) return arr ? `Array(${v.length})` : "{…}";
  let out = arr ? "[" : "{", n = 0;
  const keys = arr ? null : Object.keys(v);
  const len = arr ? v.length : keys.length;
  for (; n < len && out.length < 80; n++) out += (n ? ", " : "") + (arr ? "" : `${keys[n]}: `) + show(arr ? v[n] : v[keys[n]], depth - 1);
  if (n < len) out += `, …${len - n}`;
  return out + (arr ? "]" : "}");
}

// ---- a small expression evaluator -------------------------------------------------------------------------------
// Enough of RX's expression language that writes and equations in the examples come out as real values: literals,
// arithmetic, comparisons, ternary, templates, calls like `len`, member access, arrows, map/filter/reduce, `pending?`
// and `latest`. Anything else fails and the host invents a typed preview instead.

class Flight extends Error {}
class Fail extends Error {}

function evaluate(expr, ctx) {
  try {
    const src = String(expr ?? "").replace(/\/\/.*$/gm, "").trim();
    if (!src) throw new Fail();
    const p = new Parser(src, ctx);
    const value = p.parseExpr();
    p.skip();
    if (p.i < p.s.length) throw new Fail();
    return { ok: true, value };
  } catch (e) {
    if (e instanceof Flight) return { ok: false, flight: true };
    return { ok: false };
  }
}

class Parser {
  constructor(s, ctx) { this.s = s; this.i = 0; this.ctx = ctx; }
  skip() { while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++; }
  peek() { return this.s[this.i]; }
  starts(w) { return this.s.startsWith(w, this.i); }
  identChar(c) { return c != null && /[A-Za-z0-9_$]/.test(c); }
  eat(w) {
    this.skip();
    if (!this.starts(w)) return false;
    const next = this.s[this.i + w.length];
    if (this.identChar(w[w.length - 1]) && this.identChar(next)) return false;
    this.i += w.length;
    return true;
  }
  parseExpr() {
    const c = this.parseOr();
    this.skip();
    // Only the taken branch runs, so `cond ? await x : null` does not open a flight when cond is false.
    if (this.peek() === "?" && this.s[this.i + 1] !== "." && this.s[this.i + 1] !== "?") {
      this.i++;
      const truth = this.cutBranch();
      if (!this.eat(":")) throw new Fail();
      const falsy = this.cutBranch();
      const v = evaluate(c ? truth : falsy, this.ctx);
      if (v.flight) throw new Flight();
      if (!v.ok) throw new Fail();
      return v.value;
    }
    return c;
  }
  /** One ternary branch: stop at the matching `:`, or at a comma / closer, nesting counted. */
  cutBranch() {
    const start = this.i;
    let depth = 0, tern = 0, quote = null;
    for (let i = this.i; i < this.s.length; i++) {
      const c = this.s[i];
      if (quote) {
        if (c === "\\") { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        if (depth === 0) { this.i = i; return this.s.slice(start, i).trim(); }
        depth--;
      } else if (depth === 0 && (c === "," || c === ";")) {
        this.i = i;
        return this.s.slice(start, i).trim();
      } else if (depth === 0 && c === "?" && this.s[i + 1] !== "." && this.s[i + 1] !== "?") tern++;
      else if (depth === 0 && c === ":" && this.s[i + 1] !== "=") {
        if (tern > 0) tern--;
        else { this.i = i; return this.s.slice(start, i).trim(); }
      }
    }
    this.i = this.s.length;
    return this.s.slice(start).trim();
  }
  parseOr() {
    let v = this.parseAnd();
    while (this.eat("||")) { const r = this.parseAnd(); v = v || r; }
    return v;
  }
  parseAnd() {
    let v = this.parseCmp();
    while (this.eat("&&")) { const r = this.parseCmp(); v = v && r; }
    return v;
  }
  parseCmp() {
    let v = this.parseSum();
    for (;;) {
      let op = null;
      if (this.eat("===")) op = "===";
      else if (this.eat("!==")) op = "!==";
      else if (this.eat("==")) op = "==";
      else if (this.eat("!=")) op = "!=";
      else if (this.eat("<=")) op = "<=";
      else if (this.eat(">=")) op = ">=";
      else if (this.eat("<")) op = "<";
      else if (this.eat(">")) op = ">";
      else break;
      const r = this.parseSum();
      if (op === "===" || op === "==") v = v === r;
      else if (op === "!==" || op === "!=") v = v !== r;
      else if (op === "<") v = v < r;
      else if (op === "<=") v = v <= r;
      else if (op === ">") v = v > r;
      else v = v >= r;
    }
    return v;
  }
  parseSum() {
    let v = this.parseProd();
    for (;;) {
      let op = null;
      if (this.eat("+")) op = "+";
      else if (this.eat("-")) op = "-";
      else break;
      const r = this.parseProd();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  parseProd() {
    let v = this.parseUnary();
    for (;;) {
      let op = null;
      if (this.eat("*")) op = "*";
      else if (this.eat("/")) op = "/";
      else if (this.eat("%")) op = "%";
      else break;
      const r = this.parseUnary();
      v = op === "*" ? v * r : op === "/" ? (r === 0 ? 0 : v / r) : (r === 0 ? 0 : v % r);
    }
    return v;
  }
  parseUnary() {
    this.skip();
    if (this.eat("!")) return !this.parseUnary();
    if (this.eat("typeof")) return typeof this.parseUnary();
    if (this.peek() === "-" && this.s[this.i + 1] !== "=" && this.s[this.i + 1] !== ">") { this.i++; return -this.parseUnary(); }
    if (this.eat("await")) {
      if (this.ctx.mode !== "land") throw new Flight();
      this.skip();
      const body = this.sliceBody();
      this.i += body.length;
      return this.ctx.awaitValue(body);
    }
    return this.parsePostfix();
  }
  parsePostfix() {
    let v = this.parsePrimary();
    for (;;) {
      this.skip();
      if (this.eat("?.")) {
        const name = this.parseIdent();
        this.skip();
        if (v == null) { if (this.peek() === "(") { this.i++; this.parseArgs(); } continue; }
        if (this.peek() === "(") { this.i++; v = this.callMethod(v, name, this.parseArgs()); }
        else v = v[name];
      } else if (this.eat(".")) {
        const name = this.parseIdent();
        this.skip();
        if (this.peek() === "(") { this.i++; v = this.callMethod(v, name, this.parseArgs()); }
        else if (name === "length") v = v == null ? 0 : v.length ?? 0;
        else if (v != null && typeof v === "object") v = v[name];
        else throw new Fail();
      } else if (this.peek() === "(" && typeof v === "function") {
        this.i++;
        v = v(...this.parseArgs());
      } else if (this.peek() === "[") {
        this.i++;
        const k = this.parseExpr();
        if (!this.eat("]")) throw new Fail();
        v = v == null ? undefined : v[k];
      } else break;
    }
    return v;
  }
  parsePrimary() {
    this.skip();
    const c = this.peek();
    if (c == null) throw new Fail();
    if (this.eat("(")) {
      if (this.looksLikeParams()) return this.finishArrow(this.takeParams());
      const v = this.parseExpr();
      if (!this.eat(")")) throw new Fail();
      return v;
    }
    if (c === '"' || c === "'") return this.parseString();
    if (c === "`") return this.parseTemplate();
    if (c === "[") return this.parseArray();
    if (c === "{") return this.parseObject();
    if (c >= "0" && c <= "9") return this.parseNumber();
    if (this.eat("true")) return true;
    if (this.eat("false")) return false;
    if (this.eat("null")) return null;
    if (this.eat("undefined")) return undefined;
    if (this.starts("pending?") && !this.identChar(this.s[this.i + 8])) {
      this.i += 8;
      this.skip();
      return this.ctx.pending(this.parseIdent());
    }
    if (this.eat("latest")) return this.ctx.get(this.parseIdent());
    if (this.identChar(c) && /[A-Za-z_$]/.test(c)) {
      const name = this.parseIdent();
      this.skip();
      if (this.eat("=>")) return this.finishArrow([name]);
      if (this.peek() === "(") { this.i++; return this.callNamed(name, this.parseArgs()); }
      return this.ctx.get(name);
    }
    throw new Fail();
  }
  parseIdent() {
    this.skip();
    const start = this.i;
    if (!/[A-Za-z_$]/.test(this.peek() ?? "")) throw new Fail();
    this.i++;
    while (this.identChar(this.peek())) this.i++;
    return this.s.slice(start, this.i);
  }
  parseNumber() {
    const start = this.i;
    while (/[0-9.]/.test(this.peek() ?? "")) this.i++;
    const n = Number(this.s.slice(start, this.i));
    if (Number.isNaN(n)) throw new Fail();
    return n;
  }
  parseString() {
    const q = this.s[this.i++];
    let out = "";
    while (this.i < this.s.length && this.s[this.i] !== q) {
      if (this.s[this.i] === "\\") { out += this.s[this.i + 1] ?? ""; this.i += 2; continue; }
      out += this.s[this.i++];
    }
    if (this.s[this.i] !== q) throw new Fail();
    this.i++;
    return out;
  }
  parseTemplate() {
    this.i++;
    let out = "";
    while (this.i < this.s.length && this.s[this.i] !== "`") {
      if (this.s[this.i] === "$" && this.s[this.i + 1] === "{") {
        this.i += 2;
        const v = this.parseExpr();
        if (!this.eat("}")) throw new Fail();
        out += v == null ? "" : String(v);
      } else if (this.s[this.i] === "\\") { out += this.s[this.i + 1] ?? ""; this.i += 2; }
      else out += this.s[this.i++];
    }
    if (this.s[this.i] !== "`") throw new Fail();
    this.i++;
    return out;
  }
  parseArray() {
    this.i++;
    const out = [];
    for (;;) {
      this.skip();
      if (this.peek() === "]") { this.i++; break; }
      if (this.eat("...")) {
        const v = this.parseOr();
        if (!Array.isArray(v)) throw new Fail();
        out.push(...v);
      } else out.push(this.parseExpr());
      this.skip();
      if (this.peek() === ",") this.i++;
    }
    return out;
  }
  parseObject() {
    this.i++;
    const out = {};
    for (;;) {
      this.skip();
      if (this.peek() === "}") { this.i++; break; }
      if (this.eat("...")) {
        const v = this.parseExpr();
        if (v == null || typeof v !== "object") throw new Fail();
        Object.assign(out, v);
      } else if (this.peek() === '"' || this.peek() === "'") {
        const k = this.parseString();
        if (!this.eat(":")) throw new Fail();
        out[k] = this.parseExpr();
      } else {
        const k = this.parseIdent();
        if (this.eat(":")) out[k] = this.parseExpr();
        else out[k] = this.ctx.get(k);
      }
      this.skip();
      if (this.peek() === ",") this.i++;
    }
    return out;
  }
  parseArgs() {
    const args = [];
    for (;;) {
      this.skip();
      if (this.peek() === ")") { this.i++; break; }
      args.push(this.parseExpr());
      this.skip();
      if (this.peek() === ",") this.i++;
    }
    return args;
  }
  looksLikeParams() {
    const save = this.i;
    try {
      this.takeParams();
      this.skip();
      const ok = this.starts("=>");
      this.i = save;
      return ok;
    } catch { this.i = save; return false; }
  }
  takeParams() {
    const params = [];
    for (;;) {
      this.skip();
      if (this.peek() === ")") { this.i++; break; }
      if (!/[A-Za-z_$]/.test(this.peek() ?? "")) throw new Fail();
      params.push(this.parseIdent());
      this.skip();
      if (this.peek() === ":") { this.i++; this.skipType(); this.skip(); }
      if (this.peek() === ",") { this.i++; continue; }
      if (this.peek() === ")") { this.i++; break; }
      throw new Fail();
    }
    return params;
  }
  skipType() {
    let depth = 0;
    while (this.i < this.s.length) {
      const c = this.s[this.i];
      if (depth === 0 && (c === "," || c === ")" || c === "=")) break;
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") { if (depth === 0) break; depth--; }
      this.i++;
    }
  }
  finishArrow(params) {
    this.skip();
    const body = this.sliceBody();
    this.i += body.length;
    const ctx = this.ctx;
    return (...args) => {
      const env = new Map(params.map((p, i) => [p, args[i]]));
      const v = evaluate(body, ctx.withEnv(env));
      if (v.flight) throw new Flight();
      if (!v.ok) throw new Fail();
      return v.value;
    };
  }
  /** Body of an arrow or an `await`, cut at a comma or closer that isn't nested. */
  sliceBody() {
    const start = this.i;
    let depth = 0, quote = null;
    for (let i = this.i; i < this.s.length; i++) {
      const c = this.s[i];
      if (quote) {
        if (c === "\\") { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") { if (depth === 0) return this.s.slice(start, i); depth--; }
      else if (depth === 0 && (c === "," || c === ";")) return this.s.slice(start, i);
    }
    return this.s.slice(start);
  }
  callNamed(name, args) {
    if (name === "len" || name === "length") return args[0] == null ? 0 : (args[0].length ?? 0);
    if (name === "peek") return args[0];
    if (name === "str" || name === "String") return args[0] == null ? "" : String(args[0]);
    if (this.ctx.mode === "land") return this.ctx.awaitValue(name);
    throw new Fail();
  }
  callMethod(recv, name, args) {
    if (typeof recv === "string" && typeof String.prototype[name] === "function" && name !== "constructor") {
      return recv[name](...args);
    }
    if (!Array.isArray(recv)) throw new Fail();
    const fn = args[0];
    if (name === "map") return recv.map((x, i) => (typeof fn === "function" ? fn(x, i) : x));
    if (name === "filter") return recv.filter((x, i) => (typeof fn === "function" ? fn(x, i) : true));
    if (name === "some") return recv.some((x, i) => (typeof fn === "function" ? fn(x, i) : false));
    if (name === "every") return recv.every((x, i) => (typeof fn === "function" ? fn(x, i) : false));
    if (name === "find") return recv.find((x, i) => (typeof fn === "function" ? fn(x, i) : false)) ?? null;
    if (name === "findIndex") return recv.findIndex((x, i) => (typeof fn === "function" ? fn(x, i) : false));
    if (name === "reduce") return recv.reduce((a, x) => (typeof fn === "function" ? fn(a, x) : a), args[1]);
    if (name === "slice") return recv.slice(args[0], args[1]);
    if (name === "concat") return recv.concat(...args);
    if (name === "includes") return recv.includes(args[0]);
    throw new Fail();
  }
}

// ---- values ------------------------------------------------------------------------------------------------------

const POOLS = {
  query: ["", "a", "note", "rx", "hello"],
  q: ["note", "a", "rx", "hello", ""],
  search: ["", "a", "note", "rx"],
  name: ["Ada", "Bea", "Cam", "Dee"],
  title: ["Groceries", "Ideas", "Later", "Ship"],
  body: ["hello", "more text", "ship it"],
  saveError: ["", "could not save", "conflict"],
  orderError: ["", "declined", "network"],
  email: ["ada@ex.com", "bea@ex.com", "cam@ex.com"],
  layout: ["wide", "narrow"],
  filter: ["all", "active", "done"],
};

function poolFor(name) {
  return POOLS[name] ?? POOLS[name?.replace(/Error$/, "") && name.endsWith("Error") ? "saveError" : ""] ?? ["", "updated", "next", "other"];
}

function splitUnion(t) {
  const parts = [];
  let depth = 0, cur = "";
  for (const c of t) {
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    if (c === "|" && depth === 0) { parts.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function loadAliases(graph) {
  const map = new Map();
  for (const file of Object.keys(graph.lines ?? {})) {
    const lines = graph.lines[file];
    const keys = Object.keys(lines).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    for (let i = 0; i < keys.length; i++) {
      const m = /^(?:export\s+)?type\s+(\w+)\s*=\s*(.*)$/.exec(String(lines[keys[i]]).trim());
      if (!m) continue;
      let body = m[2];
      while (body.includes("{") && !body.includes("}") && i + 1 < keys.length) body += " " + String(lines[keys[++i]]).trim();
      map.set(m[1], body.trim());
    }
  }
  return map;
}

function sampleOf(type, name, salt, aliases) {
  let t = String(type ?? "").trim();
  if (aliases?.has(t)) t = aliases.get(t);
  if (!t) return (poolFor(name)[salt % poolFor(name).length]) || "item";
  if (t === "number") return name === "id" ? 1 + (salt % 5) : 1 + (salt % 97);
  if (t === "string") {
    const pool = poolFor(name);
    return pool[salt % pool.length] || `item ${salt % 9}`;
  }
  if (t === "boolean") return salt % 2 === 0;
  if (t.endsWith("[]")) {
    const elem = t.slice(0, -2).trim();
    const n = 1 + (salt % 3);
    return Array.from({ length: n }, (_, i) => sampleOf(elem, name, salt + i + 1, aliases));
  }
  if (t.startsWith("{")) return sampleObject(t, salt, aliases);
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  if (t.includes("|")) {
    const parts = splitUnion(t).map(p => p.trim()).filter(p => p && p !== "null" && p !== t);
    if (!parts.length) return null;
    return sampleOf(parts[salt % parts.length], name, salt, aliases);
  }
  return (poolFor(name)[salt % poolFor(name).length]) || "value";
}

function sampleObject(type, salt, aliases) {
  const body = type.replace(/^\{/, "").replace(/\}$/, "");
  const fields = [];
  let depth = 0, cur = "";
  for (const c of body) {
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    if (c === ";" && depth === 0 || c === "," && depth === 0) { if (cur.trim()) fields.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  if (cur.trim()) fields.push(cur.trim());
  const obj = {};
  fields.forEach((f, i) => {
    const m = /^(\w+)\??\s*:\s*([\s\S]+)$/.exec(f);
    if (!m) return;
    obj[m[1]] = sampleOf(m[2].trim(), m[1], salt + i + 1, aliases);
  });
  return obj;
}

function zeroOf(type, name, aliases) {
  const t = String(type ?? "").trim();
  if (!t) return null;
  if (t === "number") return 0;
  if (t === "string") return "";
  if (t === "boolean") return false;
  if (t.endsWith("[]")) return [];
  if (t.includes("null")) return null;
  if (t.includes("|")) return zeroOf(splitUnion(t).find(p => p !== "null") ?? "", name, aliases);
  if (t.startsWith("{") || aliases?.has(t)) return sampleOf(t, name, hash(name), aliases);
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return null;
}

function rhsExpr(node, graph) {
  const parsed = parseDecl(node.kind, node.name, declText(graph, node));
  return String(parsed.rhs ?? "").replace(/\s+->[\s\S]*$/, "").trim();
}

function fallbackLiteral(rhs) {
  const m = /->\s*([\s\S]+?)(?:\s+catch\b|$)/.exec(rhs ?? "");
  return m ? m[1].trim() : null;
}

function nodeType(node, graph) {
  if (node.type) return String(node.type);
  return parseDecl(node.kind, node.name, declText(graph, node)).type;
}

function isAsyncNode(node, graph) {
  if (node.async) return true;
  return /\bawait\b/.test(declText(graph, node));
}

function isQuestion(node, graph) {
  return (node.kind === "source" || node.kind === "eq") && (node.question || node.async || /\bawait\b/.test(rhsExpr(node, graph)));
}

// ---- host --------------------------------------------------------------------------------------------------------

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

/**
 * @param {object} graph a `buildGraph` result (keys already applied)
 * @param {{ seed?: number, rate?: number, capacity?: number, failRate?: number }} [opts]
 *   `rate` is ticks between automatic actions (default 0: only `act` fires one). `capacity` is the timeline
 *   ring (default 2000). Same seed and the same calls produce the same messages.
 * @returns {{ post: Function, subscribe: Function, tick: Function, act: Function, editModule: Function, dispose: Function }}
 */
export function createFakeHost(graph, opts = {}) {
  if (!graph || !Array.isArray(graph.nodes)) throw new TypeError("createFakeHost: expected a graph");
  const seed = opts.seed ?? 1;
  const rate = opts.rate ?? 0;
  const capacity = opts.capacity ?? 2000;
  // v0.4: a share of answers fail (`failRate`, default 0, so seeds and the suite are unchanged): the node's flush change
  // carries `error` and no `preview`
  const failRate = opts.failRate ?? 0;
  const rng = mulberry32(seed);

  let g = clone(graph);
  let disposed = false;
  let clock = 0;
  let tickCount = 0;
  let seq = 0;
  let head = 0;
  let floor = 0;
  let viewing = null;
  let selected = null;
  let booted = false;
  let editCount = 0;
  let hmrN = 0;
  let landN = 0;

  const subs = new Set();
  const values = new Map();
  const shown = new Map();
  const base = new Map();
  /** @type {object[]} */
  const steps = [];
  /** @type {Map<string, { node: any, landTick: number, abandon: boolean }>} */
  const inFlight = new Map();
  /** @type {{ landTick: number, writes: any[], refresh: any[], affects: any[], cause: string, origin: string }[]} */
  let holds = [];

  let byId = new Map();
  let byKey = new Map();
  let aliases = new Map();

  const rebuild = () => {
    byId = new Map(g.nodes.map(n => [n.id, n]));
    byKey = new Map(g.nodes.filter(n => n.key).map(n => [n.key, n]));
    aliases = loadAliases(g);
  };
  rebuild();

  const scopeOf = node => keyParts(node.key ?? "").scope;
  const resolve = (name, from) => {
    const all = g.nodes.filter(n => n.name === name && !n.site && n.key);
    if (!all.length) return null;
    if (!from) return all[0];
    const sameMod = all.filter(n => n.mod === from.mod);
    return sameMod.find(n => scopeOf(n) === scopeOf(from))
      ?? sameMod.find(n => scopeOf(n) === "")
      ?? sameMod[0]
      ?? all[0];
  };

  const makeCtx = (node, mode, env) => {
    const ctx = {
      mode,
      withEnv(extra) {
        const merged = new Map(env ?? []);
        for (const [k, v] of extra) merged.set(k, v);
        return makeCtx(node, mode, merged);
      },
      get(name) {
        if (env?.has(name)) return env.get(name);
        const hit = resolve(name, node);
        if (!hit || !values.has(hit.key)) throw new Fail();
        return values.get(hit.key);
      },
      pending(name) {
        const hit = resolve(name, node);
        return !!(hit && inFlight.has(hit.key));
      },
      awaitValue(body) {
        const hint = String(body ?? "");
        let type = node ? nodeType(node, g) : null;
        if (!type) {
          if (/getNote|\bNote\b/.test(hint)) type = "Note";
          else if (/fetchUsers|\bUser\b/.test(hint)) type = "User[]";
          else if (/loadTodos|\bTodo\b/.test(hint)) type = "Todo[]";
          else if (/fetchProducts|\bProduct\b/.test(hint)) type = "Product[]";
          else if (/listNotes/.test(hint)) type = "Note[]";
        }
        const reads = node ? readPreviews(node) : [];
        const salt = hash(`${node?.key ?? ""}:${reads.join("|")}:${hint}:${landN}`);
        if (type) return sampleOf(type, node?.name ?? "value", salt, aliases);
        if (node && /width|count|total|page|id|discount/.test(node.name)) return 800 + (salt % 400);
        return sampleOf("string", node?.name ?? "value", salt, aliases);
      },
    };
    return ctx;
  };

  function readPreviews(node) {
    const out = [];
    for (const e of g.edges) {
      if (e.type !== "read" || e.to !== node.id) continue;
      const s = byId.get(e.from);
      if (s?.key && values.has(s.key)) out.push(preview(values.get(s.key)));
    }
    return out;
  }

  function evalNode(node, mode) {
    const expr = rhsExpr(node, g);
    if (!expr) return { ok: false };
    return evaluate(expr, makeCtx(node, mode, null));
  }

  function initialOf(node) {
    const text = declText(g, node);
    const parsed = parseDecl(node.kind, node.name, text);
    const fb = fallbackLiteral(parsed.rhs);
    if (fb != null) {
      const v = evaluate(fb, makeCtx(node, "sync", null));
      if (v.ok) return v.value;
    }
    if (node.kind === "source" && parsed.op === ":=") {
      const v = evaluate(parsed.rhs, makeCtx(node, "sync", null));
      if (v.ok) return v.value;
    }
    if (parsed.rhs && !/\bawait\b/.test(parsed.rhs)) {
      const v = evaluate(rhsExpr(node, g), makeCtx(node, "sync", null));
      if (v.ok) return v.value;
    }
    const type = parsed.type;
    if (type) return zeroOf(type, node.name, aliases);
    if (node.kind === "source" || node.kind === "eq") return null;
    return undefined;
  }

  function topo(list) {
    const ids = new Set(list.map(n => n.id));
    const indeg = new Map(list.map(n => [n.id, 0]));
    const kids = new Map();
    for (const n of list) {
      for (const e of g.edges) {
        if (e.type !== "read" || e.to !== n.id || e.probe || e.mode === "snapshot") continue;
        if (!ids.has(e.from)) continue;
        indeg.set(n.id, indeg.get(n.id) + 1);
        (kids.get(e.from) ?? kids.set(e.from, []).get(e.from)).push(n.id);
      }
    }
    const ready = list.filter(n => indeg.get(n.id) === 0).sort(byKeySort);
    const out = [];
    while (ready.length) {
      ready.sort(byKeySort);
      const n = ready.shift();
      out.push(n);
      for (const id of kids.get(n.id) ?? []) {
        indeg.set(id, indeg.get(id) - 1);
        if (indeg.get(id) === 0) ready.push(byId.get(id));
      }
    }
    for (const n of list.slice().sort(byKeySort)) if (!out.includes(n)) out.push(n);
    return out;
  }
  const byKeySort = (a, b) => (a?.key ?? "") < (b?.key ?? "") ? -1 : (a?.key ?? "") > (b?.key ?? "") ? 1 : 0;

  function initAll() {
    for (const n of g.nodes) {
      if (n.kind !== "source") continue;
      const v = initialOf(n);
      if (v !== undefined) values.set(n.key, v);
    }
    const eqs = g.nodes.filter(n => n.kind === "eq" || n.kind === "effect");
    for (const n of eqs) {
      const parsed = parseDecl(n.kind, n.name, declText(g, n));
      const fb = fallbackLiteral(parsed.rhs);
      if (fb != null) {
        const v = evaluate(fb, makeCtx(n, "sync", null));
        if (v.ok) values.set(n.key, v.value);
      }
    }
    for (const n of topo(eqs)) {
      if (values.has(n.key) && isAsyncNode(n, g)) continue;
      const v = evalNode(n, "sync");
      if (v.ok) values.set(n.key, v.value);
      else if (!values.has(n.key)) {
        const z = zeroOf(nodeType(n, g), n.name, aliases);
        values.set(n.key, z === undefined ? null : z);
      }
    }
  }
  initAll();

  function emit(msg) {
    if (disposed) return;
    const full = { source: SOURCE, v: V, ...msg };
    if (viewing != null && full.type === "flush") return;
    for (const fn of subs) fn(full);
  }

  function record(step) {
    steps.push(step);
    head = step.seq;
    for (const c of step.changes) {
      if (c.preview === undefined) shown.delete(c.key);
      else shown.set(c.key, c.preview);
    }
    while (steps.length > capacity) {
      const old = steps.shift();
      for (const c of old.changes) {
        if (c.preview === undefined) base.delete(c.key);
        else base.set(c.key, c.preview);
      }
      floor = old.seq;
    }
  }

  function valuesAt(seqN) {
    // before a key's first recorded change, its value is that change's `prev` (TRACE-CONTRACT §4b)
    const m = new Map(base), seen = new Set(base.keys());
    for (const s of steps) for (const c of s.changes) {
      if (c.key == null || seen.has(c.key)) continue;
      seen.add(c.key);
      if (c.prev !== undefined) m.set(c.key, c.prev);
    }
    for (const s of steps) {
      if (s.seq > seqN) break;
      for (const c of s.changes) {
        if (c.preview === undefined) m.delete(c.key);
        else m.set(c.key, c.preview);
      }
    }
    return m;
  }

  function diffMaps(from, to) {
    const keys = [...new Set([...from.keys(), ...to.keys()])].sort();
    const changes = [];
    for (const key of keys) {
      const hasA = from.has(key), hasB = to.has(key);
      if (hasA && hasB && from.get(key) === to.get(key)) continue;
      const node = byKeyGet(key);
      const c = { key, name: node?.name ?? keyParts(key).name };
      if (hasA) c.prev = from.get(key);
      if (hasB) c.preview = to.get(key);
      changes.push(c);
    }
    return changes;
  }
  function byKeyGet(key) { return g.nodes.find(n => n.key === key) ?? null; }

  function commitFlush(changes, ctx) {
    if (!changes.length) return;
    seq += 1;
    const step = { seq, at: clock, changes, order: changes.map(c => c.key) };
    if (ctx.origin) step.origin = ctx.origin;
    if (ctx.cause) step.cause = ctx.cause;
    record(step);
    emit({ type: "flush", ...step });
  }

  function changeFor(node, prevInternal) {
    const p = preview(values.get(node.key));
    if (prevInternal !== undefined && prevInternal === p) return null;
    const shownP = shown.has(node.key) ? shown.get(node.key) : undefined;
    if (shownP === p) return null;
    const c = { key: node.key, name: node.name, preview: p };
    if (prevInternal !== undefined) c.prev = prevInternal;
    return c;
  }

  function assign(node, next) {
    const prev = values.has(node.key) ? preview(values.get(node.key)) : undefined;
    values.set(node.key, next);
    return { node, prev };
  }

  function scheduleFlight(node, ctx) {
    if (!node?.key) return;
    if (inFlight.has(node.key)) {
      emit({ type: "flight", key: node.key, state: "abandon", at: clock });
      inFlight.delete(node.key);
    }
    const delay = 2 + Math.floor(rng() * 3);
    const abandon = rng() < 0.1;
    inFlight.set(node.key, { node, landTick: tickCount + delay, abandon, cause: ctx.cause ?? node.key, origin: ctx.origin });
    emit({ type: "flight", key: node.key, state: "start", at: clock });
  }

  function probeUpdates(nodes) {
    const out = [];
    const seen = new Set();
    for (const n of nodes) {
      for (const e of g.edges) {
        if (e.type !== "read" || !e.probe || e.from !== n.id) continue;
        const r = byId.get(e.to);
        if (!r || (r.kind !== "eq" && r.kind !== "effect") || seen.has(r.id)) continue;
        seen.add(r.id);
        const v = evalNode(r, "sync");
        if (!v.ok) continue;
        out.push(assign(r, v.value));
      }
    }
    return out;
  }

  function invent(node) {
    const cur = values.get(node.key);
    const type = nodeType(node, g);
    const salt = hash(`${node.key}:${readPreviews(node).join("|")}:${tickCount}`);
    if (typeof cur === "number") return cur + 1;
    if (typeof cur === "string") {
      const pool = poolFor(node.name);
      const i = pool.indexOf(cur);
      return i >= 0 ? pool[(i + 1) % pool.length] : pool[salt % pool.length];
    }
    if (typeof cur === "boolean") return !cur;
    if (Array.isArray(cur)) {
      const elem = type?.replace(/\[\]\s*$/, "").trim();
      if (cur.length && salt % 5 === 0) return cur.slice(0, -1);
      const item = elem ? sampleOf(elem, node.name, salt, aliases) : { id: cur.length + 1 };
      return [...cur, item];
    }
    if (cur && typeof cur === "object") {
      const copy = { ...cur };
      const keys = Object.keys(copy);
      if (!keys.length) return copy;
      const k = keys[salt % keys.length];
      if (typeof copy[k] === "number") copy[k] = copy[k] + 1;
      else if (typeof copy[k] === "string") copy[k] = poolFor(k)[(salt + 1) % poolFor(k).length];
      else if (typeof copy[k] === "boolean") copy[k] = !copy[k];
      return copy;
    }
    if (type) return sampleOf(type, node.name, salt, aliases);
    return sampleOf("string", node.name, salt, aliases);
  }

  function propagateWithPrev(seeds, ctx, prevs) {
    const prevMap = prevs ?? new Map();
    const written = new Set(seeds.map(n => n.id));
    const reach = new Set();
    const stack = [...seeds];
    while (stack.length) {
      const n = stack.pop();
      for (const e of g.edges) {
        if (e.type !== "read" || e.from !== n.id || e.probe || e.mode === "snapshot") continue;
        const r = byId.get(e.to);
        if (!r) continue;
        const live = r.kind === "eq" || r.kind === "effect" || (r.kind === "source" && (r.question || r.async));
        if (!live || reach.has(r.id)) continue;
        reach.add(r.id);
        stack.push(r);
      }
    }
    const ordered = topo([...reach].map(id => byId.get(id)).filter(Boolean));
    const assigned = [];
    const started = [];
    for (const n of ordered) {
      if (written.has(n.id)) continue;
      const asyncQ = isQuestion(n, g) && (n.async || /\bawait\b/.test(rhsExpr(n, g)));
      if (asyncQ) {
        const trial = evalNode(n, "sync");
        if (trial.ok && !trial.flight) { assigned.push(assign(n, trial.value)); continue; }
        started.push(n);
        continue;
      }
      const trial = evalNode(n, "sync");
      if (trial.flight) { started.push(n); continue; }
      if (trial.ok) assigned.push(assign(n, trial.value));
      else assigned.push(assign(n, invent(n)));
    }
    for (const n of started) scheduleFlight(n, ctx);
    const probes = probeUpdates([...seeds, ...started]);
    const changes = [];
    const seen = new Set();
    const push = (node, prev) => {
      if (!node?.key || seen.has(node.key)) return;
      seen.add(node.key);
      const c = changeFor(node, prev);
      if (!c) return;
      if (ctx.origin) c.origin = ctx.origin;
      changes.push(c);
    };
    for (const n of seeds) push(n, prevMap.get(n.key));
    for (const a of [...assigned, ...probes]) push(a.node, a.prev);
    commitFlush(changes, ctx);
  }

  function scanExpr(text, start) {
    let depth = 0, quote = null;
    let i = start;
    for (; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === "\\") { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") { if (depth > 0) depth--; }
      else if (depth === 0 && (c === ";" || c === "\n")) break;
    }
    return trimExpr(text.slice(start, i));
  }
  function extractAssign(text, name, guess) {
    const re = guess
      ? new RegExp(`guess\\s+${name}\\s*:=\\s*`)
      : new RegExp(`(?<!guess\\s)\\b${name}\\s*:=\\s*`);
    const m = re.exec(text);
    return m ? scanExpr(text, m.index + m[0].length) : null;
  }
  function assignAt(text, name, guess) {
    const re = guess
      ? new RegExp(`guess\\s+${name}\\s*:=`)
      : new RegExp(`(?<!guess\\s)\\b${name}\\s*:=`);
    const m = re.exec(text);
    return m ? m.index : -1;
  }

  function evalWrite(expr, argEnv, from, node) {
    if (!expr) return null;
    const v = evaluate(expr, makeCtx(from, "sync", argEnv));
    if (!v.ok) return null;
    // `name := xs => xs.map(...)` is a functional write: apply it to the current value.
    if (typeof v.value === "function") {
      try {
        const cur = node && values.has(node.key) ? values.get(node.key) : undefined;
        return v.value(cur);
      } catch { return null; }
    }
    return v.value;
  }
  function trimExpr(expr) {
    let s = String(expr).trim().replace(/;+\s*$/, "");
    const balance = t => {
      let d = 0;
      for (const c of t) if (c === "{") d++; else if (c === "}") d--;
      return d;
    };
    while (s.endsWith("}") && balance(s) < 0) s = s.slice(0, -1).trim();
    return s;
  }

  function parseParams(text) {
    const m = /\(([^)]*)\)/.exec(String(text).split("\n")[0]);
    if (!m || !m[1].trim()) return [];
    return m[1].split(",").map(p => {
      const [name, type] = p.split(":").map(s => s?.trim());
      return name ? { name, type: type ?? "" } : null;
    }).filter(Boolean);
  }

  function sampleArg(param) {
    const name = param.name;
    const type = param.type ?? "";
    const pool = poolFor(name);
    if (name === "q" || name === "query") return pool[Math.floor(rng() * pool.length)];
    if (name === "name" || name === "title" || name === "body") return pool[Math.floor(rng() * pool.length)];
    if (name === "done" || type === "boolean") return rng() < 0.5;
    if (type.includes("[]")) return [];
    if (name === "id" || type.includes("number") || !type) return 1 + Math.floor(rng() * 5);
    if (type.includes("string")) return pool[Math.floor(rng() * pool.length)] || "x";
    return 1 + Math.floor(rng() * 4);
  }

  function fmtArg(v) {
    if (typeof v === "string") return /^[\w ]*$/.test(v) ? v : JSON.stringify(v);
    if (typeof v === "number" || typeof v === "boolean" || v == null) return String(v);
    return preview(v);
  }

  function runAction(action) {
    const text = declText(g, action);
    const params = parseParams(text);
    const args = params.map(sampleArg);
    const origin = `action ${action.name}(${args.map(fmtArg).join(", ")})`;
    const argEnv = new Map(params.map((p, i) => [p.name, args[i]]));
    const awaitAt = text.search(/\bawait\b/);
    const edges = g.edges.filter(e => e.from === action.id && e.type === "write").slice().sort((a, b) => String(a.op).localeCompare(String(b.op)));
    const sync = [];
    const held = [];
    const refreshNow = [];
    const refreshHeld = [];
    const affects = [];
    for (const e of edges) {
      const node = byId.get(e.to);
      if (!node || node.kind !== "source") continue;
      if (e.op === "refresh") {
        const off = text.search(new RegExp(`refresh\\s+${node.name}\\b`));
        (awaitAt >= 0 && off > awaitAt ? refreshHeld : refreshNow).push(node);
        continue;
      }
      if (e.op === "affects") { affects.push(node); continue; }
      const guess = e.op === "optimistic";
      const expr = extractAssign(text, node.name, guess);
      const off = assignAt(text, node.name, guess);
      const isHeld = !guess && awaitAt >= 0 && off > awaitAt;
      (isHeld ? held : sync).push({ node, expr, argEnv, from: action });
    }
    const ctx = { cause: action.key, origin };
    const concrete = list => list.map(w => ({ node: w.node, value: evalWrite(w.expr, w.argEnv, w.from, w.node) ?? invent(w.node) }));
    const syncWrites = concrete(sync);
    const prevs = new Map();
    for (const w of syncWrites) {
      if (inFlight.has(w.node.key)) {
        emit({ type: "flight", key: w.node.key, state: "abandon", at: clock });
        inFlight.delete(w.node.key);
      }
      prevs.set(w.node.key, values.has(w.node.key) ? preview(values.get(w.node.key)) : undefined);
      values.set(w.node.key, w.value);
    }
    for (const n of affects) scheduleFlight(n, ctx);
    for (const n of refreshNow) scheduleFlight(n, ctx);
    propagateWithPrev(syncWrites.map(w => w.node), ctx, prevs);
    if (held.length || refreshHeld.length) {
      const delay = 2 + Math.floor(rng() * 3);
      holds.push({ landTick: tickCount + delay, writes: held, refresh: refreshHeld, cause: action.key, origin });
      // v0.4: the written-but-held sources, and what they wait on (what the action awaits: its calls, else itself)
      const by = g.edges.filter(e => e.from === action.id && e.type === "call").map(e => byId.get(e.to)?.key).filter(Boolean);
      for (const w of held) emit({ type: "held", key: w.node.key, by: by.length ? [...new Set(by)] : [action.key], at: clock });
    }
  }

  function landFlight(f) {
    if (inFlight.get(f.node.key) !== f) return;
    inFlight.delete(f.node.key);
    landN++;
    if (f.abandon) {
      emit({ type: "flight", key: f.node.key, state: "abandon", at: clock });
      const probes = probeUpdates([f.node]);
      const changes = [];
      for (const a of probes) {
        const c = changeFor(a.node, a.prev);
        if (c) changes.push(c);
      }
      commitFlush(changes, { cause: f.node.key, origin: `flight ${f.node.name}` });
      return;
    }
    if (failRate > 0 && rng() < failRate) {
      emit({ type: "flight", key: f.node.key, state: "land", at: clock });
      const c = { key: f.node.key, name: f.node.name, error: `ServerError: ${f.node.name} failed (503)` };
      if (shown.has(f.node.key)) c.prev = shown.get(f.node.key);
      commitFlush([c], { cause: f.node.key, origin: `flight ${f.node.name}` });
      return;
    }
    const trial = evalNode(f.node, "land");
    const next = trial.ok ? trial.value : invent(f.node);
    const prev = values.has(f.node.key) ? preview(values.get(f.node.key)) : undefined;
    values.set(f.node.key, next);
    emit({ type: "flight", key: f.node.key, state: "land", at: clock });
    propagateWithPrev([f.node], { cause: f.node.key, origin: `flight ${f.node.name}` }, new Map([[f.node.key, prev]]));
  }

  function landDue() {
    const dueH = holds.filter(h => h.landTick <= tickCount).sort((a, b) => a.landTick - b.landTick || (a.cause < b.cause ? -1 : 1));
    holds = holds.filter(h => h.landTick > tickCount);
    for (const h of dueH) {
      const writes = h.writes.map(w => ({ node: w.node, value: evalWrite(w.expr, w.argEnv, w.from, w.node) ?? invent(w.node) }));
      const prevs = new Map();
      for (const w of writes) {
        if (inFlight.has(w.node.key)) {
          emit({ type: "flight", key: w.node.key, state: "abandon", at: clock });
          inFlight.delete(w.node.key);
        }
        prevs.set(w.node.key, values.has(w.node.key) ? preview(values.get(w.node.key)) : undefined);
        values.set(w.node.key, w.value);
      }
      propagateWithPrev(writes.map(w => w.node), { cause: h.cause, origin: h.origin }, prevs);
      for (const w of writes) emit({ type: "released", key: w.node.key, at: clock });
      for (const n of h.refresh) scheduleFlight(n, { cause: h.cause, origin: h.origin });
    }
    const dueF = [...inFlight.values()].filter(f => f.landTick <= tickCount).sort((a, b) => a.node.key < b.node.key ? -1 : 1);
    for (const f of dueF) landFlight(f);
  }

  function bootFlights() {
    if (booted) return;
    booted = true;
    const nodes = g.nodes.filter(n => (n.kind === "source" || n.kind === "eq") && isAsyncNode(n, g)).sort(byKeySort);
    for (const n of nodes) {
      const trial = evalNode(n, "sync");
      if (trial.flight) scheduleFlight(n, { cause: n.key, origin: `flight ${n.name}` });
    }
  }

  function act(actionKey) {
    if (disposed) return;
    clock += 1;
    const actions = g.nodes.filter(n => n.kind === "action").sort(byKeySort);
    if (!actions.length) return;
    const action = actionKey ? actions.find(a => a.key === actionKey) : actions[Math.floor(rng() * actions.length)];
    if (!action) return;
    runAction(action);
  }

  function tick(n) {
    if (disposed) return;
    const count = n == null ? 1 : n;
    for (let i = 0; i < count; i++) {
      clock += 16;
      tickCount += 1;
      if (!booted) bootFlights();
      landDue();
      if (rate > 0 && tickCount % rate === 0) act();
    }
  }

  function timeline() {
    return {
      type: "timeline",
      head,
      viewing,
      steps: steps.map(s => ({ ...s, changes: s.changes.map(c => ({ ...c })), order: s.order ? [...s.order] : undefined })),
      capacity,
    };
  }

  function travel(to) {
    if (inFlight.size || holds.length) {
      emit({ type: "travel-denied", to, reason: "pending" });
      return;
    }
    if (typeof to !== "number" || !Number.isInteger(to) || to < 1 || to > head || to <= floor) {
      emit({ type: "travel-denied", to, reason: "evicted" });
      return;
    }
    const from = viewing ?? head;
    const changes = diffMaps(valuesAt(from), valuesAt(to));
    viewing = to;
    emit({ type: "step", from, to, direction: to < from ? "back" : "forward", changes });
  }

  function resume() {
    if (viewing == null) {
      emit({ type: "resume", head, changes: [] });
      return;
    }
    const from = viewing;
    const changes = diffMaps(valuesAt(from), valuesAt(head));
    viewing = null;
    emit({ type: "resume", head, changes });
  }

  function post(msg) {
    if (disposed || !msg || typeof msg !== "object") return;
    if (msg.type === "hello") emit(timeline());
    else if (msg.type === "travel") travel(msg.to);
    else if (msg.type === "resume") resume();
    else if (msg.type === "select") selected = msg.key ?? null;
  }

  function subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  }

  function freshId(mod) {
    const ids = new Set(g.nodes.map(n => n.id));
    let i = 1;
    while (ids.has(`${mod}:sx${i}`)) i++;
    return `${mod}:sx${i}`;
  }

  function mutateGraph(next, mod, file, op) {
    const inMod = kind => next.nodes.filter(n => n.mod === mod && n.kind === kind).sort(byKeySort);
    const pick = list => list.length ? list[Math.floor(rng() * list.length)] : null;
    const lines = next.lines[file] ?? (next.lines[file] = {});
    if (op === "rename") {
      const n = pick(inMod("eq"));
      if (!n) return false;
      let name = `${n.name}Renamed`;
      let i = 2;
      while (next.nodes.some(x => x.mod === mod && x.name === name)) name = `${n.name}Renamed${i++}`;
      if (lines[n.line] != null) lines[n.line] = String(lines[n.line]).replace(new RegExp(`\\b${n.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`), name);
      const p = keyParts(n.key);
      n.name = name;
      n.key = `${p.module}|${p.scope}|${name}${p.index ? "#" + p.index : ""}`;
      if (n.base) n.base = `${p.module}|${p.scope}|${name}`;
      return true;
    }
    if (op === "expr") {
      const n = pick(inMod("eq"));
      if (!n || lines[n.line] == null) return false;
      const line = String(lines[n.line]);
      const cut = line.indexOf("//");
      const head = cut >= 0 ? line.slice(0, cut).replace(/\s*$/, "") : line.replace(/\s*$/, "");
      const tail = cut >= 0 ? " " + line.slice(cut) : "";
      lines[n.line] = `${head} + 0${tail}`;
      return true;
    }
    if (op === "type") {
      const sources = inMod("source").filter(n => parseDecl("source", n.name, declText(next, n)).type);
      const n = pick(sources.length ? sources : inMod("source"));
      if (!n || lines[n.line] == null) return false;
      const line = String(lines[n.line]);
      if (/:\s*[^=]+?(:=|=)/.test(line)) lines[n.line] = line.replace(/(\s*)(:=|=)/, " | null$1$2");
      else lines[n.line] = line.replace(/^((?:export\s+)?source\s+\w+)/, "$1: string");
      return true;
    }
    if (op === "add") {
      let name = "extra";
      let i = 2;
      while (next.nodes.some(n => n.mod === mod && n.name === name)) name = `extra${i++}`;
      const max = Math.max(0, ...Object.keys(lines).map(Number).filter(Number.isFinite));
      const line = max + 1;
      lines[line] = `source ${name}: number := 0`;
      const region = next.regions.find(r => r.mod === mod && r.parent == null)?.id ?? `${mod}:r0`;
      const key = `${file}||${name}`;
      next.nodes.push({
        id: freshId(mod), mod, file, kind: "source", name, line, region,
        io: false, question: false, async: false, key, base: key,
      });
      return true;
    }
    if (op === "remove") {
      const n = pick([...inMod("eq"), ...inMod("source")]);
      if (!n) return false;
      next.nodes = next.nodes.filter(x => x.id !== n.id);
      next.edges = next.edges.filter(e => e.from !== n.id && e.to !== n.id);
      delete lines[n.line];
      return true;
    }
    return false;
  }

  function applyPlan(plan) {
    const allow = new Set([...plan.rerun, ...plan.reset, ...plan.added]);
    for (const m of plan.moved) {
      if (values.has(m.from)) {
        values.set(m.to, values.get(m.from));
        values.delete(m.from);
      }
    }
    for (const k of plan.removed) values.delete(k);
    const changes = [];
    const touch = node => {
      if (!node || node.kind === "action" || !allow.has(node.key)) return;
      const p = preview(values.get(node.key));
      const prevShown = shown.has(node.key) ? shown.get(node.key) : undefined;
      if (prevShown === p) return;
      const c = { key: node.key, name: node.name, preview: p, origin: `hmr h${hmrN}` };
      if (prevShown !== undefined) c.prev = prevShown;
      changes.push(c);
    };
    for (const k of plan.reset) {
      const node = byKeyGet(k);
      if (!node || node.kind === "action") continue;
      values.set(node.key, initialOf(node));
      touch(node);
    }
    for (const k of plan.added) {
      const node = byKeyGet(k);
      if (!node || node.kind === "action") continue;
      const v = initialOf(node);
      values.set(node.key, v === undefined ? 0 : v);
      touch(node);
    }
    const rerun = plan.rerun.map(byKeyGet).filter(n => n && n.kind !== "action");
    for (const node of topo(rerun)) {
      const trial = evalNode(node, "land");
      const next = trial.ok ? trial.value : (values.has(node.key) ? invent(node) : zeroOf(nodeType(node, g), node.name, aliases));
      values.set(node.key, next);
      touch(node);
    }
    return changes;
  }

  function editModule(module, mutation) {
    if (disposed) return null;
    clock += 1;
    const mod = g.modules.indexOf(module);
    const id = `h${++hmrN}`;
    if (mod < 0) {
      emit({ type: "hmr", phase: "failed", id, error: `unknown module ${module}`, fallback: "none" });
      return null;
    }
    const ops = ["rename", "expr", "type", "add", "remove"];
    const asked = typeof mutation === "string" ? mutation : mutation?.op;
    const start = asked ? ops.indexOf(asked) : editCount % ops.length;
    editCount++;
    const order = start >= 0 ? [...ops.slice(start), ...ops.slice(0, start)] : ["add"];
    const next = clone(g);
    let applied = null;
    for (const op of order) {
      if (mutateGraph(next, mod, module, op)) { applied = op; break; }
    }
    if (!applied) {
      emit({ type: "hmr", phase: "failed", id, error: `could not edit ${module}`, fallback: "none" });
      return null;
    }
    const plan = planHmr(g, next);
    emit({ type: "hmr", phase: "plan", id, modules: [module], graph: next, plan });
    emit({ type: "hmr", phase: "apply", id });
    g = next;
    rebuild();
    const changes = applyPlan(plan);
    emit({ type: "hmr", phase: "done", id, changes: changes.map(c => ({ ...c })) });
    if (changes.length) commitFlush(changes, { origin: `hmr ${id}` });
    return plan;
  }

  function dispose() {
    disposed = true;
    subs.clear();
    inFlight.clear();
    holds = [];
  }


  return { post, subscribe, tick, act, editModule, dispose };
}

function isCli() {
  return typeof process !== "undefined" && !!process.argv?.[1] && /(?:^|\/)fake\.mjs$/.test(process.argv[1]);
}

if (isCli()) {
  const args = process.argv.slice(2);
  let file = null, seed = 1, steps = 20, edit = false, rate = 4;
  const usage = () => {
    console.error("usage: node tooling/rx-map/fake.mjs <graph.json> --seed 3 --steps 20 [--edit]");
    process.exit(1);
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--seed") seed = Number(args[++i]);
    else if (args[i] === "--steps") steps = Number(args[++i]);
    else if (args[i] === "--rate") rate = Number(args[++i]);
    else if (args[i] === "--edit") edit = true;
    else if (args[i] === "-h" || args[i] === "--help") usage();
    else if (!file) file = args[i];
    else usage();
  }
  if (!file) usage();
  const { readFileSync } = await import("node:fs");
  const graph = JSON.parse(readFileSync(file, "utf8"));
  const host = createFakeHost(graph, { seed, rate });
  host.subscribe(m => console.log(JSON.stringify(m)));
  host.post({ type: "hello", want: ["live", "timeline", "travel", "hmr"] });
  host.tick(steps);
  if (edit) host.editModule(graph.modules[0]);
  host.dispose();
}
