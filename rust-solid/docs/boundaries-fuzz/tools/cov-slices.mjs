// Usage (rust-solid/): NODE_V8_COVERAGE=DIR node docs/boundaries-fuzz/tools/cov-slices.mjs MODE FIRST LAST [JOBS]
// MODE: slice1 | slice2a | slice2b | slice2c | strings | boundaries
// Coverage of the rust-solid slice fuzz programs on Solid's prod dist: every program in a fresh worker (worker.mjs).
import { Worker } from 'node:worker_threads';
const F = new URL('../../../fuzz/', import.meta.url).href;
const [mode, a, b, jobs = '4'] = process.argv.slice(2);
const g = { slice1: ['generate-slice1.mjs', 'generateSlice1'], slice2a: ['generate-slice2a.mjs', 'generateSlice2a'], slice2b: ['generate-slice2b.mjs', 'generateSlice2b'], slice2c: ['generate-slice2c.mjs', 'generateSlice2c'], strings: ['generate-strings.mjs', 'generateStrings'], boundaries: ['generate-boundaries.mjs', 'generateBoundaries'] }[mode];
const gen = (await import(F + g[0]))[g[1]];
const strict = { slice1: undefined, slice2a: true, slice2b: 'slice2b', slice2c: 'slice2c', strings: 'strings', boundaries: 'boundaries' }[mode];
const once = ops => new Promise(res => { const w = new Worker(F + 'worker.mjs', strict === undefined ? {} : { workerData: { strict } }); const t = setTimeout(() => { w.terminate(); res() }, 10000); w.on('message', m => { if ('progress' in m) return; clearTimeout(t); w.terminate().then(res) }); w.once('error', () => { clearTimeout(t); res() }); w.postMessage(ops) });
let next = +a; let n = 0;
async function lane() { while (next <= +b) { const s = next++; await once(gen(s)); n++ } }
await Promise.all(Array.from({ length: +jobs }, lane)); console.log(mode, n, 'programs');
