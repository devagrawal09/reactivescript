// DV-16: a reader whose first read is `latest(s)` publishes an empty slot instead of holding on a later never-shown read.
// node --conditions=browser --conditions=development repros/dv16-latest-first.mjs [latest-first|n0-first]   (from ref/oracle)
// Expected (SCENARIOS.md S-39, D-28, ruled 2026-10-09): either order holds the mount — control stays "off" until n0(1)
//   lands, then "on [1, 1]".
// Observed: `latest`-first publishes the branch with its slot empty ("on " — the ✗ row of S-39); `n0`-first holds,
//   as ruled. The branch is <Show>, its one reader inserted by @solidjs/universal.
// Found by S-solid-39.
import { createRenderer } from "@solidjs/universal";
import { Show, createSignal, createMemo, createRoot, action, latest, flush } from "solid-js";
const order = process.argv[2] ?? "latest-first";
const nodes = {
  createElement: tag => ({ tag, children: [] }), createTextNode: text => ({ text }), replaceText: (n, v) => { n.text = v; }, isTextNode: n => "text" in n,
  setProperty() {}, getParentNode: n => n.parent, getFirstChild: n => n.children?.[0], getNextSibling: n => n.parent && n.parent.children[n.parent.children.indexOf(n) + 1],
  insertNode(p, n, anchor) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); const i = anchor ? p.children.indexOf(anchor) : -1; i < 0 ? p.children.push(n) : p.children.splice(i, 0, n); n.parent = p; },
  removeNode(p, n) { p.children.splice(p.children.indexOf(n), 1); n.parent = undefined; },
};
const R = createRenderer(nodes);
const text = n => "text" in n ? n.text : n.children.map(text).join("");
const [s, setS] = createSignal(0);
const [mounted, setMounted] = createSignal(false);
const resolvers = new Map();
const root = { tag: "root", children: [] };
createRoot(() => {
  const n0 = createMemo(async () => new Promise(r => resolvers.set(latest(s), r)));   // nobody on screen reads it yet
  const reader = () => order === "latest-first" ? `[${latest(s)}, ${n0()}]` : `[${n0()}, ${latest(s)}]`.replace(/\[(.*), (.*)\]/, "[$2, $1]");
  const control = { tag: "p", children: [] }, slot = { tag: "p", children: [] }; nodes.insertNode(root, control); nodes.insertNode(root, slot);
  R.insert(control, () => mounted() ? "on " : "off ");
  R.insert(slot, R.createComponent(Show, { get when() { return mounted(); }, children: () => reader }));
});
const tick = async () => { await new Promise(r => setTimeout(r, 0)); flush(); };
flush(); await tick();
let release; const hold = action(function* () { setS(1); yield new Promise(r => (release = r)); });
hold(); flush(); await tick(); console.log("action holds s=1  ", JSON.stringify(text(root)));
setMounted(true); flush(); await tick(); console.log("mounted := true   ", JSON.stringify(text(root)), " (expected: \"off \")");
resolvers.get(1)?.(1); await tick(); await tick(); console.log("n0(1) lands       ", JSON.stringify(text(root)), " (expected: \"on [1, 1]\")");
release(); await tick(); await tick(); console.log("action ends       ", JSON.stringify(text(root)));
