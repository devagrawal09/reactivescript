import { compactNow, onCompactChange, reducedMotion } from "./env.js";
import { boxOfId, boxOf, zoomUnder, anchorOf, moduleEl, regionEl } from "./geometry.js";
import { buildMini, drawMiniView } from "./minimap.js";
import { LEVELS, levelFor, overviewLevel, detailLevel, detailZoom, fitCards } from "./layout.js";

const PERSP = 1500, TILT = 10;
const initialCam = () => ({ x: 0, y: 0, s: 1, rx: 0, ry: 0, trx: 0, try: 0, ready: false });
let cam = initialCam();
let level = detailLevel(), pinnedAt = null, readBoard, readModel, publishLevel, onDragStart;
function setLevel(l) {
  if (level === l) return;
  // the stylesheet keys each level off <body>: switch it now, with the camera, not a commit later
  document.body.classList.remove(`lv${level}`); document.body.classList.add(`lv${l}`);
  level = l;
  publishLevel(l);
  zoomPct.title = l === overviewLevel() ? "overview" : "detail";
  if (l === overviewLevel()) fitCards(readBoard().L, fitScale());
}
const syncLevel = () => {
  if (pinnedAt !== cam.s) {
    pinnedAt = null;
    setLevel(levelFor(cam.s, level));
  }
};
let canvas, world, board, floor, zoomPct, disposeCamera;
let vw = 0, vh = 0, BW = 1400, BH = 1000;
const rad = d => d * Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// screen ↔ plane ↔ board. Tilt pivots on the viewport's centre.
function toPlane(sx, sy) {
  const t = rad(TILT + cam.rx), dx = sx - vw / 2, dy = sy - vh / 2;
  const Y = dy * PERSP / (PERSP * Math.cos(t) + dy * Math.sin(t));
  const k = PERSP / (PERSP - Y * Math.sin(t));
  return [dx / k, Y];
}
export function toBoard(sx, sy) { const [X, Y] = toPlane(sx, sy); return [(vw / 2 + X - cam.x) / cam.s, (vh / 2 + Y - cam.y) / cam.s]; }
export function toScreen(bx, by) {
  const t = rad(TILT + cam.rx), X = cam.x + cam.s * bx - vw / 2, Y = cam.y + cam.s * by - vh / 2;
  const k = PERSP / (PERSP - Y * Math.sin(t));
  return [vw / 2 + X * k, vh / 2 + Y * Math.cos(t) * k];
}
function setCamAt(bx, by, s, sx, sy) { const [X, Y] = toPlane(sx, sy); cam.s = s; cam.x = vw / 2 + X - s * bx; cam.y = vh / 2 + Y - s * by; }

// Clear of the header, bar and (unless compact) the HUD columns.
const insets = { t: 64, b: 58 };
function readInsets() {
  const cs = getComputedStyle(document.documentElement);
  insets.t = parseFloat(cs.getPropertyValue("--top-inset")) || 0;
  insets.b = parseFloat(cs.getPropertyValue("--bottom-inset")) || 0;
}
export function freeRect() {
  const t = insets.t, b = vh - insets.b;
  let l = 0, r = vw;
  if (!compactNow()) {
    const side = document.getElementById("side"), mini = document.getElementById("mini"), dev = document.getElementById("devhud");
    if (side && !side.classList.contains("closed")) r = vw - side.offsetWidth - 20;
    if (!document.body.classList.contains("mini-off") && mini?.offsetWidth) l = Math.max(l, mini.offsetLeft + Math.min(mini.offsetWidth, 200) + 8);   // (before the minimap is drawn its canvas has a default size)
    if (dev && !dev.classList.contains("collapsed")) l = Math.max(l, dev.offsetLeft + dev.offsetWidth + 8);
  }
  return { l, t, r, b, w: r - l, h: b - t, cx: (l + r) / 2, cy: (t + b) / 2 };
}
export function onCompact() {
  readInsets();
  if (cam.ready) home();
}

