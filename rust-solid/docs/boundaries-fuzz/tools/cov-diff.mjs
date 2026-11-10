import { readFileSync } from 'node:fs';
const [a, b] = process.argv.slice(2).map(f => JSON.parse(readFileSync(f)));
const newFns = Object.entries(a.fns).filter(([k, n]) => n > 0 && !(b.fns[k] > 0));
console.log('functions reached only in A:', newFns.length);
const byFile = {};
for (const [k, n] of newFns) { const [f, r] = k.split('|'); (byFile[f] ??= []).push(r + ' x' + n); }
for (const [f, l] of Object.entries(byFile)) console.log(f + '\n  ' + l.join('\n  '));
let tot = 0; const per = {};
for (const [f, la] of Object.entries(a.lines)) { const lb = b.lines[f] ?? []; let c = 0; for (let i = 0; i < la.length; i++) if (la[i] > 0 && !(lb[i] > 0)) c++; if (c) per[f] = c; tot += c; }
console.log('lines reached only in A:', tot); console.log(per);
