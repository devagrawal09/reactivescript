// The client half, as Solid's compiler emits it for the DOM with hydration.
import { createSignal, createMemo, createComponent, Errored, flush } from "solid-js";
import { hydrate, render, template, getNextElement, insert } from "@solidjs/web";
const flights = new Map(); const asked = [];
const ask = key => { asked.push(key); if (!flights.has(key)) { let resolve; const p = new Promise(r => (resolve = r)); flights.set(key, { p, resolve }); } return flights.get(key).p; };
const tP = template(`<p>`);
let setSel;
function App() {
  const [sel, set] = createSignal(4); setSel = set;
  const item = createMemo(() => ask("i:" + sel()));
  const shown = createMemo(() => { const v = item(); if (v == null) throw new Error(`item ${sel()} not found`); return v; });
  return createComponent(Errored, {
    fallback: e => { const p = getNextElement(tP); insert(p, () => e().message); return p; },
    get children() { const p = getNextElement(tP); insert(p, () => shown()); return p; },
  });
}
window.repro = {
  start(mode) { (mode === "hydrate" ? hydrate : render)(App, document.getElementById("app")); flush(); },
  land(key, v) { const f = flights.get(key); if (!f) return false; f.resolve(v); return true; },
  setSel(v) { setSel(v); flush(); },
  text: () => [...document.querySelectorAll("#app p")].map(p => p.textContent).join(" | "),
  asked: () => asked.join(","),
};
