// DV-3, signals only: a re-armed boundary whose fallback reads pending data; the content lands first.
// Expected (SCENARIOS.md S-22 row 3′, loading-on-rearm-reveal-3540 "content lands before the fallback"): content(2), fallback never seen.
import { createRoot, createSignal, createMemo, createRenderEffect, createLoadingBoundary, flush, untrack } from "@solidjs/signals";

const flights = new Map();
const fetchKey = key => { if (!flights.has(key)) { let resolve; const p = new Promise(r => (resolve = r)); flights.set(key, { p, resolve }); } return flights.get(key).p; };
const land = async (key, v) => { flights.get(key).resolve(v); await new Promise(r => setTimeout(r, 0)); flush(); await new Promise(r => setTimeout(r, 0)); flush(); };

let screen = "";
const [id, setId] = createSignal(1);
createRoot(() => {
  const meta = createMemo(() => fetchKey("m:" + id()));
  const content = createMemo(() => fetchKey("c:" + id()));
  const variant = process.argv[2] ?? "effect-in-fallback";
  const fallback = variant === "read-in-fallback"
    ? () => `Meta ${meta()}`                                                   // the shape Solid's pinned test uses: passes
    : () => { let t = "Meta"; createRenderEffect(() => meta(), v => { t = `Meta ${v}`; }); return t; };   // a render effect inside the fallback (what an element + insert is)
  const inner = untrack(() => createLoadingBoundary(() => `content ${content()}`, fallback, { on: id }));
  const outer = untrack(() => createLoadingBoundary(() => inner(), () => "outer"));
  createRenderEffect(() => outer(), v => { screen = v; });
});
flush();
const show = label => console.log(label.padEnd(26), JSON.stringify(screen));
show("mount");
await land("m:1", 1); show("meta(1) lands");
await land("c:1", "c1"); show("content(1) lands");
setId(2); flush(); await new Promise(r => setTimeout(r, 0)); flush(); show("setId(2)");
await land("c:2", "c2"); show("content(2) lands FIRST");      // expected: "content c2"
await land("m:2", 2); show("meta(2) lands");
