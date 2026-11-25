import { loadText, saveText } from "./env.js";

// Small synthesized cues, after the first gesture, quiet, and muted from the HUD.
const SOUND_KEY = "rx-map:sound";
const snd = { on: loadText(SOUND_KEY) === "on", ctx: null, out: null, armed: false, last: new Map(), queue: [], qraf: 0 };

export function startSound() {
  const arm = () => { snd.armed = true; };
  addEventListener("pointerdown", arm, true);
  addEventListener("keydown", arm, true);
  return () => {
    removeEventListener("pointerdown", arm, true);
    removeEventListener("keydown", arm, true);
    if (snd.qraf) cancelAnimationFrame(snd.qraf);
    snd.qraf = 0;
    snd.queue.length = 0;
    snd.last.clear();
    snd.armed = false;
    snd.ctx?.close();
    snd.ctx = snd.out = null;
  };
}
export const soundOn = () => snd.on;
export function setSound(on) {
  const was = snd.on;
  snd.on = on;
  saveText(SOUND_KEY, on ? "on" : "off");
  if (on && !was) sfx("toggle");
}

function ac() {
  if (!snd.on || !snd.armed) return null;
  if (!snd.ctx) {
    try {
      snd.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const comp = snd.ctx.createDynamicsCompressor();
      snd.out = snd.ctx.createGain(); snd.out.gain.value = .22;
      snd.out.connect(comp); comp.connect(snd.ctx.destination);
    } catch { snd.on = false; return null; }
  }
  if (snd.ctx.state === "suspended") snd.ctx.resume();
  return snd.ctx;
}
function blip({ f = 660, f2 = f, at = 0, dur = .09, type = "sine", vol = .3, attack = .004, lp = 0 }) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + at + .005;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2 !== f) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  let node = o;
  if (lp) { const fl = c.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = lp; o.connect(fl); node = fl; }
  node.connect(g); g.connect(snd.out); o.start(t); o.stop(t + dur + .03);
}
const limit = (k, ms) => { const now = performance.now(); if (now - (snd.last.get(k) ?? -1e9) < ms) return false; snd.last.set(k, now); return true; };
const PITCH = { state: 392, derived: 523.25, imperative: 659.25, outside: 329.63, structure: 440, failure: 293.66 };
const SFX = {
  hover: () => limit("hover", 60) && blip({ f: 2300, dur: .022, vol: .06, type: "triangle" }),
  select: () => { blip({ f: 660, dur: .07, vol: .2 }); blip({ f: 990, at: .045, dur: .1, vol: .16 }); },
  deselect: () => blip({ f: 740, f2: 520, dur: .08, vol: .12 }),
  toggle: () => limit("toggle", 40) && blip({ f: 1350, f2: 1000, dur: .04, vol: .12, type: "triangle" }),
  // A burst of flushes is one chord per frame: each family once, as its pulse lands.
  note(f, at) {
    snd.queue.push([f, at]);
    if (!snd.qraf) snd.qraf = requestAnimationFrame(() => {
      snd.qraf = 0;
      const q = snd.queue.splice(0);
      if (!limit("flush", 90)) return;
      const seen = new Set();
      for (const [p, a] of q.sort((x, y) => x[1] - y[1])) {
        if (seen.has(p) || seen.size >= 4) continue;
        seen.add(p);
        blip({ f: p, at: a, dur: .16, vol: .1, type: "sine" });
        blip({ f: p * 2, at: a, dur: .06, vol: .025, type: "triangle" });
      }
    });
  },
  flightStart: () => limit("fs", 80) && blip({ f: 330, f2: 620, dur: .2, vol: .06, attack: .04 }),
  land: () => limit("fl", 60) && (blip({ f: 880, f2: 520, dur: .12, vol: .09 }), blip({ f: 1760, at: .09, dur: .03, vol: .05, type: "triangle" })),
  abandon: () => limit("fa", 80) && blip({ f: 300, f2: 170, dur: .22, vol: .07, type: "triangle", lp: 900 }),
  rewind: dir => limit("rw", 120) && blip({ f: dir === "back" ? 900 : 220, f2: dir === "back" ? 200 : 880, dur: .3, vol: .05, type: "sawtooth", lp: 1500, attack: .03 }),
  denied: () => limit("dn", 200) && (blip({ f: 180, dur: .07, vol: .1, type: "square", lp: 700 }), blip({ f: 160, at: .09, dur: .08, vol: .1, type: "square", lp: 700 })),
  plan: () => { blip({ f: 523.25, dur: .12, vol: .08 }); blip({ f: 659.25, at: .08, dur: .16, vol: .07 }); },
  hmr: () => [392, 493.88, 587.33, 783.99].forEach((f, i) => blip({ f, at: i * .06, dur: .38 - i * .04, vol: .09, type: i % 2 ? "triangle" : "sine", attack: .01 })),
};

export function sfx(name, arg) { if (name !== "note" && Object.hasOwn(SFX, name)) SFX[name](arg); }
export const sfxDir = sfx;
export function note(family, atSeconds) { SFX.note(Object.hasOwn(PITCH, family) ? PITCH[family] : 440, atSeconds); }
