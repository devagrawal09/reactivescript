// solid-js 2.0.0-rc.21 (solidjs/solid@2105ffb8). In an app: import * as S from "solid-js".
// Here the built package is imported by path (override with SOLID_JS=...). Node 24.
// A flush never returns: an error boundary whose content pass is a verdict reader (it calls isPending) builds a second
// boundary over a pending async memo; an action declared affects(a), its memo's question is rejected, and the action
// writes again after its await. The script runs the program in a worker and reports "hang" after 20 s. On the prod
// build the flush loops until then; on the dev build its loop guard (1e5 rounds, about 3.5 s here) throws "Potential
// Infinite Loop Detected", which the script prints as "threw: ..." and exits 1.
import { Worker, isMainThread, parentPort } from "node:worker_threads";
if (isMainThread) {
  const w = new Worker(new URL(import.meta.url));
  const timer = setTimeout(() => { console.log("hang: the last step did not return within 20 s"); w.terminate(); }, 20000);
  w.on("error", e => { clearTimeout(timer); console.log("threw: " + e.message); process.exitCode = 1; });
  w.on("message", m => { if (m === "done") { clearTimeout(timer); console.log("returned"); w.terminate(); } else console.log(m); });
} else {
  const S = await import(process.env.SOLID_JS ?? new URL("../../../solid-next/packages/solid/dist/solid.js", import.meta.url).href);
  const drain = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); S.flush(); };
  const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); promise.catch(() => {}); return { promise, resolve, reject }; };
  const q = [deferred(), deferred(), deferred()], f0 = deferred();
  const [s, setS] = S.createSignal(1);
  let a;
  S.createRoot(() => {
    a = S.createMemo(() => q[s() % 3].promise);
    const m = S.createMemo(() => a() + s());
    S.createErrorBoundary(() => {
      const inner = S.createErrorBoundary(() => m() + a(), () => -1);
      S.createRenderEffect(() => inner(), () => {});
      return S.isPending(() => m()) ? 100 : m();
    }, () => -1);
  });
  S.action(function* () { S.affects(a); yield f0.promise; setS(4); })().catch(() => {});
  setS(3);
  q[0].reject(new Error("load-failed")); await drain();
  parentPort.postMessage("rejected the new question; resolving the action");
  f0.resolve(1); await drain();
  parentPort.postMessage("done");
}
