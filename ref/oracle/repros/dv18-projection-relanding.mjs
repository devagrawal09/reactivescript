// DV-18: since solidjs/solid#4280 (the DV-8 fix), a keyed projection over an async memo stops passing landings to row
// readers after the first one.
// Expected (RULES-DERIVED D-30; spec ST-4, H-2): each landing reconciles the rows and the row readers show it —
//   after the second landing, "apple,applesauce,apple pie".
// Observed on next @ 2f7dc84 (and at 1212b77, #4280; fine at f811097, the commit before): with a memo per row (what a
//   `<For>` row's `{row.name}` is), the rows keep "apple,apricot" after the second landing. Reading `row.name` straight
//   from the render effect follows both landings.
// node --conditions=browser --conditions=development repros/dv18-projection-relanding.mjs [row-memo|direct]
import { createRoot, createSignal, createMemo, createProjection, createRenderEffect, mapArray, flush } from "@solidjs/signals";
const mode = process.argv[2] ?? "row-memo";
const [q, setQ] = createSignal("");
const res = {}; let screen = "";
createRoot(() => {
  const src = createMemo(() => (q() === "" ? [] : new Promise(r => (res[q()] = r))));
  const rows = createProjection(() => src(), [], { key: "id" });
  if (mode === "direct") createRenderEffect(() => rows.map(r => r.name).join(","), v => { screen = v; });
  else {
    const views = mapArray(() => rows, row => { const name = createMemo(() => row.name); return () => name(); });
    createRenderEffect(() => views().map(f => f()).join(","), v => { screen = v; });
  }
});
const tick = async () => { for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 0)); flush(); } };
const show = l => console.log(l.padEnd(18), JSON.stringify(screen));
flush(); await tick(); show("mount");
setQ("ap"); flush(); await tick(); show("q = ap");
res.ap([{ id: 1, name: "apple" }, { id: 2, name: "apricot" }]); await tick(); show("ap lands");
setQ("app"); flush(); await tick(); show("q = app");
res.app([{ id: 1, name: "apple" }, { id: 3, name: "applesauce" }, { id: 4, name: "apple pie" }]); await tick(); show("app lands");   // expected "apple,applesauce,apple pie"
