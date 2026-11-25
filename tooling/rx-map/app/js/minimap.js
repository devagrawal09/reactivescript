import { centreOn, freeRect, toBoard } from "./camera.js";
import { boardSize, boxOf } from "./geometry.js";
import { FAM, FAM_HEX } from "./vocab.js";

let minic, miniInfo, mctx, miniImg, disposeMinimap;
let miniK = 1, DPR = 1, pointerId = null;

// Plates and tokens are drawn once per layout, the footprint every frame.
export function buildMini() {
  const board = document.getElementById("board");
  if (!mctx || !board) return;
  const { w: BW, h: BH } = boardSize();
  if (!BW || !BH) return;
  miniK = Math.min(170 / BW, 190 / BH);
  const w = Math.max(40, Math.round(BW * miniK)), h = Math.max(30, Math.round(BH * miniK));
  minic.width = w * DPR; minic.height = h * DPR; minic.style.width = `${w}px`; minic.style.height = `${h}px`;
  miniImg = document.createElement("canvas"); miniImg.width = minic.width; miniImg.height = minic.height;
  const c = miniImg.getContext("2d"); c.scale(DPR * miniK, DPR * miniK);
  c.fillStyle = "rgba(10,13,19,.6)"; c.fillRect(0, 0, BW, BH);
  for (const p of board.querySelectorAll(".frame.module, .worldrow")) {
    const b = boxOf(p); if (!b) continue;
    c.fillStyle = p.classList.contains("worldrow") ? "rgba(148,163,184,.10)" : "rgba(90,115,170,.20)";
    c.strokeStyle = "rgba(150,180,255,.35)"; c.lineWidth = 1 / miniK;
    c.beginPath(); c.roundRect?.(b.l, b.t, b.r - b.l, b.b - b.t, 14) ?? c.rect(b.l, b.t, b.r - b.l, b.b - b.t); c.fill(); c.stroke();
  }
  const seen = new Set();
  for (const el of board.querySelectorAll(".chip[data-id], .ctag[data-id], .flabel[data-id]")) {
    const id = el.dataset.id;
    if (seen.has(id)) continue;
    seen.add(id);
    if (!el.classList.contains("chip")) continue;
    const b = boxOf(el); if (!b) continue;
    const kind = [...el.classList].find(k => k.startsWith("k-"))?.slice(2);
    c.fillStyle = FAM_HEX[FAM[kind] ?? "outside"];
    c.globalAlpha = el.classList.contains("site") ? .55 : .95;
    c.fillRect(b.l, b.t, Math.max(b.r - b.l, 6 / miniK), Math.max(b.b - b.t, 4 / miniK));
  }
  c.globalAlpha = 1;
  if (miniInfo) miniInfo.textContent = `${board.querySelectorAll(".chip").length} tokens`;
  drawMiniView();
}
export function drawMiniView() {
  if (!miniImg) return;
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.clearRect(0, 0, minic.width, minic.height);
  mctx.drawImage(miniImg, 0, 0);
  const fr = freeRect();
  const pts = [[fr.l, fr.t], [fr.r, fr.t], [fr.r, fr.b], [fr.l, fr.b]].map(([x, y]) => toBoard(x, y));
  mctx.setTransform(DPR * miniK, 0, 0, DPR * miniK, 0, 0);
  mctx.beginPath(); pts.forEach(([x, y], i) => (i ? mctx.lineTo(x, y) : mctx.moveTo(x, y))); mctx.closePath();
  mctx.fillStyle = "rgba(160,195,255,.10)"; mctx.fill();
  mctx.strokeStyle = "rgba(190,215,255,.95)"; mctx.lineWidth = 1.3 / miniK; mctx.stroke();
}
function miniGo(ev) {
  const r = minic.getBoundingClientRect();
  centreOn((ev.clientX - r.left) / miniK, (ev.clientY - r.top) / miniK);
}
function pointerDown(ev) {
  if (pointerId !== null) return;
  minic.setPointerCapture(ev.pointerId);
  pointerId = ev.pointerId;
  miniGo(ev);
}
function pointerMove(ev) { if (ev.pointerId === pointerId) miniGo(ev); }
function endPointer(ev) { if (ev.pointerId === pointerId) pointerId = null; }

export function startMinimap() {
  if (disposeMinimap) return disposeMinimap;
  minic = document.getElementById("minic");
  miniInfo = document.getElementById("miniInfo");
  if (!minic) return () => {};
  mctx = minic.getContext("2d");
  DPR = Math.min(2, devicePixelRatio || 1);
  const events = [
    ["pointerdown", pointerDown], ["pointermove", pointerMove], ["pointerup", endPointer],
    ["pointercancel", endPointer], ["lostpointercapture", endPointer],
  ];
  for (const event of events) minic.addEventListener(...event);
  buildMini();
  const dispose = () => {
    if (disposeMinimap !== dispose) return;
    for (const event of events) minic.removeEventListener(...event);
    if (pointerId !== null && minic.hasPointerCapture(pointerId)) minic.releasePointerCapture(pointerId);
    pointerId = null;
    minic = miniInfo = mctx = miniImg = disposeMinimap = undefined;
  };
  return disposeMinimap = dispose;
}