let LZ = 1, crispT = 0;
let fly = null, inertia = null, tickId = 0, camDirty = false;
const pointers = new Map();
let drag = null, pinch = null, suppressClick = false;
export const isMoving = () => !!(fly || inertia || drag?.moved || pinch);
export const isPanning = () => !!(drag?.moved || pinch);

// The board never leaves the screen entirely.
function keepInView() {
  if (!cam.ready) return;
  const fr = freeRect(), m = Math.min(220, fr.h / 3, fr.w / 3) + 80 * cam.s;
  const [lx] = toPlane(fr.l + m, fr.cy), [rx] = toPlane(fr.r - m, fr.cy), [, ty] = toPlane(fr.cx, fr.t + m), [, by] = toPlane(fr.cx, fr.b - m);
  const X0 = cam.x - vw / 2, Y0 = cam.y - vh / 2, w = cam.s * BW, h = cam.s * BH;
  if (X0 > rx) cam.x -= X0 - rx; else if (X0 + w < lx) cam.x += lx - (X0 + w);
  if (Y0 > by) cam.y -= Y0 - by; else if (Y0 + h < ty) cam.y += ty - (Y0 + h);
}
function applyCam() {
  keepInView();
  world.style.transform = `translate(${vw / 2}px,${vh / 2}px) rotateX(${(TILT + cam.rx).toFixed(3)}deg) rotateY(${cam.ry.toFixed(3)}deg) translate(${-vw / 2}px,${-vh / 2}px) translate(${cam.x.toFixed(2)}px,${cam.y.toFixed(2)}px) scale(${(cam.s / LZ).toFixed(5)})`;
  zoomPct.textContent = `${Math.round(cam.s * 100)}%`;
  syncLevel();
  drawMiniView();
  clearTimeout(crispT); crispT = setTimeout(crisp, 70);
}
// Scale the board as one picture while moving; lay it out at the zoom once settled.
function crisp() {
  if (isMoving()) { crispT = setTimeout(crisp, 60); return; }
  const L = Math.round(clamp(cam.s, .3, 3) * 20) / 20;
  if (L === LZ) return;
  LZ = L;
  board.style.zoom = String(L); floor.style.zoom = String(L);
  applyCam();
}
const kick = () => { if (cam.ready && !tickId) tickId = requestAnimationFrame(tick); };
const camChanged = () => { camDirty = true; kick(); };
const ease = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function tick(now) {
  tickId = 0;
  let more = false;
  if (fly) {
    const p = Math.min(1, (now - fly.t0) / fly.dur), e = ease(p);
    const s = fly.s0 * Math.pow(fly.s1 / fly.s0, e);
    setCamAt(fly.b0[0] + (fly.b1[0] - fly.b0[0]) * e, fly.b0[1] + (fly.b1[1] - fly.b0[1]) * e, s, fly.tx, fly.ty);
    camDirty = true;
    if (p < 1) more = true; else fly = null;
  }
  if (inertia) {
    const dt = Math.min(40, now - inertia.t); inertia.t = now;
    cam.x += inertia.vx * dt; cam.y += inertia.vy * dt;
    const f = Math.exp(-dt / 230); inertia.vx *= f; inertia.vy *= f;
    camDirty = true;
    if (Math.hypot(inertia.vx, inertia.vy) > .01) more = true; else inertia = null;
  }
  if (Math.abs(cam.trx - cam.rx) > .005 || Math.abs(cam.try - cam.ry) > .005) {
    cam.rx += (cam.trx - cam.rx) * .1; cam.ry += (cam.try - cam.ry) * .1; camDirty = true; more = true;
  }
  if (camDirty) { camDirty = false; applyCam(); }
  if (more) kick();
}
function flyTo(bx, by, s = cam.s, dur = 560) {
  if (!cam.ready) return;
  const fr = freeRect();
  inertia = null;
  // no flight: the camera (and with it the level) is there now, not on the next frame, as zoomAt does
  if (reducedMotion() || !dur) { setCamAt(bx, by, s, fr.cx, fr.cy); fly = null; camDirty = false; applyCam(); return; }
  fly = { t0: performance.now(), dur, s0: cam.s, s1: s, b0: toBoard(fr.cx, fr.cy), b1: [bx, by], tx: fr.cx, ty: fr.cy };
  kick();
}
export function flyToBox(box, scale) {
  if (box) flyTo(box.x, box.y, scale ?? clamp(Math.max(cam.s, .9), .3, 2.6));
}
export function flyToId(id, mode) {
  const s = mode === "dbl" ? clamp(Math.max(cam.s * 1.25, 1.15), .3, 2.2)
    : mode === "search" ? Math.max(cam.s, detailZoom() + .03)
    : mode === "select" && level !== detailLevel() ? detailZoom() + .1 : undefined;
  flyToBox(boxOfId(id), s);
}
export function flyToModule(ev) {
  const el = ev.target.closest(".module"), p = el && readBoard().L.plates.get(+el.dataset.mod);
  if (!p) return;
  const fr = freeRect(), s = clamp(Math.min(fr.w / p.w, fr.h / Math.min(p.h, 900)) * .92, detailZoom() + .02, 1.2);
  flyTo(p.x + p.w / 2, p.y + Math.min(p.h, fr.h / s) / 2, s);
}
function fitScale() {
  const fr = freeRect(), m = compactNow() ? 10 : 28, { x, y, s } = cam;
  const fits = s => {
    setCamAt(BW / 2, BH / 2, s, fr.cx, fr.cy);
    return [[0, 0], [BW, 0], [0, BH], [BW, BH]].every(([x, y]) => {
      const [sx, sy] = toScreen(x, y);
      return sx >= fr.l + m && sx <= fr.r - m && sy >= fr.t + m && sy <= fr.b - m;
    });
  };
  let lo = .02, hi = 1.6;
  for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
  Object.assign(cam, { x, y, s });
  return lo;
}
export function frameAll(dur = 600) { flyTo(BW / 2, BH / 2, Math.min(fitScale(), 1), dur); }
export function isFramed() {
  const fr = freeRect(), [bx, by] = toBoard(fr.cx, fr.cy);
  return Math.abs(bx - BW / 2) < 4 && Math.abs(by - BH / 2) < 4;
}
export function home() {
  if (!cam.ready) return;
  const fr = freeRect(), fit = fitScale(), L = readBoard().L;
  if (compactNow() && fit < .55 && document.querySelectorAll(".module").length > 1) {
    const s = Math.min(clamp((fr.w - 12) / BW, .35, 1), Math.max(.7, fr.h / 520));
    const row = L.rows.find(r => !r.keys.includes("world")) ?? L.rows[0];
    const p = L.plates.get(row?.keys[0]);
    if (p) setCamAt(p.x + p.w / 2, p.y, s, fr.cx, fr.t + 8 + 8 * s);
    else setCamAt(BW / 2, 0, s, fr.cx, fr.t + 8);
  } else setCamAt(BW / 2, BH / 2, Math.min(fit, 1), fr.cx, fr.cy);
  camChanged();
}
function zoomAt(sx, sy, f) {
  const [bx, by] = toBoard(sx, sy);
  fly = null;
  setCamAt(bx, by, clamp(cam.s * f, .08, 2.6), sx, sy);
  camDirty = false; applyCam();   // now, not next frame: the wheel feels direct
}
export function zoomBy(f) {
  const fr = freeRect(), [bx, by] = toBoard(fr.cx, fr.cy);
  flyTo(bx, by, clamp(cam.s * f, .08, 2.6), 260);
}
export function ensureVisibleId(id) {
  const b = boxOfId(id); if (!b) return;
  const [x, y] = toScreen(b.x, b.y), fr = freeRect();
  if (x < fr.l + 60 || x > fr.r - 60 || y < fr.t + 40 || y > fr.b - 60) flyTo(b.x, b.y, cam.s, 380);
}
export function centreOn(bx, by) {
  if (!cam.ready) return;
  const fr = freeRect();
  setCamAt(bx, by, cam.s, fr.cx, fr.cy);
  fly = null; inertia = null; camChanged();
}

