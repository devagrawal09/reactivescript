// Suspected Solid rc.21 bug (docs/BOUNDARIES-COVERAGE.md, "Suspected Solid bug"): a flush never ends. On Solid's API
// alone (the production build, as fuzz/solid.mjs loads it), with the timing of fuzz/solid.mjs (a settled promise, then
// 32 microtask turns and flush()):
//   - `a` is an async memo over `s`, `m = a + s`;
//   - an error boundary E0 whose content is `isPending(() => m()) ? 100 : m()` and, inside it, a second error boundary
//     whose content reads `m() + a()`, rendered by a render effect;
//   - an action declares `affects(a)` and awaits a promise; meanwhile `s` is written (a new question for `a`) and
//     that question is rejected; then the action's promise resolves and the action writes `s` again.
// The last step never returns: the worker running it is terminated after 3 s and the script reports the hang.
// Usage: node docs/boundaries-fuzz/solid-bug-errored-pending-hang.mjs   (prints "hang" or "returned")
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
if (isMainThread) {
  const w = new Worker(new URL(import.meta.url));
  const timer = setTimeout(() => { console.log('hang: the last step did not return within 3 s'); w.terminate(); process.exitCode = 1; }, 3000);
  w.on('message', m => { if (m === 'done') { clearTimeout(timer); console.log('returned'); w.terminate(); } else console.log(m); });
} else {
  const S = await import(new URL('../../../solid-next/packages/signals/dist/prod/index.js', import.meta.url).href);
  const flights = new Map();
  const flight = id => { if (!flights.has(id)) { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); promise.catch(() => {}); flights.set(id, { promise, resolve, reject }); } return flights.get(id); };
  const drain = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); S.flush(); };
  const [s, setS] = S.createSignal(1);
  let a;
  S.createRoot(() => {
    a = S.createMemo(() => flight('q:' + (s() % 3)).promise);
    const m = S.createMemo(() => a() + s());
    S.createErrorBoundary(() => {
      const inner = S.createErrorBoundary(() => m() + a(), () => -1);
      S.createRenderEffect(() => inner(), () => {});
      return S.isPending(() => m()) ? 100 : m();
    }, () => -1);
  });
  S.action(function* () { S.affects(a); yield flight('f0').promise; setS(4); })().catch(() => {});
  setS(3);
  flight('q:0').reject(new Error('load-failed')); await drain();
  parentPort.postMessage('rejected q:0; resolving the action');
  flight('f0').resolve(1); await drain();
  parentPort.postMessage('done');
}
