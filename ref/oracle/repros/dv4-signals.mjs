// DV-4: a derived store's per-key verdicts under a boundary that has shown content.
// Expected (RULES-DERIVED D-30, SCENARIOS S-37 row 2): after setId(2), while the derive re-asks, isPending(() => state.a) is true.
import { createRoot, createSignal, createMemo, createStore, createRenderEffect, createLoadingBoundary, isPending, flush, untrack } from "@solidjs/signals";

const flights = new Map();
const fetchKey = key => { if (!flights.has(key)) { let resolve; const p = new Promise(r => (resolve = r)); flights.set(key, { p, resolve }); } return flights.get(key).p; };
const tick = async () => { await new Promise(r => setTimeout(r, 0)); flush(); await new Promise(r => setTimeout(r, 0)); flush(); };
const land = async (key, v) => { flights.get(key).resolve(v); await tick(); };

const [kind, where] = [process.argv[2] ?? "store", process.argv[3] ?? "boundary"];
let screen = "";
const [id, setId] = createSignal(1);
createRoot(() => {
  let a;
  if (kind === "store") { const [state] = createStore(async draft => { const v = await fetchKey("s:" + id()); Object.assign(draft, v); }, {}); a = () => state.a; }
  else { const m = createMemo(() => fetchKey("s:" + id())); a = () => m().a; }
  const view = () => `${a()} ${isPending(a) ? "pending" : "-"}`;
  const out = where === "boundary" ? untrack(() => createLoadingBoundary(view, () => "loading")) : view;
  createRenderEffect(() => out(), v => { screen = v; });
});
flush();
const show = label => console.log(label.padEnd(18), JSON.stringify(screen));
await tick(); show("mount");
await land("s:1", { a: 1, b: 1 }); show("s(1) lands");
setId(2); flush(); await tick(); show("setId(2)");        // expected: "1 pending"
await land("s:2", { a: 2, b: 2 }); show("s(2) lands");
