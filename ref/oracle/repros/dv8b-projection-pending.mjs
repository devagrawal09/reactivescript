// DV-8 (what #4280 left): `isPending` over a keyed projection, read in its own render effect beside a boundary that shows
// the projection, misses its memo's re-ask. Expected (RULES-DERIVED D-30): true while the memo re-asks.
// node --conditions=browser --conditions=development repros/dv8b-projection-pending.mjs [proxy|length] [boundary|none]
import { createRoot, createSignal, createMemo, createProjection, createRenderEffect, createErrorBoundary, createLoadingBoundary, isPending, flush, untrack } from "@solidjs/signals";
const [probe, where] = [process.argv[2] ?? "proxy", process.argv[3] ?? "boundary"];
const [q, setQ] = createSignal("");
const res = {}; let probeShown = "", content = "";
createRoot(() => {
  const src = createMemo(() => { const v = q(); if (v === "") return []; if (v.length < 2) throw new Error("too short"); return new Promise(r => (res[v] = r)); });
  const rows = createProjection(() => src(), [], { key: "id" });
  createRenderEffect(() => isPending(() => probe === "proxy" ? rows : probe === "keys" ? Reflect.ownKeys(rows) : rows.length) ? "searching" : "-", v => { probeShown = v; });
  const view = () => `${rows.length} ${rows.map(r => r.name).join(",")}`;
  const out = where === "boundary" ? untrack(() => createErrorBoundary(() => createLoadingBoundary(view, () => "loading")(), e => "error:" + e().message)) : () => { try { return view(); } catch (e) { return e?.message ?? "pending"; } };
  createRenderEffect(() => out(), v => { content = v; });
});
const tick = async () => { for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 0)); flush(); } };
const show = (l, want) => console.log(l.padEnd(14), probeShown.padEnd(10), JSON.stringify(content), want ? `(probe expected ${want})` : "");
flush(); await tick(); show("mount");
setQ("a"); flush(); await tick(); show("q = a (throws)", "-");
setQ("ap"); flush(); await tick(); show("q = ap", "searching");
res.ap([{ id: 1, name: "apple" }, { id: 2, name: "apricot" }]); await tick(); show("ap lands", "-");
setQ("app"); flush(); await tick(); show("q = app", "searching");
res.app([{ id: 1, name: "apple" }, { id: 3, name: "applesauce" }]); await tick(); show("app lands", "-");
