// DV-7 (not a divergence of ours — found lowering typed boundaries, R-f-4): an error rethrown from an inner boundary's fallback
// is caught by the outer boundary, which then never recovers when the inner content does.
// Expected after setWhich(0) following "outer:other": "ok0". Observed: stays "outer:other" until the inner errors again.
// ref/oracle and ref/compile avoid it: the fallback hands the error out and a memo around the boundary throws it.
import { createRoot, createSignal, createMemo, createRenderEffect, createErrorBoundary, flush, untrack } from "@solidjs/signals";
class NotFound extends Error {}
class Other extends Error {}
const [which, setWhich] = createSignal(0);
let screen = "";
createRoot(() => {
  const m = createMemo(() => { const w = which(); if (w === 1) throw new NotFound("nf"); if (w === 2) throw new Other("other"); return "ok" + w; });
  const inner = untrack(() => createErrorBoundary(() => m(), (err) => { const e = err(); if (!(e instanceof NotFound)) throw e; return "inner:" + e.message; }));
  const outer = untrack(() => createErrorBoundary(() => inner(), (err) => "outer:" + err().message));
  createRenderEffect(() => outer(), v => { screen = v; });
});
flush(); console.log(screen);
setWhich(1); flush(); console.log(screen);
setWhich(0); flush(); console.log(screen);
setWhich(2); flush(); console.log(screen);
setWhich(0); flush(); console.log(screen);
setWhich(1); flush(); console.log(screen);
setWhich(0); flush(); console.log(screen);
