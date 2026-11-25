// A list's preview (`[{id: 1, name: "Ada"}, …4]`) reads as a count and its first items.
export function listOf(p) {
  p = String(p ?? "");
  const m = /^Array\((\d+)\)$/.exec(p);
  if (m) return { count: +m[1], exact: true, items: [] };
  if (p[0] !== "[") return null;
  const items = [];
  let depth = 0, str = null, cur = "", closed = false;
  for (let i = 1; i < p.length; i++) {
    const c = p[i];
    if (str) { cur += c; if (c === "\\") { cur += p[++i] ?? ""; } else if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === "`") { str = c; cur += c; continue; }
    if (c === "[" || c === "{" || c === "(") depth++;
    if (c === "]" || c === "}" || c === ")") { if (!depth) { closed = true; break; } depth--; }
    if (c === "," && !depth) { items.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) items.push(cur.trim());
  let more = 0, exact = closed;
  if (items.length && /^…\d+$/.test(items.at(-1))) more = +items.pop().slice(1);
  else if (!closed && items.length) { items.pop(); exact = false; }   // cut at 80 characters: the last item is partial
  return { count: items.length + more, exact, items: itemLabels(items) };
}
// a row of a list is named by its title (title, name, label, text…); failing that, by the first string field that tells
// the rows apart (not `board: "web"` on every row); failing that, its first string field
const TITLE_FIELDS = ["title", "name", "label", "text", "summary", "subject", "heading", "message", "body"];
export function itemLabels(items) {
  const fieldsOf = t => (t[0] === "{" ? new Map([...t.matchAll(/(\w+):\s*("(?:\\.|[^"\\])*"|[^,}]+)/g)].map(m => [m[1], m[2].trim()])) : null);
  const parsed = items.map(fieldsOf);
  const strFields = f => [...(f ?? [])].filter(([k, v]) => v[0] === '"' && !/^(id|key)$/.test(k)).map(([k]) => k);
  const objs = parsed.filter(Boolean);
  let pick = TITLE_FIELDS.find(k => objs.length && objs.every(f => f.get(k)?.[0] === '"'));
  if (!pick && objs.length > 1) pick = strFields(objs[0]).find(k => new Set(objs.map(f => f.get(k))).size > 1);
  return items.map((t, i) => {
    const f = parsed[i];
    if (f) { const k = (pick && f.has(pick) && pick) ?? strFields(f)[0] ?? [...f.keys()][0]; t = k ? f.get(k) : "{…}"; }
    if (t[0] === '"') t = t.slice(1, t.endsWith('"') ? -1 : undefined);
    return t.length > 14 ? `${t.slice(0, 13)}…` : t;
  });
}
export const itemLabel = t => itemLabels([t])[0];
export const plainValue = v => { const l = listOf(v); return l ? `${l.count}${l.exact ? "" : "+"} item${l.count === 1 ? "" : "s"}` : String(v ?? ""); };
export const listDetail = listOf;

export function lvView(text) {
  const l = listOf(text);
  if (!l) return { list: false, text: String(text ?? ""), count: "", items: [], more: "", empty: false };
  const items = l.items.slice(0, 2);
  return { list: true, text: "", count: `${l.count}${l.exact ? "" : "+"}`, items, more: l.count > 2 ? `+${l.count - items.length}` : "", empty: l.count === 0 };
}

// The last change at or before seq, or its first recorded change's prev (TRACE §4b). A failure comes with the value the
// app still showed then (`last`): the change's `shown` (`shown: true`: the bridge said so), else the newest value before
// it (a failed re-ask keeps its last answer; the views decide, with the boundaries, whether it still shows).
export function valueAt(steps, key, seq) {
  let before, after, last;
  for (const s of steps) for (const c of s.changes ?? []) {
    if (c?.key !== key) continue;
    if (s.seq <= seq) {
      if (typeof c.preview === "string") { before = c; last = c.full ?? c.preview; }
      else if (typeof c.error === "string") before = c;
    } else if (!after) after = c;
  }
  if (before) return typeof before.preview === "string" ? { preview: before.full ?? before.preview }
    : typeof before.shown === "string" ? { error: before.error, last: before.shown, shown: true } : { error: before.error, last, shown: false };
  if (after && typeof after.prev === "string") return { preview: after.prev };
  return null;
}
