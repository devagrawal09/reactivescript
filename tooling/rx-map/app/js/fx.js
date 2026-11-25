import { reducedMotion } from "./env.js";
import { edgeStyle } from "./vocab.js";
import { anchorOf, boxOf, boxOfId, flowPath } from "./geometry.js";

const byId = id => document.getElementById(id);
function restart(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// A comet runs the way data moves, on the plate surface.
export function comet(fromId, toId, delay, dur, color = "#fff") {
  if (reducedMotion()) return;
  const S = boxOfId(fromId), D = boxOfId(toId);
  const trails = byId("trails"), fx = byId("fx");
  if (!S || !D || !trails || !fx) return;
  const d = flowPath(S, D);
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", d); p.setAttribute("fill", "none"); p.setAttribute("stroke", color); p.setAttribute("stroke-width", "2.4"); p.setAttribute("stroke-linecap", "round");
  trails.append(p);
  const len = p.getTotalLength();
  p.style.strokeDasharray = `${len}`; p.style.strokeDashoffset = `${len}`; p.style.opacity = "0";
  const easing = "cubic-bezier(.45,0,.25,1)";
  p.animate([{ strokeDashoffset: len, opacity: .9 }, { strokeDashoffset: 0, opacity: .55, offset: .7 }, { strokeDashoffset: 0, opacity: 0 }], { duration: dur * 1.6, delay, easing, fill: "both" }).onfinish = () => p.remove();
  const dot = document.createElement("i");
  dot.className = "comet"; dot.style.offsetPath = `path("${d}")`; dot.style.setProperty("--cc", color);
  fx.append(dot);
  dot.animate([{ offsetDistance: "0%", opacity: 0 }, { opacity: 1, offset: .12 }, { opacity: 1, offset: .88 }, { offsetDistance: "100%", opacity: 0 }], { duration: dur, delay, easing, fill: "both" }).onfinish = () => dot.remove();
}

// One light wave along a selection's paths.
export function sparkle(edges, far) {
  if (reducedMotion()) return;
  let i = 0;
  for (const e of edges) {
    if (i++ >= (far ? 40 : 24)) break;
    if (e.type === "renders") continue;
    comet(e.from, e.to, far ? Math.min(600, i * 18) : 0, 420, edgeStyle(e)?.c ?? "#fff");
  }
}
export function ring(id, delay = 0) {
  const el = anchorOf(id);
  if (!el) return;
  el.style.setProperty("--pd", `${Math.round(delay)}ms`);
  if (el.classList.contains("pulse")) el.classList.toggle("p2"); else el.classList.add("pulse");
  clearTimeout(el.rxPulse);
  el.rxPulse = setTimeout(() => el.classList.remove("pulse", "p2"), delay + 1050);
}
export function fire(id) {
  if (reducedMotion()) return;
  const el = anchorOf(id);
  if (!el) return;
  el.classList.remove("fire");
  requestAnimationFrame(() => el.classList.add("fire"));
  setTimeout(() => el.classList.remove("fire"), 500);
}
export function orb(id, state) {
  const el = anchorOf(id);
  if (!el) return;
  const o = el.querySelector(".orb:not(.land):not(.away)");
  if (state === "start") {
    if (!o) el.append(Object.assign(document.createElement("span"), { className: "orb" }));
    return;
  }
  if (!o) return;
  o.classList.add(state === "land" ? "land" : "away");
  setTimeout(() => o.remove(), 480);
  if (state === "land") {
    el.classList.remove("settle");
    requestAnimationFrame(() => el.classList.add("settle"));
    setTimeout(() => el.classList.remove("settle"), 500);
  }
}
export function clearOrbs() { document.querySelectorAll("#board .orb").forEach(o => o.remove()); }
export function clearPulses() {
  document.querySelectorAll("#board .chip.pulse, #board .chip.p2").forEach(el => {
    el.classList.remove("pulse", "p2");
    clearTimeout(el.rxPulse);
  });
}
export function revert(id) { const el = anchorOf(id); if (el) restart(el, "reverting"); }
export function rewind(direction) {
  const el = byId("rewind");
  if (!el) return;
  el.classList.remove("back");
  restart(el, "go");
  if (direction === "back") el.classList.add("back");
}
export function shake(id) { const el = byId(id); if (el) restart(el, "shake"); }
function unbeat(event) { event.currentTarget.classList.remove("beat"); }
export function beat(id) {
  const el = byId(id);
  if (!el) return;
  el.addEventListener("animationend", unbeat);
  restart(el, "beat");
}

const platesOf = plates => plates.map(i => document.querySelector(`#board .frame.module[data-mod="${i}"]`)).filter(Boolean);
export function hmrApply(planned) {
  platesOf(planned.plates).forEach(el => restart(el, "hmr"));
  for (const group of ["kept", "reset", "rerun", "removed"]) {
    for (const id of planned[group] ?? []) anchorOf(id)?.classList.add(`h-${group}`);
  }
  document.querySelectorAll("#board .incoming").forEach(el => el.classList.add("go"));
}

// FLIP: where each token was, by key, before the swap.
export function snapshotPositions(ids) {
  const entries = [];
  for (const { id, key } of ids) {
    const b = boxOf(anchorOf(id));
    if (b) entries.push([key, b]);
  }
  return Object.fromEntries(entries);
}
export function flip(was, now, movedFrom, added) {
  for (const { id, key } of now) {
    const el = anchorOf(id);
    if (!el?.classList.contains("chip")) continue;
    const fromKey = (Object.hasOwn(movedFrom, key) ? movedFrom[key] : null) ?? key;
    const from = Object.hasOwn(was, fromKey) ? was[fromKey] : null, to = boxOf(el);
    if (from && to && !reducedMotion()) {
      const dx = from.x - to.x, dy = from.y - to.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) el.animate([{ transform: `translate(${dx}px,${dy}px) translateZ(6px)` }, { transform: "translate(0,0) translateZ(6px)" }], { duration: 460, easing: "cubic-bezier(.2,.8,.2,1)" });
    } else if (added.includes(key)) {
      el.classList.add("h-added");
      setTimeout(() => el.classList.remove("h-added"), 600);
    }
  }
}
export function settlePlates(plates) {
  const els = platesOf(plates);
  els.forEach(el => el.classList.add("hmr-settle"));
  setTimeout(() => els.forEach(el => el.classList.remove("hmr-settle")), 600);
}
export function toast(html, ms = 2400) {
  const el = byId("toast");
  if (!el) return;
  el.innerHTML = html;
  el.classList.add("on");
  clearTimeout(el.t);
  el.t = setTimeout(() => el.classList.remove("on"), ms);
}
