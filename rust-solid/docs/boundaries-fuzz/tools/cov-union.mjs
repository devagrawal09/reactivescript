import { readFileSync } from 'node:fs';
const [a, b, base] = process.argv.slice(2).map(f => JSON.parse(readFileSync(f)));
const per = {}, onlyA = {}, onlyB = {};let tot = 0;
for (const f of new Set([...Object.keys(a.lines), ...Object.keys(b.lines)])) {
  const la = a.lines[f] ?? [], lb = b.lines[f] ?? [], l0 = base.lines[f] ?? [];
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) { const inA = la[i] > 0, inB = lb[i] > 0, in0 = l0[i] > 0; if (in0) continue;
    if (inA || inB) { per[f] = (per[f] ?? 0) + 1; tot++ } if (inA && !inB) onlyA[f] = (onlyA[f] ?? 0) + 1; if (inB && !inA) onlyB[f] = (onlyB[f] ?? 0) + 1 }
}
console.log('union new lines', tot, per); console.log('async plan only', onlyA); console.log('boundaries fuzz only', onlyB);
const fa = Object.keys(a.fns).filter(k => a.fns[k] > 0 && !(base.fns[k] > 0)), fb = Object.keys(b.fns).filter(k => b.fns[k] > 0 && !(base.fns[k] > 0));
console.log('new functions: async', fa.length, 'boundaries', fb.length, 'union', new Set([...fa, ...fb]).size);
console.log('functions only in boundaries fuzz:', fb.filter(k => !fa.includes(k)));
console.log('functions only in async plan:', fa.filter(k => !fb.includes(k)));
