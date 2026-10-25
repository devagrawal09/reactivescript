// 10 SV-7d: HTML nesting that the browser's parser restructures (HTML §13.2.6.4.7, "in body" and the table modes). The
// server's HTML is parsed; the client builds its DOM by inserting nodes, which nothing restructures — so a component whose
// root the parser would move, wrap or drop where it is applied serves a page that is not the tree the client builds.
// Solid's compiler refuses this within one template (shared/validate.rs, by re-parsing); across templates — a component's
// root, a branch, children placed by the component that reads them — it "assumes table partials are used in the right
// place". The checker knows the places.

/** What a component contributes where it is applied: its root elements (`#text` for text), whether it contains an element
 *  that closes an open `<p>` (outside the scopes that shield one), an `<a>`, a `<form>`; and the ancestor chains (inside it,
 *  innermost last) where it places its caller's children. */
export type Shape = { roots: string[]; closesP: boolean; a: boolean; form: boolean; childrenAt: string[][] };
export const EMPTY_SHAPE: Shape = { roots: [], closesP: false, a: false, form: false, childrenAt: [] };

const words = (s: string) => new Set(s.split(" "));
/** Start tags that close an open `<p>` in button scope. */
export const P_CLOSERS = words("address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr listing main menu nav ol p plaintext pre search section table ul xmp");
/** The elements that end "button scope" (a `<p>` above one is not closed by what is inside it). */
export const P_SCOPE = words("applet button caption html marquee object table td template th");
const SPECIAL = words("address applet area article aside base basefont bgsound blockquote body br button caption center col colgroup dd details dir div dl dt embed fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html iframe img input keygen li link listing main marquee menu meta nav noembed noframes noscript object ol p param plaintext pre script search section select source style summary table tbody td template textarea tfoot th thead title tr track ul wbr xmp");
const TABLE: Record<string, Set<string>> = {
  table: words("caption colgroup thead tbody tfoot script template style"),
  thead: words("tr script template style"), tbody: words("tr script template style"), tfoot: words("tr script template style"),
  tr: words("td th script template style"),
  colgroup: words("col template"),
};
const TABLE_PARTS = words("caption colgroup col thead tbody tfoot tr td th");
const HEADING = /^h[1-6]$/;

/** What the parser does with `t` (a tag, or `#text`) as the next child where `anc` are open (innermost last); null: it is
 *  placed there. An empty `anc` is an unknown place (a view's root): nothing is said. */
export function misnested(anc: string[], t: string): string | null {
  if (!anc.length) return null;
  const P = anc[anc.length - 1];
  if (P === "template") return null;
  const allowed = TABLE[P];
  if (allowed) {
    if (t === "#text") return `moves the text out of the <${P}> (foster parenting)`;
    if (allowed.has(t)) return null;
    if (P === "table" && (t === "tr" || t === "td" || t === "th")) return `wraps it in a <tbody>${t === "tr" ? "" : " and a <tr>"} the client does not build`;
    if (P === "table" && t === "col") return "wraps it in a <colgroup> the client does not build";
    if ((P === "thead" || P === "tbody" || P === "tfoot") && (t === "td" || t === "th")) return "wraps it in a <tr> the client does not build";
    return `moves it out of the <${P}> (foster parenting)`;
  }
  if (t === "#text") return null;
  if (TABLE_PARTS.has(t)) return `drops the <${t}> tag outside a table (its content stays, unwrapped)`;
  if (P_CLOSERS.has(t)) for (let i = anc.length - 1; i >= 0; i--) { if (anc[i] === "p") return "closes the open <p> before it"; if (P_SCOPE.has(anc[i])) break; }
  if (t === "a") for (let i = anc.length - 1; i >= 0; i--) { if (anc[i] === "a") return "closes the open <a> (links do not nest)"; if (words("td th caption template object marquee applet").has(anc[i])) break; }
  if (t === "form" && anc.includes("form")) return "ignores a <form> inside a <form>";
  if (t === "button") for (let i = anc.length - 1; i >= 0; i--) { if (anc[i] === "button") return "closes the open <button>"; if (P_SCOPE.has(anc[i]) && anc[i] !== "button") break; }
  if (HEADING.test(t) && HEADING.test(P)) return `closes the open <${P}>`;
  if (t === "li" || t === "dd" || t === "dt") {
    const same = t === "li" ? (x: string) => x === "li" : (x: string) => x === "dd" || x === "dt";
    for (let i = anc.length - 1; i >= 0; i--) { if (same(anc[i])) return `closes the open <${anc[i]}>`; if (SPECIAL.has(anc[i]) && anc[i] !== "address" && anc[i] !== "div" && anc[i] !== "p") break; }
  }
  if (t === "option" && P === "option") return "closes the open <option>";
  return null;
}
/** A component's `closesP`, `a`, `form` against the places above its application. */
export function misnestedInside(anc: string[], s: Shape): string | null {
  if (s.closesP) for (let i = anc.length - 1; i >= 0; i--) { if (anc[i] === "p") return "contains a block that closes the open <p>"; if (P_SCOPE.has(anc[i])) break; }
  if (s.a && anc.includes("a")) return "contains an <a>, and links do not nest";
  if (s.form && anc.includes("form")) return "contains a <form>, and forms do not nest";
  return null;
}
