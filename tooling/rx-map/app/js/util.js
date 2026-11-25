// Small things .rx has no form for.
/** The distinct items of a list, in first-seen order (.rx has no `new Set`). */
export const unique = xs => [...new Set(xs)];
/** A lookup of ids: `{ [id]: true }`. */
export const toSet = ids => { const o = {}; for (const id of ids ?? []) o[id] = true; return o; };
