// What the side panel needs from the vocabulary and the DOM that RX has no form for: lookups into vocab.js's tables
// (by role or edge key), an edge's words, a name's diff facts as markup, and the panel's event reading. Ported from
// map.html (describeEdge, diffFacts, bindPanel).
import { KIND, FAM, FAM_HEX, SHAPE, EDGE, STATUS, NOUN, CTL_WHAT, ICON, SAMPLE } from "./vocab.js";
import { esc } from "./hl.js";

/** A role's words: { label, what } (the role itself when it is not in the vocabulary). */
export const kindMeta = kk => KIND[kk] ?? { k: kk, label: kk, what: "" };
/** A role's family name and colour. */
export const famName = kk => FAM[kk] ?? "outside";
export const famColor = kk => FAM_HEX[FAM[kk] ?? "outside"];
/** A role's token shape. */
export const shapeOf = kk => SHAPE[kk] ?? "plug";
/** A role's sample name in the legend, and its shape in words. */
export const sampleName = kk => SAMPLE[kk] ?? kk;
const SHAPE_WORD = { well: "a filled well", flow: "outlined, a function sign", act: "a chevron with a bolt", ring: "a hollow ring", plug: "slate, a plug", frm: "a violet frame", fail: "rose, a warning sign" };
export const shapeWord = kk => SHAPE_WORD[SHAPE[kk]] ?? "";
/** A count by key in a counts object (0 when absent). */
export const countOf = (counts, k) => counts?.[k] ?? 0;
/** Every edge style the legend lists, in order: { k, c, d, w, label }. */
export const edgeStyles = () => Object.entries(EDGE).map(([k, s]) => ({ k, ...s }));
/** What a control region is (markup: it has `<code>`). */
export const ctlWhat = kind => CTL_WHAT[kind] ?? "";

/** The words on an edge in a name's panel: the mode of a read, the op of a write, … */
export function edgeWhat(e) {
  return e.type === "read" ? (e.probe ? (e.probe === "pending" ? "pending?" : e.probe) : e.mode) + (e.field ? ` .${e.field}` : "")
    : e.type === "write" ? ({ write: ":=", optimistic: "guess", refresh: "refresh", affects: "affects", provide: "provide" }[e.op] ?? e.op) + (e.path ? " (path)" : "")
    : e.type === "passes" ? `prop ${e.field ?? ""}` : e.type === "notifies" ? (e.boundary === "loading" ? "pending" : "can fail") : e.type;
}
/** An edge's diff tag, or null when it is the same: { text, color }. */
export function edgeChange(e) {
  if (!e.status || e.status === "same") return null;
  return { color: { added: "var(--d-add)", removed: "var(--d-del)", changed: "var(--d-chg)" }[e.status],
    text: `${STATUS[e.status]}${e.status === "changed" ? ` was ${e.was.probe ?? e.was.mode ?? e.was.op}` : ""}` };
}

/** What changed about a name in a diff, as hint lines: { cls, color, html }. */
export function diffFacts(G, n) {
  const GA = `<span class="gi ga">${ICON.arrow}</span>`;
  if (!G.diff || !n.status || n.status === "same") return n.edited ? [{ cls: "hint was", color: "", html: "line edited, same meaning to the checker" }] : [];
  if (n.status === "added") return [{ cls: "hint", color: "var(--d-add)", html: `+ new in ${esc(G.diff.after)}` }];
  if (n.status === "removed") return [{ cls: "hint", color: "var(--d-del)", html: `− gone in ${esc(G.diff.after)} (was L${n.before.line} in ${esc(G.diff.before)})` }];
  const bits = [];
  const w = n.was ?? {};
  if ("kind" in w) bits.push(`was ${NOUN[w.kind] ?? w.kind}, now ${NOUN[n.kind] ?? n.kind}`);
  if ("async" in w) bits.push(n.async ? "became async: can be pending now" : "no longer async");
  if ("io" in w) bits.push(n.io ? "now touches the world (io)" : "no longer touches the world");
  if ("question" in w) bits.push(n.question ? "now re-asks a question" : "no longer re-asks");
  if ("flavor" in w) bits.push(`${w.flavor || "plain"} ${GA} ${n.flavor || "plain"}`);
  return bits.map(b => ({ cls: "hint was", color: "", html: `Δ ${b}` }));
}

/** The Guide's four-line sample (here: a .rx string literal drops its escapes, so it can't hold the line breaks). */
export const guideCode = () => `source count := 0                    // a well: state\ntotal = count * 2                    // always true\nresults = await search(query)        // can be pending\naction save() { count := count + 1 } // one change`;

// ---- events ------------------------------------------------------------------------------------------------------
/** A data attribute of the closest element matching `sel` to an event's target, "" when none. */
export const closestData = (ev, sel, name) => ev?.target?.closest?.(sel)?.dataset?.[name] ?? "";
export const eventKey = ev => ev?.key ?? "";
export function prevent(ev) { ev?.preventDefault?.(); }
/** Scroll the panel back to the top (a new tab or a new name). */
export function panelTop() { const p = document.getElementById("panel"); if (p) p.scrollTop = 0; }

