// DV-8: a keyed projection over a memo does not follow the memo once it has shown a value.
// Expected (RULES-DERIVED: a derived store reports its source's pending and errors like any derivation; spec H-12, R-9):
//   after q=b, isPending true ("1 pending"); after the second throw, "error:too short".
// Observed: "1 -" and "2 -" — the projection keeps its last value, reports no verdict, and swallows the error.
// Found by S-ai2-search (an agent-written app: `results key id = q.length < 2 ? throw TooShort(q) : await search(q)`).
import { createRoot, createSignal, createMemo, createProjection, createRenderEffect, createErrorBoundary, isPending, flush, untrack } from "@solidjs/signals";
const [q, setQ] = createSignal("a");
let resolveB; let screen = "";
createRoot(() => {
  const src = createMemo(() => { const v = q(); if (v === "a") throw new Error("too short"); if (v === "b") return new Promise(r => (resolveB = r)); return [{ id: 1, n: v }]; });
  const proj = createProjection(() => src(), [], { key: "id" });
  const out = untrack(() => createErrorBoundary(() => `${proj.length} ${isPending(() => proj.length) ? "pending" : "-"}`, err => "error:" + err().message));
  createRenderEffect(() => out(), v => { screen = v; });
});
const tick = async () => { await new Promise(r => setTimeout(r, 0)); flush(); };
flush(); await tick(); console.log("q=a (throws)      ", screen);
setQ("c"); flush(); await tick(); console.log("q=c (value)       ", screen);
setQ("b"); flush(); await tick(); console.log("q=b (pending)     ", screen);
resolveB([{ id: 2, n: "b" }, { id: 3, n: "b" }]); await tick(); console.log("b lands           ", screen);
setQ("a"); flush(); await tick(); console.log("q=a (throws again)", screen);
