// DV-3 through solid-js's <Loading> and a renderer: a re-armed boundary whose fallback reads pending data; the content lands first.
// Expected (SCENARIOS.md S-22 row 3′): after content(2) lands, the screen shows c2 and the fallback is never seen.
import { createRenderer } from "@solidjs/universal";
import { Loading } from "solid-js";
import { createSignal, createMemo, flush } from "@solidjs/signals";

// a string-tree renderer
const R = createRenderer({
  createElement: tag => ({ tag, children: [] }), createTextNode: text => ({ text }),
  replaceText: (n, v) => { n.text = v; }, isTextNode: n => "text" in n, setProperty() {},
  insertNode: (p, n, a) => { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); const i = a ? p.children.indexOf(a) : -1; i < 0 ? p.children.push(n) : p.children.splice(i, 0, n); n.parent = p; },
  removeNode: (p, n) => { const i = p.children.indexOf(n); if (i >= 0) p.children.splice(i, 1); n.parent = undefined; },
  getParentNode: n => n.parent, getFirstChild: n => n.children?.[0], getNextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1],
});
const text = n => "text" in n ? n.text : n.children.map(text).join("");

const flights = new Map();
const fetchKey = key => { if (!flights.has(key)) { let resolve; const p = new Promise(r => (resolve = r)); flights.set(key, { p, resolve }); } return flights.get(key).p; };
const tick = async () => { await new Promise(r => setTimeout(r, 0)); flush(); await new Promise(r => setTimeout(r, 0)); flush(); };
const land = async (key, v) => { flights.get(key).resolve(v); await tick(); };

const [id, setId] = createSignal(1);
const root = { tag: "root", children: [] };
const variant = process.argv[2] ?? "element-fallback";
R.render(() => {
  const meta = createMemo(() => fetchKey("m:" + id()));
  const content = createMemo(() => fetchKey("c:" + id()));
  const inner = () => R.createComponent(Loading, {
    get on() { return id(); },
    get fallback() {
      if (variant === "static-fallback") return R.createTextNode("Meta");
      if (variant === "array-fallback") return [R.createTextNode("Meta "), () => String(meta())];
      const p = R.createElement("p"); R.insert(p, [R.createTextNode("Meta "), () => String(meta())]); return p;   // what <p>Meta {meta()}</p> compiles to
    },
    get children() { return () => String(content()); },
  });
  return R.createComponent(Loading, { get fallback() { return R.createTextNode("outer"); }, get children() { return inner(); } });
}, root);
flush();
const show = label => console.log(label.padEnd(26), JSON.stringify(text(root)));
show("mount"); await tick(); show("mount (settled)");
await land("m:1", 1); show("meta(1) lands");
await land("c:1", "c1"); show("content(1) lands");
setId(2); flush(); await tick(); show("setId(2)");
await land("c:2", "c2"); show("content(2) lands FIRST");     // expected: "c2"
if (flights.has("m:2")) { await land("m:2", 2); show("meta(2) lands"); }
