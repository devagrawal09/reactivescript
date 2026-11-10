// Usage: node cov-lines.mjs A.json BASE.json [FILE_FILTER]: the lines A reaches and BASE does not, with source.
import { readFileSync } from 'node:fs';
const [a, b, file] = process.argv.slice(2);
const A = JSON.parse(readFileSync(a)), B = JSON.parse(readFileSync(b));
const P = new URL('../../../../solid-next/packages/', import.meta.url).pathname;
for (const [f, la] of Object.entries(A.lines)) {
  if (file && !f.includes(file)) continue;
  const lb = B.lines[f] ?? []; const src = readFileSync(P + f, 'utf8').split('\n');
  const out = []; for (let i = 0; i < la.length; i++) if (la[i] > 0 && !(lb[i] > 0)) out.push((i + 1) + ' [' + la[i] + '] ' + src[i]);
  if (out.length) console.log('== ' + f + '\n' + out.join('\n'));
}
