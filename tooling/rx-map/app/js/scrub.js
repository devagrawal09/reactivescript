// The timeline under the map (map.html's renderScrub, atX, causeColor, trackSeq, the track's pointer and keys, and
// travel's 70 ms throttle). The canvas and the playhead are drawn from the live mirror (livestate.js); the label, the
// LIVE button and the aria values are live.rx's.
import { mirror } from "./livestate.js";
import { post } from "./transport.js";
import { famOf, FAM_HEX } from "./vocab.js";

const padX = 6;
let tW = 0, tH = 0;
const DPR = () => Math.min(2, window.devicePixelRatio || 1);
const els = () => ({ track: document.getElementById("track"), trackc: document.getElementById("trackc"), playhead: document.getElementById("playhead") });
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function sizeScrub() {
  const { track, trackc } = els();
  if (!track || !trackc) return;
  tW = track.clientWidth; tH = track.clientHeight;
  trackc.width = tW * DPR(); trackc.height = tH * DPR();
}
const shownSeq = tl => tl.target ?? tl.viewing ?? tl.head;
const seqX = (n, i) => padX + (n > 1 ? i / (n - 1) : 1) * (tW - 2 * padX);
function atX(s, at) {
  if (!s.length) return padX;
  if (at <= s[0].at) return seqX(s.length, 0);
  if (at >= s[s.length - 1].at) return seqX(s.length, s.length - 1);
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m].at <= at) lo = m; else hi = m; }
  return seqX(s.length, lo + (at - s[lo].at) / Math.max(1e-6, s[hi].at - s[lo].at));
}
function causeColor(M, s) {
  const id = s.cause && M.keyIds.get(s.cause)?.[0];
  if (id) return FAM_HEX[famOf(M.nodes.get(id))];
  const k = s.changes?.find(c => c?.key && M.keyIds.has(c.key))?.key;
  return k ? FAM_HEX[famOf(M.nodes.get(M.keyIds.get(k)[0]))] : "rgba(226,232,240,.6)";
}

/** Draws the timeline: flights, a tick per flush, module replacements, the playhead. */
export function renderScrub(M) {
  const { trackc, playhead } = els();
  if (!trackc || !playhead) return;
  if (!tW) sizeScrub();
  const tl = mirror().tl;
  const c = trackc.getContext("2d");
  if (!c) return;
  const dpr = DPR();
  c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, tW, tH);
  c.fillStyle = "rgba(150,180,255,.12)"; c.fillRect(padX, tH / 2 - .5, tW - 2 * padX, 1);
  const steps = tl.steps, n = steps.length, cur = shownSeq(tl);
  if (!n) { playhead.style.left = `${tW - padX}px`; return; }
  // flights: amber spans under the ticks
  c.fillStyle = "rgba(251,191,36,.75)";
  let row = 0;
  for (const f of tl.flights.slice(-60)) {
    const x0 = atX(steps, f.start), x1 = f.end == null ? tW - padX : atX(steps, f.end);
    c.globalAlpha = f.state === "abandon" ? .35 : .85;
    c.fillRect(x0, tH - 6 - (row++ % 2) * 3, Math.max(2, x1 - x0), 2);
  }
  c.globalAlpha = 1;
  // a tick per flush, in the colour of its cause; the past beyond the one shown dims (the step shown, or the nearest
  // one before it: a seq outside the recorded steps must not leave the head behind)
  let iCur = steps.findLastIndex(s => s.seq <= cur);
  if (iCur < 0) iCur = 0;
  const every = Math.max(1, Math.floor(n / Math.max(1, tW - 2 * padX)));
  for (let i = 0; i < n; i += every) {
    const s = steps[i], x = seqX(n, i), big = s.changes?.length > 3;
    c.globalAlpha = i > iCur ? .3 : .95;
    c.fillStyle = causeColor(M, s);
    c.fillRect(Math.round(x) - .75, tH / 2 - (big ? 8 : 5), 1.5, big ? 16 : 10);
  }
  c.globalAlpha = 1;
  // module replacements: diamonds above
  c.fillStyle = "#e2e8f0";
  for (const h of tl.hmrs) {
    const i = steps.findIndex(s => s.seq >= h.seq); const x = i < 0 ? seqX(n, n - 1) : seqX(n, i);
    c.beginPath(); c.moveTo(x, 1); c.lineTo(x + 3.5, 4.5); c.lineTo(x, 8); c.lineTo(x - 3.5, 4.5); c.closePath(); c.fill();
  }
  playhead.style.left = `${seqX(n, iCur)}px`;
}

