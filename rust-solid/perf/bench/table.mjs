// Merges run.mjs result files into one table: node table.mjs label=FILE.jsonl …  (prints Markdown)
import {readFileSync} from 'node:fs';
const cols = process.argv.slice(2).map(a => { const [label, file] = a.split('='); return {label, rows: readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l))}; });
const names = [...new Set(cols.flatMap(c => c.rows.map(r => r.name)))].sort();
const fmt = n => n == null ? '' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n * 10) / 10);
const head = ['workload'];
for (const c of cols) head.push(`${c.label} Ir`, `${c.label} µs`);
if (cols.some(c => c.rows.some(r => r.runtime === 'solid-js'))) head.push('Solid JS µs');
console.log('| ' + head.join(' | ') + ' |'); console.log('|' + head.map((_, i) => i ? '---:' : '---').join('|') + '|');
for (const n of names) {
  const row = [n];
  let js = null;
  for (const c of cols) {
    const ir = c.rows.find(r => r.name === n && r.kind === 'ir'), w = c.rows.find(r => r.name === n && r.kind === 'wall' && r.runtime !== 'solid-js');
    js ??= c.rows.find(r => r.name === n && r.runtime === 'solid-js');
    row.push(ir?.error ? 'error' : fmt(ir?.ir), fmt(w?.med));
  }
  if (head.at(-1) === 'Solid JS µs') row.push(fmt(js?.med));
  console.log('| ' + row.join(' | ') + ' |');
}
