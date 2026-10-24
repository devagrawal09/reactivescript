import { createSignal, createMemo, createComponent, Loading, flush } from "solid-js";
import { hydrate, render, template, getNextElement, insert } from "@solidjs/web";
const flights = new Map();
const ask = key => { if (!flights.has(key)) { let resolve; const p = new Promise(r => (resolve = r)); flights.set(key, { p, resolve }); } return flights.get(key).p; };
const tLoading = template(`<p>loading`), tP = template(`<p>`);
let setId;
function App() {
  const [id, set] = createSignal(0); setId = set;
  const details = createMemo(() => ask("d:" + id()));
  return createComponent(Loading, {
    get fallback() { return getNextElement(tLoading); },
    get children() { const p = getNextElement(tP); insert(p, () => String(details())); return p; },
  });
}
window.repro = {
  start(mode) { (mode === "hydrate" ? hydrate : render)(App, document.getElementById("app")); flush(); },
  land(key, v) { const f = flights.get(key); if (!f) return false; f.resolve(v); return true; },
  setId(v) { setId(v); flush(); },
  text: () => [...document.querySelectorAll("#app p")].map(p => p.textContent).join(" | "),
};
