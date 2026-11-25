// RX keywords from tooling/tree-sitter-rx, coloured by the role they declare.
const KW = new Map();
const kw = (cls, words) => words.split(" ").forEach(w => KW.set(w, cls));
kw("state", "source");
kw("imper", "action effect on guess refresh affects draft optimistic");
kw("pend", "await loading latest pending? pre peek");
kw("fail", "errored fails rejects error throw fallback catch try finally");
kw("struct", "component context provide use portal key children");
kw("out", "import from export server client declare fn function pure");
kw("if", "if else match switch case");
kw("for", "for in of while");
kw("kw", "return const let var type interface new typeof keyof as async true false null undefined log with to instantiates break continue default extends implements this");
const TOK = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?)|(\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b)|(pending\?|[A-Za-z_$][\w$]*)|(:=|=>|===|!==|==|!=|<=|>=|&&|\|\||\?\?|\.\.\.|->|[-+*\/%=<>!?:.,;{}()[\]|&^~@#])|([\s\S])/g;

export function hl(src) {
  let s = "", prev = "";
  for (const m of String(src ?? "").matchAll(TOK)) {
    const [t, com, str, num, id, op] = m;
    if (com) s += tk("com", t);
    else if (str) s += tk("str", t);
    else if (num) s += tk("num", t);
    else if (id) { const k = KW.get(id); s += k ? tk(k, t) : prev === "<" || prev === "</" ? tk("tag", t) : /^[A-Z]/.test(id) ? tk("type", t) : esc(t); }
    else if (op) s += t === ":=" ? tk("wr", t) : tk("op", t);
    else s += esc(t);
    if (!/^\s+$/.test(t)) prev = t;
  }
  return s;
}
const tk = (c, t) => `<span class="tk tk-${c}">${esc(t)}</span>`;
export function esc(t) { return String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }
// `code` in prose is RX: highlight it too.
export function md(t) { return String(t).split("`").map((p, i) => (i % 2 ? `<code class="code">${hl(p)}</code>` : esc(p))).join(""); }
