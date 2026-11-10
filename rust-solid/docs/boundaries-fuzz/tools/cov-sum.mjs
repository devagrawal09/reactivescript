// Usage: node cov-sum.mjs COVERAGE_DIR OUT.json
// Sums a NODE_V8_COVERAGE dir over Solid's prod dist files (signals, solid, universal, web):
// per-line counts (innermost range at the line's first non-blank char), per-file. Writes JSON.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const [inDir, outFile] = process.argv.slice(2);
const keep = u => /solid-next\/packages\/(signals|solid|universal|web)\/dist\//.test(u);
const srcs = new Map(), lines = new Map(), fns = new Map();
const src = url => { let s = srcs.get(url); if (!s) { const t = readFileSync(new URL(url), 'utf8'); const ls = t.split('\n'), starts = [], first = []; let off = 0; for (const l of ls) { starts.push(off); const m = l.search(/\S/); first.push(m < 0 ? -1 : off + m); off += l.length + 1 } srcs.set(url, s = { len: t.length, ls, starts, first }) } return s };
const lineOf = (s, o) => { let lo = 0, hi = s.starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s.starts[m] <= o) lo = m; else hi = m - 1 } return lo + 1 };
for (const f of readdirSync(inDir)) {
  const j = JSON.parse(readFileSync(inDir + '/' + f));
  for (const sc of j.result) {
    if (!keep(sc.url)) continue; const s = src(sc.url);
    const rs = []; for (const fn of sc.functions) { for (const r of fn.ranges) rs.push(r); const r0 = fn.ranges[0]; if (r0.startOffset > 0) { const k = sc.url.split('/packages/')[1] + '|' + lineOf(s, r0.startOffset) + ' ' + (fn.functionName || '(anon)'); fns.set(k, (fns.get(k) ?? 0) + r0.count) } }
    rs.sort((x, y) => (y.endOffset - y.startOffset) - (x.endOffset - x.startOffset));
    const counts = new Float64Array(s.len).fill(-1); for (const r of rs) counts.fill(r.count, r.startOffset, r.endOffset);
    let acc = lines.get(sc.url); if (!acc) lines.set(sc.url, acc = new Float64Array(s.ls.length).fill(-1));
    for (let i = 0; i < s.ls.length; i++) { const p = s.first[i]; if (p < 0) continue; const c = counts[p]; if (c < 0) continue; acc[i] = (acc[i] < 0 ? 0 : acc[i]) + c }
  }
}
const out = { lines: {}, fns: Object.fromEntries(fns) }; for (const [u, a] of lines) out.lines[u.split('/packages/')[1]] = Array.from(a);
writeFileSync(outFile, JSON.stringify(out)); console.log(Object.keys(out.lines).length, 'scripts ->', outFile);
