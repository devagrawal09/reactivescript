// 07 §6b CSS-5: a class map — what TSRX's style expression evaluates to — for the interpreter and the oracle, which do not
// compile CSS. The compiled runner and the type projection use TSRX's engine itself (@solidjs/compiler); this follows it for
// the stylesheets the scenarios write: a top-level rule whose every selector is one class (`.a`, `.a, .b`) puts those classes
// in the map, sorted; nothing else does. The scope class is a stand-in (frames never show it; the compiled runner checks
// the real stylesheet).

/** The standalone classes of a stylesheet's top-level rules, sorted (TSRX's `build_style_class_map`). */
export function mapClasses(css: string): string[] {
  const out = new Set<string>();
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0, start = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "{") { if (depth === 0) { const sel = src.slice(start, i).trim(); const parts = sel.split(",").map(s => s.trim()); if (parts.length && parts.every(p => /^\.[A-Za-z_-][\w-]*$/.test(p))) parts.forEach(p => out.add(p.slice(1))); } depth++; }
    else if (src[i] === "}") { depth--; if (depth === 0) start = i + 1; }
  }
  return [...out].sort();
}

/** The class map's value: each class, with the stylesheet's scope class first ("tsrx-xxxxxxxx cls"). */
export function classMap(css: string): Record<string, string> {
  let h = 2166136261; for (const ch of css) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const hash = `tsrx-${h.toString(16).padStart(8, "0").slice(0, 8)}`;
  return Object.freeze(Object.fromEntries(mapClasses(css).map(c => [c, `${hash} ${c}`])));
}