/** Keeps the canvas sized to the track and redrawn (`draw`) when it resizes. Returns the stop. */
export function startScrub(draw) {
  const { track } = els();
  if (!track) return () => {};
  const ro = new ResizeObserver(() => { sizeScrub(); draw(); });
  ro.observe(track);
  sizeScrub();
  return () => ro.disconnect();
}

// ---- travel ----------------------------------------------------------------------------------------------------
/** What travelling to `seq` means now: "resume" (the head, while viewing), "stay" (already there) or "go". */
export function travelKind(seq) {
  const tl = mirror().tl;
  if (seq == null) return "stay";
  if (seq >= tl.head && tl.viewing != null) return "resume";
  if (seq === (tl.viewing ?? tl.head) && tl.target == null) return "stay";
  return "go";
}
/** The seq `n` steps from the one shown (or -1 for "resume", -2 for nothing to do). */
export function seqBy(n) {
  const tl = mirror().tl;
  const seqs = tl.steps.map(s => s.seq);
  if (!seqs.length) return -2;
  let i = seqs.indexOf(shownSeq(tl)); if (i < 0) i = seqs.length - 1;
  const j = clamp(i + n, 0, seqs.length - 1);
  if (j === seqs.length - 1 && n > 0 && tl.viewing != null) return -1;
  return seqs[j];
}
/** The first recorded seq, or -2. */
export const firstSeq = () => mirror().tl.steps[0]?.seq ?? -2;

let lastTravel = 0, travelTimer = 0;
/** Sends `travel` to the host: dragging sends at most every 70 ms; the last one always goes (to the target then). */
export function sendTravel(seq) {
  clearTimeout(travelTimer);
  const go = () => { lastTravel = performance.now(); post({ type: "travel", to: mirror().tl.target ?? seq }); };
  if (performance.now() - lastTravel > 70) go(); else travelTimer = setTimeout(go, 70);
}

// the step under the pointer
function trackSeq(ev) {
  const { track } = els();
  const r = track.getBoundingClientRect(), steps = mirror().tl.steps, n = steps.length;
  if (!n) return null;
  const i = clamp(Math.round((ev.clientX - r.left - padX) / Math.max(1, r.width - 2 * padX) * (n - 1)), 0, n - 1);
  return { seq: steps[i].seq, last: i === n - 1 };
}
/** Drag on the track to travel; ← / → step, Home goes to the first, End resumes. Returns the stop. */
export function startTrack(on) {
  const { track } = els();
  if (!track) return () => {};
  const down = ev => {
    try { track.setPointerCapture(ev.pointerId); } catch {}
    const go = e => { const t = trackSeq(e); if (t) (t.last && mirror().tl.viewing != null && e.type === "pointerup" ? on.resume() : on.travel(t.seq)); };
    go(ev);
    track.onpointermove = go;
    track.onpointerup = e => { track.onpointermove = null; track.onpointerup = null; go(e); };
  };
  const key = ev => {
    if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") { ev.preventDefault(); ev.stopPropagation(); on.travelBy(ev.key === "ArrowLeft" ? -1 : 1); }
    else if (ev.key === "Home") { ev.preventDefault(); const s = firstSeq(); if (s >= 0) on.travel(s); }
    else if (ev.key === "End") { ev.preventDefault(); on.resume(); }
  };
  track.addEventListener("pointerdown", down);
  track.addEventListener("keydown", key);
  return () => { track.removeEventListener("pointerdown", down); track.removeEventListener("keydown", key); };
}
