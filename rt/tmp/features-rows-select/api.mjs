let id = 0;
export const buildRows = n => Array.from({ length: n }, () => ({ id: ++id, label: "row " + id, n: id }));
export const swapRows = rs => { const a = Array.from(rs); if (a.length > 3) { const t = a[1]; a[1] = a[a.length - 2]; a[a.length - 2] = t; } return a; };
export const buildDeep = n => Array.from({ length: n }, (_, i) => ({ id: i, a: { b: { c: "c" + i } } }));
export const save = t => new Promise(r => setTimeout(() => r(t), 100));
export const loadRows = p => new Promise(r => setTimeout(() => r(buildRows(10)), 100));