// Drag pans with inertia, two fingers pinch, a still pointer tilts the world.
function pointerDown(ev) {
  if (ev.pointerType === "mouse" && ev.button !== 0) return;
  suppressClick = false;
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  fly = null; inertia = null;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), m: [(a.x + b.x) / 2, (a.y + b.y) / 2] };
    drag = null;
    onDragStart();
  } else drag = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY, moved: false, samples: [] };
}
function pointerMove(ev) {
  if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), m = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    const [X0, Y0] = toPlane(...pinch.m), [X1, Y1] = toPlane(...m);
    cam.x += X1 - X0; cam.y += Y1 - Y0;
    zoomAt(m[0], m[1], d / pinch.d);
    pinch = { d, m }; suppressClick = true;
    return;
  }
  if (drag && ev.pointerId === drag.id) {
    if (!drag.moved && Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) > 4) {
      drag.moved = true; canvas.setPointerCapture(ev.pointerId); canvas.classList.add("grabbing");
      document.getElementById("tip")?.classList.remove("on");
      onDragStart();
    }
    if (drag.moved) {
      const [X0, Y0] = toPlane(drag.x, drag.y), [X1, Y1] = toPlane(ev.clientX, ev.clientY);
      cam.x += X1 - X0; cam.y += Y1 - Y0;
      drag.x = ev.clientX; drag.y = ev.clientY;
      const t = performance.now();
      drag.samples.push({ t, dx: X1 - X0, dy: Y1 - Y0 });
      while (drag.samples.length && t - drag.samples[0].t > 90) drag.samples.shift();
      camChanged();
    }
    return;
  }
  if (ev.pointerType === "mouse" && !reducedMotion()) {
    cam.try = (ev.clientX / vw - .5) * 3.2;
    cam.trx = -(ev.clientY / vh - .5) * 2.2;
    kick();
  }
}
function endPointer(ev) {
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) pinch = null;
  if (drag && ev.pointerId === drag.id) {
    if (drag.moved) {
      suppressClick = true;
      canvas.classList.remove("grabbing");
      const s = drag.samples, t = performance.now();
      if (!reducedMotion() && s.length > 1 && t - s.at(-1).t < 60) {
        const span = Math.max(16, s.at(-1).t - s[0].t);
        const vx = s.reduce((a, x) => a + x.dx, 0) / span, vy = s.reduce((a, x) => a + x.dy, 0) / span;
        if (Math.hypot(vx, vy) > .05) { inertia = { vx, vy, t }; kick(); }
      }
    }
    drag = null;
  }
}
function pointerLeave() { cam.trx = 0; cam.try = 0; kick(); }
function click(ev) { if (suppressClick) { ev.stopPropagation(); ev.preventDefault(); suppressClick = false; } }
let padUntil = 0;
const WHEEL_STEP = 1.13;   // a mouse wheel notch's zoom (6 notches: ×2.1)
function wheelKind(ev, now = performance.now()) {
  if (ev.ctrlKey || ev.metaKey) return "zoom";
  if (ev.shiftKey) return "sideways";
  if (ev.deltaMode !== 0) return "zoom";
  const steppy = ev.deltaX === 0 && Number.isInteger(ev.deltaY) && Math.abs(ev.deltaY) >= 50;
  if (!steppy) padUntil = now + 400;
  return steppy && now > padUntil ? "zoom" : "pan";
}
function wheel(ev) {
  ev.preventDefault();
  const unit = ev.deltaMode === 1 ? 33 : ev.deltaMode === 2 ? vh : 1;
  const kind = wheelKind(ev);
  if (kind === "zoom") {
    // a pinch (ctrl + small pixel deltas): proportional, as the fingers move. A mouse wheel: one gentle step per
    // notch, whatever deltaY / deltaMode the device sends (100, 120, 3 lines, an accelerated 500…): ×WHEEL_STEP.
    const pinch = ev.ctrlKey && ev.deltaMode === 0 && Math.abs(ev.deltaY) < 50;
    const f = pinch ? Math.exp(-ev.deltaY * .01) : ev.deltaY === 0 ? 1 : ev.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
    const cap = pinch ? 1.25 : WHEEL_STEP;
    zoomAt(ev.clientX, ev.clientY, Math.min(cap, Math.max(1 / cap, f)));
    return;
  }
  fly = null; inertia = null;
  if (kind === "sideways") cam.x -= (ev.deltaX || ev.deltaY) * unit;
  else { cam.x -= ev.deltaX * unit; cam.y -= ev.deltaY * unit; }
  camDirty = false; applyCam();
}
function resize() { vw = innerWidth; vh = innerHeight; readInsets(); camChanged(); }

