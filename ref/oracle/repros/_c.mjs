import { createRoot, createSignal, createMemo, createRenderEffect, createErrorBoundary, flush, untrack } from "@solidjs/signals";
const [w, setW] = createSignal(0);
let screen = "";
createRoot(() => {
  const m = createMemo(() => { if (w() === 1) throw new Error("boom"); return "ok" + w(); });
  const c = createMemo(() => { try { return m(); } catch (e) { return "caught:" + e.message; } });
  const out = untrack(() => createErrorBoundary(() => c(), err => "boundary:" + err().message));
  createRenderEffect(() => out(), v => { screen = v; });
});
flush(); console.log(screen); setW(1); flush(); console.log(screen); setW(2); flush(); console.log(screen);
