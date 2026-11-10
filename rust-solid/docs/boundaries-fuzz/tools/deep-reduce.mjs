// Usage (rust-solid/): node docs/boundaries-fuzz/tools/deep-reduce.mjs IN.json OUT.json [CLASS] [MS]
// Structural reducer for --boundaries programs: removes ops, children, fallback entries and exprs while the oracle
// still times out (or halts / errors: the class given), each candidate in a fresh worker.
import { Worker } from 'node:worker_threads';
import { readFileSync, writeFileSync } from 'node:fs';
const F = new URL('../../../fuzz/', import.meta.url).href;
const [inp, outp, want = 'oracle-timeout', ms = '1500'] = process.argv.slice(2);
const oracle = ops => new Promise(res => { const w = new Worker(F + 'worker.mjs', { workerData: { strict: 'boundaries' } }); let done = false;
  const fin = r => { if (done) return; done = true; clearTimeout(t); w.terminate(); res(r) };
  const t = setTimeout(() => fin('oracle-timeout'), +ms);
  w.on('message', m => { if ('progress' in m) return; fin(m.invalid ?? 'ok') }); w.once('error', () => fin('oracle-error')); w.postMessage(ops) });
let ops = JSON.parse(readFileSync(inp, 'utf8'));
const variants = function* (ops) {
  for (let i = 0; i < ops.length; i++) yield ops.slice(0, i).concat(ops.slice(i + 1));
  // inside boundaries: drop a child, a fallback entry, the expr, err
  const walk = function* (o, path) {
    for (const key of ['children', 'fallback']) if (Array.isArray(o[key])) for (let i = 0; i < o[key].length; i++) yield [path, key, i];
    if ('expr' in o && path.length) yield [path, 'expr', -1];
    for (const key of ['children', 'fallback']) if (Array.isArray(o[key])) o[key].forEach((c, i) => { for (const k of ['loading', 'errored']) if (c[k]) { } });
  };
  for (let i = 0; i < ops.length; i++) {
    const rec = function* (o, get) {
      for (const key of ['children', 'fallback', 'yes', 'no']) if (Array.isArray(o[key])) for (let j = 0; j < o[key].length; j++) {
        yield () => { const c = structuredClone(ops); const t = get(c); t[key].splice(j, 1); return c };
        const ch = o[key][j]; const inner = ch.loading ?? ch.errored ?? ch.show;
        if (inner) yield* rec(inner, c => { const t = get(c)[key][j]; return t.loading ?? t.errored ?? t.show });
      }
      if ('expr' in o && (o.op === 'loading' || o.op === 'errored' || !o.op)) yield () => { const c = structuredClone(ops); delete get(c).expr; return c };
      if (o.err) yield () => { const c = structuredClone(ops); delete get(c).err; return c };
    };
    if (['loading', 'errored', 'memo'].includes(ops[i].op)) yield* [...rec(ops[i], c => c[i])].map(f => f());
  }
};
// A candidate is valid when every `local` names a node defined earlier in its pass (its children list).
const valid = ops => { const ok = (kids, outer) => { const defined = new Set(outer);
    for (const c of kids ?? []) { const exprs = [c.expr]; if (!locals(c.expr, defined)) return false;
      const inner = c.loading ?? c.errored; if (inner && (!ok(inner.children, []) || !ok(inner.fallback, []) || !locals(inner.expr, new Set(inner.children.map(x => x.memo ?? x.loading?.id ?? x.errored?.id ?? x.show?.id).filter(Boolean))))) return false;
      if (c.show && (!locals(c.show.when, defined) || !ok(c.show.yes, []) || !ok(c.show.no, []))) return false;
      for (const id of [c.memo, c.loading?.id, c.errored?.id, c.show?.id]) if (id) defined.add(id) } return true };
  const locals = (e, defined) => { if (!e || typeof e !== 'object') return true; if (e.op === 'local' && !defined.has(e.id)) return false; return ['a', 'b', 'test', 'yes', 'no', 'of', 'expr'].every(k => !(k in e) || locals(e[k], defined)) };
  return ops.every(o => o.op !== 'loading' && o.op !== 'errored' || ok(o.children, []) && ok(o.fallback, []) && locals(o.expr, new Set(o.children.map(x => x.memo ?? x.loading?.id ?? x.errored?.id ?? x.show?.id).filter(Boolean)))) };
let changed = true;
while (changed) { changed = false;
  for (const v of variants(ops)) { if (JSON.stringify(v) === JSON.stringify(ops) || !valid(v)) continue; const r = await oracle(v); if (r === want) { ops = v; changed = true; console.log('reduced to', JSON.stringify(ops).length); break } } }
writeFileSync(outp, JSON.stringify(ops, null, 1)); console.log('done', ops.length);
