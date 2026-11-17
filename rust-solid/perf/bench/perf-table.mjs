// The PERF.md table from results/all.jsonl: instructions per op at each version, now's wall clock, Solid JS and Exact.
//   node perf-table.mjs results/all.jsonl GROUPS.json   (GROUPS: {"area": ["workload", …], …}; prints Markdown)
import {readFileSync} from 'node:fs';
const [file, groupsFile] = process.argv.slice(2);
const rows = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const get = (name, runtime, version, kind) => rows.find(r => r.name === name && r.runtime === runtime && (version == null || r.version === version) && r.kind === kind)?.value;
const fmt = n => n == null ? '' : n >= 1e9 ? (n / 1e9).toFixed(2) + 'G' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(0) + 'k' : n >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10);
const us = n => n == null ? '' : n >= 1e4 ? (n / 1e3).toFixed(1) + ' ms' : n >= 100 ? Math.round(n) + ' µs' : (Math.round(n * 10) / 10) + ' µs';
const pct = (a, b) => a == null || b == null ? '' : `${b <= a ? '−' : '+'}${Math.abs(Math.round((b / a - 1) * 100))}%`;
const groups = JSON.parse(readFileSync(groupsFile, 'utf8'));
for (const [area, names] of Object.entries(groups)) {
  console.log(`\n### ${area}\n`);
  console.log('| workload | base Ir | v1 Ir | v2 Ir | now Ir | now vs base | now wall | Solid JS wall | Exact wall | Exact Ir |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const n of names) {
    const b = get(n, 'rust-solid', 'base', 'ir'), v4 = get(n, 'rust-solid', 'v4', 'ir');
    console.log(`| ${n} | ${fmt(b)} | ${fmt(get(n, 'rust-solid', 'v1', 'ir'))} | ${fmt(get(n, 'rust-solid', 'v2', 'ir'))} | ${fmt(v4)} | ${pct(b, v4)} | ${us(get(n, 'rust-solid', 'v4', 'wall'))} | ${us(get(n, 'solid-js', null, 'wall'))} | ${us(get(n, 'exact', null, 'wall'))} | ${fmt(get(n, 'exact', null, 'ir'))} |`);
  }
}
