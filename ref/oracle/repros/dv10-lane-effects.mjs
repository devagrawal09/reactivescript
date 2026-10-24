// DV-10: a held optimistic lane holds only the render effects that read its pending work.
// Expected (spec H-7/H-11; Solid's D-25 "an on-screen probe in a held lane keeps what it showed"): while `derived(5)` is
// pending, every reader of the guess's lane keeps what it showed — the screen stays "1 x1 / 1".
// node --conditions=browser --conditions=development repros/dv10-lane-effects.mjs [one|two]
//   one: one render effect reads guess, derived and latest(guess) — as one effect per element
//   two: `latest(guess)` has its own effect — as compiled JSX gives each `{…}` child its own insert
import { createRoot, createSignal, createMemo, createOptimistic, createRenderEffect, action, latest, flush } from "@solidjs/signals";

const flights = new Map();
const ask = key => { if (!flights.has(key)) { let resolve; const p = new Promise(r => (resolve = r)); flights.set(key, { p, resolve }); } return flights.get(key).p; };
const tick = async () => { await new Promise(r => setTimeout(r, 0)); flush(); await new Promise(r => setTimeout(r, 0)); flush(); };
const land = async (key, v) => { flights.get(key).resolve(v); await tick(); };
const mode = process.argv[2] ?? "two";

const [truth] = createSignal(1);
let screen = { a: "", b: "" }; let attempt;
createRoot(() => {
  const [base] = createSignal(() => truth());
  const [guess, setGuess] = createOptimistic(() => base());
  const derived = createMemo(() => ask("x:" + guess()));
  attempt = action(function* () { setGuess(5); yield ask("unrelated"); });
  if (mode === "one") createRenderEffect(() => `${guess()} ${derived()} / ${latest(guess)}`, v => { screen = { a: v, b: "" }; });
  else {
    createRenderEffect(() => `${guess()} ${derived()}`, v => { screen.a = v; });
    createRenderEffect(() => latest(guess), v => { screen.b = String(v); });
  }
});
flush();
const show = label => console.log(label.padEnd(22), JSON.stringify(mode === "one" ? screen.a : `${screen.a} / ${screen.b}`));
await tick(); await land("x:1", "x1"); show("x(1) lands");
attempt(); flush(); await tick(); show("attempt()");            // expected "1 x1 / 1" in both modes
