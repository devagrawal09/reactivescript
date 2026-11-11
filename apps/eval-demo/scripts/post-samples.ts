// Posts samples/* to a running demo, one at a time: `npm run post -- [name-substring …] [--url URL] [--delay ms]`.
// A sample's options come from its file name: `.tsx` is TSX syntax; `name.string.rx` is a value eval of that type.
import { readdirSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => { const i = args.indexOf(name); return i < 0 ? fallback : args.splice(i, 2)[1]; };
const url = flag('--url', 'http://127.0.0.1:' + (process.env.PORT ?? 4180));
const delay = Number(flag('--delay', '1500'));
const dir = new URL('../samples/', import.meta.url);
const files = readdirSync(dir).sort().filter(f => !args.length || args.some(a => f.includes(a)));

export function optionsOf(file: string): URLSearchParams {
  const q = new URLSearchParams();
  if (file.endsWith('.tsx')) q.set('syntax', 'tsx');
  const type = /\.(number|string|boolean)\.(rx|tsx)$/.exec(file)?.[1];
  if (type) q.set('type', type);
  return q;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  for (const [i, f] of files.entries()) {
    if (i) await new Promise(r => setTimeout(r, delay));
    const res = await fetch(url + '/eval?' + optionsOf(f), { method: 'POST', body: readFileSync(new URL(f, dir), 'utf8') });
    const e = await res.json() as { id?: number; ok?: boolean; diagnostics?: { code: string; message: string }[]; error?: string };
    console.log(res.status, f, e.error ?? ('#' + e.id + (e.ok ? ' ok' : ' refused: ' + e.diagnostics!.map(d => d.code + ' ' + d.message).join('; '))));
  }
}
