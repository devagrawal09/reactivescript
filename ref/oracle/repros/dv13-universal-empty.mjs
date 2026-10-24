// DV-13: a region of a universal-renderer element loses its place once it renders an empty fragment.
// node --conditions=browser repros/dv13-universal-empty.mjs      (from ref/oracle)
// <main><A />{String(" ")}<B /></main>, compiled by @solidjs/compiler (generate "universal") onto a minimal object-tree
// renderer. Every child of <main> is dynamic, so each insert gets a `null` marker and keeps its slot with a sentinel. A's
// <Show> starts on its fallback; when the fallback is an empty fragment (`<></>`, which compiles to `[]`), the empty
// array removes the sentinel, and the content that replaces it later is appended after B.
// Expected in every row: " pick" → "results pick".
import { transform } from "@solidjs/compiler";
import { writeFileSync, mkdirSync } from "node:fs";
import { flush } from "solid-js";
const here = new URL(".", import.meta.url).pathname;
const dir = here + "dv13.build/"; mkdirSync(dir, { recursive: true });
writeFileSync(dir + "renderer.mjs", `import { createRenderer } from "@solidjs/universal";
export { Show } from "solid-js";
const nodes = {
  createElement: tag => ({ tag, children: [] }), createTextNode: text => ({ text }), replaceText: (n, v) => { n.text = v; }, isTextNode: n => "text" in n,
  setProperty() {}, getParentNode: n => n.parent, getFirstChild: n => n.children?.[0], getNextSibling: n => n.parent && n.parent.children[n.parent.children.indexOf(n) + 1],
  insertNode(p, n, anchor) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); const i = anchor ? p.children.indexOf(anchor) : -1; i < 0 ? p.children.push(n) : p.children.splice(i, 0, n); n.parent = p; },
  removeNode(p, n) { p.children.splice(p.children.indexOf(n), 1); n.parent = undefined; },
};
export const { render, insert, insertNode, createElement, createTextNode, createComponent, effect, memo, setProp } = createRenderer(nodes);
export const text = n => "text" in n ? n.text : n.children.map(text).join("");
`);
const app = fallback => `import { createSignal } from "solid-js";
export const [on, setOn] = createSignal(false);
function A() { return <Show when={on()}${fallback}><section><p>results</p></section></Show>; }
function B() { return <p>pick</p>; }
export const view = () => <main><A />{String(" ")}<B /></main>;`;
const R = await import(dir + "renderer.mjs");
for (const [label, fallback] of [["no fallback", ""], ["fallback={<></>}", " fallback={<></>}"], ["fallback={<i />}", " fallback={<i />}"]]) {
  const f = dir + `app-${label.replace(/\W/g, "")}.mjs`;
  writeFileSync(f, transform(app(fallback), { filename: "app.jsx", generate: "universal", moduleName: dir + "renderer.mjs" }).code);
  const m = await import(f);
  const root = { tag: "root", children: [] };
  R.render(m.view, root); flush(); const before = R.text(root);
  m.setOn(true); flush();
  console.log(label.padEnd(18), JSON.stringify(before), "→", JSON.stringify(R.text(root)));
}
