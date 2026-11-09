// The same two programs on @solidjs/web's DOM `insert` (jsdom 25 from the solid repo's devDependencies).
// In an app: import { insert } from "@solidjs/web"; import * as S from "solid-js".
//   node --conditions=browser 3-dom-comparison.mjs
import { createRequire } from "node:module";
const repo = process.env.SOLID_REPO ?? new URL("../../../solid-next/", import.meta.url).href;
const { JSDOM } = createRequire(repo + "node_modules/.pnpm/jsdom@25.0.1/node_modules/jsdom/package.json")("jsdom");
const { window } = new JSDOM("<!doctype html><body></body>");
for (const k of ["window", "document", "Node", "Element", "HTMLElement", "Text", "Comment", "DocumentFragment", "navigator", "MutationObserver"]) globalThis[k] ??= window[k];
const S = await import(repo + "packages/solid/dist/solid.js");
const W = await import(repo + "packages/web/dist/web.js");

for (const bulk of [false, true]) {
  document.body.innerHTML = "";
  const [a, setA] = S.createSignal(true), [b, setB] = S.createSignal(false);
  const shared = document.createElement("em"); shared.textContent = "shared";
  const x = document.createElement("i"), y = document.createElement("u");
  const p1 = document.createElement("p"), p2 = document.createElement("p");
  document.body.append(p1, p2);
  S.createRoot(() => {
    W.insert(p1, bulk ? () => (a() ? [x, shared, y] : [x, y]) : () => (a() ? [shared, "x"] : ["y"]));
    W.insert(p2, () => (b() ? shared : "-"));
  });
  S.flush();
  console.log(bulk ? "bulk-removal program" : "map-removal program");
  console.log("1", document.body.innerHTML);
  setB(true); S.flush();
  console.log("2", document.body.innerHTML);
  setA(false); S.flush();
  console.log("3", document.body.innerHTML);
}
