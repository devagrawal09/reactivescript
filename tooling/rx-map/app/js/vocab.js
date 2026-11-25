// The map's vocabulary: roles, families, shapes, icons, edge styles. Plain data, shared by the RX views (through
// vocab.d.rx) and the other JS modules. Ported from map.html as is.

export const KIND = {
  source:  { k: "source", label: "source", what: "State. Only a source is written, with :=" },
  asource: { k: "source", label: "source that awaits", what: "A source with a standing question (source x = await …): re-asks until written; can be pending" },
  eq:      { k: "eq", label: "equation", what: "x = e: always true, recomputes when what it reads changes" },
  aeq:     { k: "eq", label: "async equation", what: "An equation over an await: a question, can be pending and can fail" },
  action:  { k: "action", label: "action", what: "One change across its awaits; its writes are held until it returns" },
  fn:      { k: "fn", label: "function", what: "A plain function: lifted, or instantiated where it declares nodes" },
  server:  { k: "server fn", label: "server function", what: "Runs on the server; the call site decides query vs mutation" },
  context: { k: "context", label: "context", what: "Declared, provided above, used below; read-only" },
  errclass:{ k: "error", label: "error class", what: "A declared failure class (R-f-1); crosses the wire" },
  comp:    { k: "component", label: "component", what: "A region that owns everything declared in it" },
  props:   { k: "props", label: "props", what: "A component's inputs: one live structured equation" },
  import:  { k: "js", label: "JS import", what: "Outside the program: a JS module, trusted through pure / fails / .d.rx" },
  reader:  { k: "view", label: "view read", what: "A markup position that reads reactive values" },
  handler: { k: "on", label: "handler", what: "Imperative scope: every read is a snapshot, writes are legal" },
  prop:    { k: "prop", label: "prop passed", what: "A value handed to a child component" },
  effect:  { k: "effect", label: "effect", what: "Compute half tracked, apply half runs after the instant settles" },
  apply:   { k: "apply", label: "effect apply", what: "" },
  provide: { k: "provide", label: "provide", what: "Provides a context to the regions below" },
};
// role → family (colour), shape and icon. No role is written on a token: it is its shape, fill and icon
export const FAM = { source: "state", asource: "state", eq: "derived", aeq: "derived", props: "derived", reader: "derived", action: "imperative", handler: "imperative", effect: "imperative", apply: "imperative",
  import: "outside", server: "outside", fn: "outside", comp: "structure", context: "structure", prop: "structure", provide: "structure", errclass: "failure" };
export const FAM_HEX = { state: "#5b8cff", derived: "#2dd4bf", imperative: "#fb923c", outside: "#94a3b8", structure: "#b48cf8", failure: "#fb7185" };
export const SHAPE = { source: "well", asource: "well", eq: "flow", aeq: "flow", props: "flow", reader: "flow", action: "act", handler: "act", effect: "ring", apply: "ring",
  import: "plug", server: "plug", fn: "plug", comp: "frm", context: "frm", prop: "frm", provide: "frm", errclass: "fail" };
export const ICON_OF = { source: "well", asource: "well", eq: "f", aeq: "f", props: "props", reader: "eye", action: "bolt", handler: "tap", effect: "diamond", apply: "diamond",
  import: "plug", server: "plug", fn: "fn", comp: "comp", context: "ctx", prop: "prop", provide: "ctx", errclass: "warn" };
