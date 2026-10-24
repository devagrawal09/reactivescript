// The client half, as Solid's compiler emits it for the DOM with hydration.
import { createMemo, createComponent, Errored, Loading, flush } from "solid-js";
import { hydrate, template, getNextElement, getNextMarker, insert } from "@solidjs/web";
const asked = [];
const ask = key => { asked.push(key); return new Promise(() => {}); };
const tFailed = template(`<p>failed: <!$><!/>`), tLoading = template(`<p>loading`), tP = template(`<p>`);
function App() {
  const user = createMemo(() => ask("u"));
  return createComponent(Errored, {
    fallback: e => { const p = getNextElement(tFailed); const [m, c] = getNextMarker(p.firstChild.nextSibling.nextSibling); insert(p, () => e().message, m, c); return p; },
    get children() {
      return createComponent(Loading, {
        get fallback() { return getNextElement(tLoading); },
        get children() { const p = getNextElement(tP); insert(p, () => user()); return p; },
      });
    },
  });
}
window.repro = {
  start() { hydrate(App, document.getElementById("app")); flush(); },
  text: () => [...document.querySelectorAll("#app p")].map(p => p.textContent).join(" | "),
  asked: () => asked.join(","),
};
