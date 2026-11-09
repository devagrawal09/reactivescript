// Builds out/solid-trace: the TS copy of Solid (out/solid-src, see SLICE1-PARITY.md)
// with scheduler trace points that print the same lines as the Rust runtime does
// under SLICE1_TRACE=1 (R recompute, RD read, N notifyStatus, W landing, E rejection,
// P settlePendingSource, C commit, L land, J joinFuture, S seam, H hold, MARK cut
// sites), and a traced copy of fuzz/solid.mjs that interleaves its LOG events.
// Node labels are creation order of signals and computeds; transactions, creation
// order. Positions shift only inside the copy; out/ is gitignored.
// Usage (repository root): node docs/slice2a-fuzz/tools/trace-copy.mjs
import {cpSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
const dir='out/solid-trace/';rmSync(dir,{recursive:true,force:true});cpSync('out/solid-src',dir,{recursive:true});
const patch=(f,a,b)=>{const p=dir+'core/'+f,s=readFileSync(p,'utf8');if(!s.includes(a))throw Error(f+': '+a.slice(0,60));writeFileSync(p,s.replace(a,b))};
const T='(globalThis as any).__T',id=x=>`\${(${x} as any).__id}`;
patch('core.ts','  setupComputedNode(self, options);\n  return self;','  (self as any).__id = (globalThis as any).__NID++;\n  setupComputedNode(self, options);\n  return self;');
patch('core.ts','  setupComputedNode(self, lazyOptions);\n  return self;','  (self as any).__id = (globalThis as any).__NID++;\n  setupComputedNode(self, lazyOptions);\n  return self;');
patch('core.ts','  if (__DEV__) (s as any)._internal = false;','  (s as any).__id = (globalThis as any).__NID++;\n  if (__DEV__) (s as any)._internal = false;');
patch('scheduler.ts','    _marks: null\n  };\n  if (!lane) transactions.push(t);','    _marks: null\n  };\n  (t as any).__id = (globalThis as any).__TID++;\n  if (!lane) transactions.push(t);');
patch('core.ts','export function recompute(el: Computed<any>, create: boolean = false): void {\n',`export function recompute(el: Computed<any>, create: boolean = false): void {\n  ${T}?.(\`R ${id('el')} \${create ? 1 : 0} f\${el._flags} c\${el._config} s\${el._statusFlags}\`);\n`);
patch('core.ts','  const computed = el as Partial<Computed<unknown>>;',`  ${T}?.(\`RD ${id('el')} c\${el._config} s\${(el as any)._statusFlags ?? 0} p\${el._pendingValue !== NOT_PENDING ? 1 : 0} by \${c ? (c as any).__id : '-'}\`);\n  const computed = el as Partial<Computed<unknown>>;`);
patch('async.ts','export function notifyStatus(el: Computed<any>, status: number, error?: any): void {\n',`export function notifyStatus(el: Computed<any>, status: number, error?: any): void {\n  ${T}?.(\`N ${id('el')} \${status}\`);\n`);
patch('async.ts','    const wasUninitialized = el._statusFlags & STATUS_UNINITIALIZED;\n    landStatus(el);',`    const wasUninitialized = el._statusFlags & STATUS_UNINITIALIZED;\n    ${T}?.(\`W ${id('el')}\`);\n    landStatus(el);`);
patch('async.ts','    let stillPending = error instanceof NotReadyError;',`    let stillPending = error instanceof NotReadyError;\n    ${T}?.(\`E ${id('el')}\`);`);
patch('async.ts','export function settlePendingSource(el: Computed<any>, source: Computed<any> = el): void {\n',`export function settlePendingSource(el: Computed<any>, source: Computed<any> = el): void {\n  ${T}?.(\`P ${id('el')} ${id('source')}\`);\n`);
patch('async.ts','  clearPendingSources(el);\n  if (el._x) el._x._blocked = false;',`  ${T}?.('MARK stageError');\n  clearPendingSources(el);\n  if (el._x) el._x._blocked = false;`);
patch('scheduler.ts','export function commitPendingNode(n: Signal<any>): void {\n',`export function commitPendingNode(n: Signal<any>): void {\n  ${T}?.(\`C ${id('n')}\`);\n`);
patch('scheduler.ts','function land(u: Transaction): void {\n',`function land(u: Transaction): void {\n  ${T}?.(\`L ${id('u')}\`);\n`);
patch('scheduler.ts','export function joinFuture(t: Transaction | null): void {\n',`export function joinFuture(t: Transaction | null): void {\n  ${T}?.(\`J \${t ? (resolveTx(t) as any).__id : 'null'} f=\${flushTransaction ? (resolveTx(flushTransaction) as any).__id : 'null'}\`);\n`);
patch('scheduler.ts','    const t = joined !== null && !joined._lane ? resolveTx(joined) : null;\n',`    const t = joined !== null && !joined._lane ? resolveTx(joined) : null;\n    ${T}?.(\`S \${t ? (t as any).__id : 'null'} [\${pendingNodes.map(n => (n as any).__id)}]\`);\n`);
patch('scheduler.ts','export function holdNode(n: Signal<any>, t: Transaction): void {\n',`export function holdNode(n: Signal<any>, t: Transaction): void {\n  ${T}?.(\`H ${id('n')} \${(resolveTx(t) as any).__id}\`);\n`);
patch('scheduler.ts','  if (passTx === null) passTx = resolveTx(t);',`  ${T}?.('MARK passTx');\n  if (passTx === null) passTx = resolveTx(t);`);
patch('lanes.ts','function linkLanes(a: Transaction, b: Transaction): void {\n',`function linkLanes(a: Transaction, b: Transaction): void {\n  ${T}?.('MARK linkLanes');\n`);
let h=readFileSync('docs/slice1-fuzz/parity/tools/hooks.mjs','utf8').replace('/solid-src/','/solid-trace/');writeFileSync(dir+'hooks.mjs',h);
writeFileSync(dir+'register.mjs',readFileSync('docs/slice1-fuzz/parity/tools/register.mjs','utf8'));
let s=readFileSync('fuzz/solid.mjs','utf8').replace(/^const S = .*$/m,"const S = await import(new URL('./index.ts', import.meta.url).href);")
 .replace('log=[];','log=[];const L=e=>{log.push(e);globalThis.__T?.(\'LOG \'+JSON.stringify(e))};').replace(/log\.push\(/g,'L(').replace('const L=e=>{L(e)','const L=e=>{log.push(e)');
writeFileSync(dir+'solid-trace.mjs',s);
writeFileSync(dir+'trace-run.mjs',`// node --import ./out/solid-trace/register.mjs out/solid-trace/trace-run.mjs ops.json
globalThis.__NID=0;globalThis.__TID=0;const lines=[];globalThis.__T=s=>lines.push(s);
const {run}=await import('./solid-trace.mjs');const {readFileSync}=await import('node:fs');
const ops=JSON.parse(readFileSync(process.argv[2],'utf8'));
await run(ops,i=>lines.push('OP '+i+' '+(typeof i==='number'?ops[i].op:i)));console.log(lines.join('\\n'));
`);
console.log('wrote',dir);