const svgI = (body, fill) => `<svg class="i" viewBox="0 0 16 16" aria-hidden="true"${fill ? ` style="fill:currentColor;stroke:none"` : ""}>${body}</svg>`;
export const ICON = {
  well: svgI(`<circle cx="8" cy="8" r="6" opacity=".35"/><circle cx="8" cy="8" r="3.4"/><circle cx="6.9" cy="6.8" r="1" fill="#fff" opacity=".7"/>`, true),
  f: svgI(`<path d="M11.2 3.1c-1.7-.7-3.2.1-3.5 1.9l-1.4 7c-.3 1.7-1.7 2.3-3.1 1.6M4.8 6.6h5.6"/>`),
  props: svgI(`<path d="M2.5 5h11M2.5 11h11"/><circle cx="6" cy="5" r="1.7" fill="currentColor"/><circle cx="10" cy="11" r="1.7" fill="currentColor"/>`),
  eye: svgI(`<path d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8s-2.4 4.2-6.5 4.2S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.9" fill="currentColor"/>`),
  bolt: svgI(`<path d="M9.4 1.2 3.3 9.1h4.2l-1 5.7 6.2-8H8.5z"/>`, true),
  tap: svgI(`<path d="M4.2 2.4 12.3 7.6 8.7 8.4l2.1 4-1.7.9-2.1-4-2.6 2.6z"/>`, true),
  diamond: svgI(`<path d="M8 2.3 13.7 8 8 13.7 2.3 8z"/><path d="M8 5.6 10.4 8 8 10.4 5.6 8z" fill="currentColor"/>`),
  plug: svgI(`<path d="M6 1.8v3.4M10 1.8v3.4M4.3 5.2h7.4V8a3.7 3.7 0 0 1-7.4 0zM8 11.7v2.6"/>`),
  fn: svgI(`<path d="M5.4 2.6C3.6 4.6 3.6 11.4 5.4 13.4M10.6 2.6c1.8 2 1.8 8.8 0 10.8"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/>`),
  comp: svgI(`<path d="M5.4 4.4 2.3 8l3.1 3.6M10.6 4.4 13.7 8l-3.1 3.6M9.1 3.2 6.9 12.8"/>`),
  ctx: svgI(`<circle cx="8" cy="8" r="1.7" fill="currentColor"/><path d="M5.1 5.1a4.1 4.1 0 0 0 0 5.8M10.9 5.1a4.1 4.1 0 0 1 0 5.8M3 3a7 7 0 0 0 0 10M13 3a7 7 0 0 1 0 10"/>`),
  prop: svgI(`<path d="M2.3 8h8.2M7.6 4.9 10.7 8l-3.1 3.1M13.4 3.2v9.6"/>`),
  io: svgI(`<path d="M4.5 11.5 11.5 4.5M6 4.5h5.5V10"/>`),
  arrow: svgI(`<path d="M2.5 8h10M9.5 4.5 13 8l-3.5 3.5"/>`),
  branch: svgI(`<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="5.5" r="1.5"/><path d="M4.5 5v6M11.5 7c0 3-7 2.5-7 4"/>`),
  rows: svgI(`<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>`),
  hour: svgI(`<path d="M4.5 2h7M4.5 14h7M5.5 2c0 3.2 5 3.8 5 6s-5 2.8-5 6M10.5 2c0 3.2-5 3.8-5 6s5 2.8 5 6"/><path d="M6.6 12.6h2.8L8 10.8z" fill="currentColor"/>`),
  warn: svgI(`<path d="M8 2.1 14.4 13.4H1.6z"/><path d="M8 6.3v3.3M8 11.4v.2"/>`),
  lock: svgI(`<rect x="3.3" y="7" width="9.4" height="6.8" rx="1.6" fill="currentColor"/><path d="M5.4 7V5.1a2.6 2.6 0 0 1 5.2 0V7"/>`),
  reset: svgI(`<path d="M3.2 8a4.8 4.8 0 1 0 1.6-3.6M3 2.6v2.6h2.6"/>`),
  rerun: svgI(`<path d="M12.8 8a4.8 4.8 0 1 1-1.6-3.6M13 2.6v2.6h-2.6"/>`),
  plus: svgI(`<path d="M8 3v10M3 8h10"/>`),
  minus: svgI(`<path d="M3 8h10"/>`),
  popout: svgI(`<path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/>`),
  chev: svgI(`<path d="M4.5 6.5 8 10l3.5-3.5"/>`),
  map: svgI(`<path d="M2 4l4-1.5 4 1.5 4-1.5v9.5L10 13.5 6 12 2 13.5z"/><path d="M6 2.5V12M10 4v9.5"/>`),
  edges: svgI(`<circle cx="3.5" cy="12.5" r="1.5"/><circle cx="12.5" cy="3.5" r="1.5"/><path d="M4.6 11.4C6 6 9 9 11.4 4.6"/>`),
  move: svgI(`<path d="M2.5 8h10M9.5 4.5 13 8l-3.5 3.5"/>`),
  frame: svgI(`<path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3"/><rect x="5.5" y="5.5" width="5" height="5" rx="1"/>`),
  soundOn: svgI(`<path d="M2.5 6h2.4L8.5 3v10L4.9 10H2.5z" fill="currentColor"/><path d="M10.8 5.6a3.4 3.4 0 0 1 0 4.8M12.6 3.8a6 6 0 0 1 0 8.4"/>`),
  soundOff: svgI(`<path d="M2.5 6h2.4L8.5 3v10L4.9 10H2.5z" fill="currentColor"/><path d="M11 6l3.5 4M14.5 6 11 10"/>`),
};
/** An icon's markup by name (for `innerHTML` in a view); the plug for an unknown one. */
export const icon = name => ICON[name] ?? ICON.plug;
/** The icon of a role (kindOf). */
export const roleIcon = kk => ICON[ICON_OF[kk]] ?? ICON.plug;

