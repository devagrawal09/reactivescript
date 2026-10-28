// Compares the arms over one or more scored run directories (each with the results.json score.mjs wrote): defects
// shipped per arm, and Fisher's exact test (two-sided) on that 2×2 table.
// Usage: node harness/compare.mjs <runs-dir>...   or, for a table alone: node harness/compare.mjs --table a n b m
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const lf = n => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
const hyper = (a, b, c, d) => Math.exp(lf(a + b) + lf(c + d) + lf(a + c) + lf(b + d) - lf(a) - lf(b) - lf(c) - lf(d) - lf(a + b + c + d));

/** two-sided Fisher's exact p for [[a, b], [c, d]]: the sum over tables with the same margins no likelier than this one */
export function fisher(a, b, c, d) {
  const p0 = hyper(a, b, c, d), r1 = a + b, c1 = a + c, n = a + b + c + d;
  let p = 0;
  for (let x = Math.max(0, c1 - (n - r1)); x <= Math.min(r1, c1); x++) {
    const q = hyper(x, r1 - x, c1 - x, n - r1 - c1 + x);
    if (q <= p0 * (1 + 1e-7)) p += q;
  }
  return Math.min(1, p);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === "--table") {
    const [a, n, b, m] = args.slice(1).map(Number);
    console.log(`react ${a}/${n}  rx ${b}/${m}  p = ${fisher(a, n - a, b, m - b).toFixed(4)}`);
  } else {
    const rows = args.flatMap(d => JSON.parse(readFileSync(path.join(path.resolve(d), "results.json"), "utf8")).map(r => ({ ...r, set: path.basename(d) })));
    const count = (arm, f = () => true) => { const rs = rows.filter(r => r.arm === arm && f(r)); return [rs.filter(r => r.shippedDefect).length, rs.length]; };
    const line = (label, f) => {
      const [a, n] = count("react", f), [b, m] = count("rx", f);
      console.log(`${label.padEnd(20)} react ${a}/${n}  rx ${b}/${m}  p = ${n && m ? fisher(a, n - a, b, m - b).toFixed(4) : "-"}`);
    };
    line("all");
    for (const s of new Set(rows.map(r => r.set))) line(s, r => r.set === s);
    for (const t of new Set(rows.map(r => r.task))) line(t, r => r.task === t);
  }
}
