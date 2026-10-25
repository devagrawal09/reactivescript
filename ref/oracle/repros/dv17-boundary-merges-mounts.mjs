// DV-17: two branches under one error boundary, mounted in separate flushes over two independent holds, merge the holds.
// node --conditions=browser --conditions=development repros/dv17-boundary-merges-mounts.mjs [boundary|none]   (from ref/oracle)
// Expected (SCENARIOS.md S-5 rows 1′–3′, D-4 "membership is the tick's"): each mount joins only the hold its own flush
//   read — when slowA lands, pA reveals alone: "x1/y pA 1".
// Observed: with both <Show>s under one createErrorBoundary, slowA's landing reveals nothing ("x/y") until slowB lands;
//   without the boundary (or with one boundary per branch) pA reveals alone, as ruled.
// Found by S-solid-5.
import { createRenderer } from "@solidjs/universal";
import { Show, Errored, createSignal, createMemo, createRoot, flush } from "solid-js";
const shape = process.argv[2] ?? "boundary";
const nodes = {
  createElement: tag => ({ tag, children: [] }), createTextNode: text => ({ text }), replaceText: (n, v) => { n.text = v; }, isTextNode: n => "text" in n,
  setProperty() {}, getParentNode: n => n.parent, getFirstChild: n => n.children?.[0], getNextSibling: n => n.parent && n.parent.children[n.parent.children.indexOf(n) + 1],
  insertNode(p, n, anchor) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); const i = anchor ? p.children.indexOf(anchor) : -1; i < 0 ? p.children.push(n) : p.children.splice(i, 0, n); n.parent = p; },
  removeNode(p, n) { p.children.splice(p.children.indexOf(n), 1); n.parent = undefined; },
};
const R = createRenderer(nodes);
const el = (tag, ...kids) => { const n = R.createElement(tag); kids.forEach(k => typeof k === "function" ? R.insert(n, k, null) : R.insertNode(n, k)); return n; };
const text = n => "text" in n ? n.text : n.children.map(text).join(" ").replace(/\s+/g, " ").trim();
const [a, setA] = createSignal(0), [b, setB] = createSignal(0), [showA, setShowA] = createSignal(false), [showB, setShowB] = createSignal(false);
const res = new Map(); const fetchKey = k => new Promise(r => res.set(k, r));
const root = { tag: "root", children: [] };
createRoot(() => {
  const sa = createMemo(() => fetchKey("A:" + a())), sb = createMemo(() => fetchKey("B:" + b()));
  const branches = () => [
    el("p", () => `${sa()}/${sb()}`),
    R.createComponent(Show, { get when() { return showA(); }, children: () => { const ma = createMemo(() => a()); return el("p", () => `pA ${ma()}`); } }),
    R.createComponent(Show, { get when() { return showB(); }, children: () => { const mb = createMemo(() => b()); return el("p", () => `pB ${mb()}`); } }),
  ];
  R.insert(root, shape === "boundary" ? R.createComponent(Errored, { fallback: e => "error", get children() { return branches(); } }) : branches(), null);
});
const tick = async () => { for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 0)); flush(); } };
flush(); res.get("A:0")("x"); res.get("B:0")("y"); await tick(); console.log("loaded         ", text(root));
setA(1); flush(); await tick(); setB(1); flush(); await tick(); console.log("a, b held      ", text(root));
setShowA(true); flush(); await tick(); setShowB(true); flush(); await tick(); console.log("two mounts     ", text(root));
res.get("A:1")("x1"); await tick(); console.log("slowA lands    ", text(root), " (expected: x1/y pA 1)");
res.get("B:1")("y1"); await tick(); console.log("slowB lands    ", text(root));