// After layout: the board's size, the floor under it, the minimap, the edges.
let layoutRaf = 0;
const layoutListeners = new Set();
function measureBoard() { ({ width: BW, height: BH } = readBoard().L); }
export function layoutChanged() {
  if (!cam.ready) return;
  cancelAnimationFrame(layoutRaf);
  layoutRaf = requestAnimationFrame(() => {
    layoutRaf = 0;
    measureBoard();
    const m = 700;
    Object.assign(floor.style, { left: `${-m}px`, top: `${-m}px`, width: `${BW + 2 * m}px`, height: `${BH + 2 * m}px` });
    buildMini(readBoard().L, readModel());
    fitCards(readBoard().L, fitScale());
    for (const f of layoutListeners) f();
  });
}
export function onLayout(f) { layoutListeners.add(f); return () => { layoutListeners.delete(f); }; }

export function startCamera(access) {
  if (disposeCamera) return disposeCamera;
  canvas = document.getElementById("canvas"); world = document.getElementById("world");
  board = document.getElementById("board"); floor = document.getElementById("floor");
  zoomPct = document.getElementById("zoomPct");
  vw = innerWidth; vh = innerHeight;
  readInsets();
  ({ board: readBoard, model: readModel, level: publishLevel, drag: onDragStart } = access);
  document.body.classList.add(`lv${level}`);
  measureBoard();
  const events = [
    ["pointerdown", pointerDown], ["pointermove", pointerMove], ["pointerup", endPointer],
    ["pointercancel", endPointer], ["pointerleave", pointerLeave], ["click", click, true], ["wheel", wheel, { passive: false }],
  ];
  for (const event of events) canvas.addEventListener(...event);
  window.addEventListener("resize", resize);
  const offCompact = onCompactChange(onCompact);
  cam.ready = true;
  window.__RX_MAP__ = {
    get layout() { return readBoard().L; }, get analysis() { return readModel().A; },
    get BW() { return BW; }, get BH() { return BH; }, get cam() { return cam; }, get level() { return level; },
    setLevel(l) { pinnedAt = cam.s; setLevel(l); },
    flyTo, frameAll, zoomAt, freeRect, toScreen, boxOf, anchor: anchorOf, module: moduleEl, region: regionEl, zoomUnder, LEVELS,
    // The edge view draws on the RX commit, not on an animation frame.
    draw: () => new Promise(r => setTimeout(r, 0)),
  };
  home();
  layoutChanged();

  const dispose = () => {
    if (disposeCamera !== dispose) return;
    for (const event of events) canvas.removeEventListener(...event);
    window.removeEventListener("resize", resize);
    offCompact();
    delete window.__RX_MAP__;
    cancelAnimationFrame(layoutRaf); cancelAnimationFrame(tickId); clearTimeout(crispT);
    layoutRaf = tickId = crispT = 0;
    for (const id of pointers.keys()) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    pointers.clear();
    layoutListeners.clear();
    canvas.classList.remove("grabbing");
    board.style.zoom = floor.style.zoom = "";
    LZ = 1;
    cam = initialCam();
    level = detailLevel(); pinnedAt = null;
    fly = inertia = drag = pinch = null;
    camDirty = suppressClick = false;
    canvas = world = board = floor = zoomPct = disposeCamera = undefined;
  };
  return disposeCamera = dispose;
}
