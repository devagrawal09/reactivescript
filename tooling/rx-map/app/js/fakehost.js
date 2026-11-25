// The in-page fake host (`?fake=<seed>`, map.html's startFake): fake.mjs's createFakeHost behind `window.__RX_FAKE__`,
// with time moving in ticks, and what the dev HUD (live.rx DevHud) drives it with.
import * as FAKE_LIB from "rx-map:fake";
import { bodyClass } from "./env.js";

window.__RX_FAKE_LIB__ = FAKE_LIB;
const fake = { host: null, timer: 0, n: 0, every: 0, paused: false };

/** Starts the fake host on (a copy of) `graph`; returns the stop. Call before the page says hello. */
export function startFake(graph, seed) {
  const h = (fake.host = FAKE_LIB.createFakeHost(JSON.parse(JSON.stringify(graph)), { seed, failRate: .12 }));
  window.__RX_FAKE__ = h;
  bodyClass("fake", true);
  // time moves in ticks: requests land, and auto-play acts every few
  fake.timer = setInterval(() => { if (fake.paused) return; h.tick(1); fake.n++; if (fake.every && fake.n % fake.every === 0) h.act(); }, 200);
  window.__RX_FAKE_CTL__ = { pause: () => (fake.paused = true), play: () => (fake.paused = false), host: h };
  return () => { clearInterval(fake.timer); try { h.dispose?.(); } catch {} };
}
/** Runs an action (by key; "" for a random one). */
export function fakeAct(key) { fake.host?.act(key || undefined); }
/** Auto-play: an action every `n` ticks (0: off). */
export function fakeEvery(n) { fake.every = n; }
/** Edits a module ("next" lets the host choose the edit). */
export function fakeEdit(mod, op) { fake.host?.editModule(mod, op === "next" ? undefined : op); }
export function fakeTick(n) { fake.host?.tick(n); }
/** The value of a <select> by id (the HUD's selects are left to the browser). */
export function selectValue(id) { return document.getElementById(id)?.value ?? ""; }
