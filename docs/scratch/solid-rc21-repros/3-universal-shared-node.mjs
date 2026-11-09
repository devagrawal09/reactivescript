// @solidjs/universal + solid-js 2.0.0-rc.21 (solidjs/solid@2105ffb8).
// In an app: import { createRenderer } from "@solidjs/universal"; import * as S from "solid-js".
// Here the built packages are imported by path. Run with the browser condition, so that
// @solidjs/universal's own `import "solid-js"` resolves to the client build (Node 24):
//   node --conditions=browser 3-universal-shared-node.mjs
const base = process.env.SOLID_PACKAGES ?? new URL("../../../solid-next/packages/", import.meta.url).href;
const S = await import(base + "solid/dist/solid.js");
const U = await import(base + "universal/dist/universal.js");

// A minimal tree host that, like the DOM, refuses to remove a node from a parent it is not in.
let n = 0;
const mk = (tag, text) => ({ id: n++, tag, text, children: [], parent: null });
const detach = c => { if (c.parent) { c.parent.children.splice(c.parent.children.indexOf(c), 1); c.parent = null; } };
const R = U.createRenderer({
  createElement: t => mk(t),
  createTextNode: v => mk(undefined, v),
  replaceText(node, v) { node.text = v; },
  isTextNode: x => x.tag === undefined,
  setProperty() {},
  insertNode(p, c, a) {
    if (a != null && a.parent !== p) throw new Error("NotFoundError (insertBefore)");
    detach(c);
    const i = a ? p.children.indexOf(a) : p.children.length;
    p.children.splice(i, 0, c);
    c.parent = p;
  },
  removeNode(p, c) {
    console.log(`  host.removeNode(parent #${p.id}, node #${c.id}); the node's parent is #${c.parent?.id ?? null}`);
    if (c.parent !== p) throw new Error("NotFoundError (removeChild)");
    detach(c);
  },
  getParentNode: x => x.parent,
  getFirstChild: x => x.children[0] ?? null,
  getNextSibling: x => (x.parent ? x.parent.children[x.parent.children.indexOf(x) + 1] ?? null : null)
});
const show = x => (x.tag === undefined ? String(x.text) : `<${x.tag}#${x.id}>${x.children.map(show).join("")}</${x.tag}>`);

const [a, setA] = S.createSignal(true), [b, setB] = S.createSignal(false);
const root = mk("root"), shared = mk("em");
R.insertNode(shared, mk(undefined, "shared"));
const p1 = mk("p"), p2 = mk("p");
R.insertNode(root, p1);
R.insertNode(root, p2);
S.createRoot(() => {
  R.insert(p1, () => (a() ? [shared, "x"] : ["y"]));
  R.insert(p2, () => (b() ? shared : "-"));
});
S.flush();
console.log("1", show(root));
setB(true); S.flush(); // p2's region takes the shared node out of p1
console.log("2", show(root));
setA(false); S.flush(); // p1's region drops it from its list
console.log("3", show(root));