export const FRAME = { component: "component", for: "for each", then: "if · then", else: "else", loading: "loading", errored: "errored", children: "renders", imported: "renders (imported)" };
export const EDGE = {
  // reads: derived teal; the dash says how
  "read:tracked":  { c: "#2dd4bf", d: "",        w: 1.7, label: "tracked read — points at what it reads; re-runs when that changes" },
  "read:snapshot": { c: "#2dd4bf", d: "5 4",     w: 1.2, label: "snapshot read — value now, never re-runs" },
  "read:pre":      { c: "#2dd4bf", d: "1 4",     w: 1.6, label: "pre — the value before its last change" },
  "read:probe":    { c: "#fbbf24", d: "6 3 1 3", w: 1.5, label: "probe — latest / pending?, reads ahead, never holds" },
  // writes: imperative orange
  "write:write":   { c: "#fb923c", d: "",        w: 1.9, label: "write :=" },
  "write:optimistic": { c: "#fb923c", d: "7 4",  w: 1.9, label: "guess — shown now, confirmed or reverted by the answer" },
  "write:refresh": { c: "#fb923c", d: "7 3 1 3", w: 1.7, label: "refresh — re-asks the question" },
  "write:affects": { c: "#fb923c", d: "1 4",     w: 1.9, label: "affects — marks it pending? for the action" },
  // structure violet
  "write:provide": { c: "#b48cf8", d: "",        w: 1.5, label: "provides a context" },
  "passes":        { c: "#b48cf8", d: "4 3",     w: 1.4, label: "passes a prop" },
  "renders":       { c: "#b48cf8", d: "",        w: 1.1, label: "renders a component" },
  // boundaries: the pending and failure accents
  "notifies:loading": { c: "#fbbf24", d: "2 4", w: 1.8, label: "can make a loading boundary show its fallback: pending, read below it" },
  "notifies:errored": { c: "#fb7185", d: "2 4", w: 1.8, label: "can make an errored boundary show its fallback: an await below it can reject" },
  // outside slate
  "call":          { c: "#94a3b8", d: "",        w: 1.1, label: "calls" },
};
export const edgeStyle = e => e.type === "notifies" ? EDGE[`notifies:${e.boundary}`] : e.type === "read" ? EDGE[e.probe ? "read:probe" : `read:${e.mode}`] : e.type === "write" ? (EDGE[`write:${e.op}`] ?? EDGE["write:write"]) : EDGE[e.type];
export const edgeKey = e => e.type === "notifies" ? `notifies:${e.boundary}` : e.type === "read" ? (e.probe ? "read:probe" : `read:${e.mode}`) : e.type === "write" ? (EDGE[`write:${e.op}`] ? `write:${e.op}` : "write:write") : e.type;
export const CTL = { then: "if", else: "else", for: "for", loading: "loading", errored: "errored" };
export const CTAG = { then: ["branch", "branch"], else: ["branch", "branch"], for: ["rows", "rows"], loading: ["hour", "loading"], errored: ["warn", "errored"] };
/** A control-flow tag's leading word, with its icon (markup). */
export const ctagHTML = kind => (CTAG[kind] ? `<span class="cw">${ICON[CTAG[kind][0]]}${CTAG[kind][1]}</span>` : "");
export const STATUS = { added: "+", removed: "−", changed: "Δ" };
export const ORDER = ["props", "context", "source", "asource", "eq", "aeq", "action", "fn", "server", "errclass", "comp", "import"];
export const kindOf = n => n.kind === "source" && n.question ? "asource" : n.kind === "eq" && n.async ? "aeq" : n.kind;
export const famOf = n => FAM[kindOf(n)] ?? "outside";
export const famHex = n => FAM_HEX[famOf(n)];
export const CTL_WHAT = {
  then: "A branch: everything inside is created when the condition becomes true and disposed when it stops.",
  else: "The other branch of the if above it.",
  for: "One row per item, matched by identity: each row is created and disposed with its item (RG-2).",
  loading: "A boundary: shows its fallback while a reader inside is pending (H-5). <code>on(k)</code> re-arms it when <code>k</code> changes (H-6); otherwise it shows the old content while new data loads.",
  errored: "A boundary: shows its fallback when a reader inside fails (R-f-5). A typed <code>fallback(e: C)</code> catches only that class.",
};
export const NOUN = { source: "source", eq: "equation", action: "action", fn: "function", server: "server function", import: "JS import" };
export const SAMPLE = { source: "count", asource: "user", eq: "total", aeq: "results", props: "props", reader: "{ total }", action: "save", handler: "onClick", effect: "effect", apply: "apply",
  import: "fetchUser", server: "loadUser", fn: "format", comp: "Card", context: "Theme", prop: "title", provide: "Theme", errclass: "NotFound" };
export const PLAN_GROUPS = [["kept", "Kept", "lock", "its state carries over as is"], ["reset", "Reset", "reset", "re-initialised"], ["rerun", "Re-run", "rerun", "recomputed, no state of its own"],
  ["added", "Added", "plus", "new in the new graph"], ["removed", "Removed", "minus", "gone from the new graph"]];
export const keyName = k => String(k).split("|").pop();
