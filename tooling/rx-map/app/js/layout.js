// Convert the shared world layout into view props. No positioning decisions are made here.
import { layoutWorld, LEVELS, levelFor, METRICS } from "../../layout.mjs";
import { chipView, label } from "./model.js";
import { CTL, FRAME, FAM_HEX, STATUS, KIND, kindOf, famOf } from "./vocab.js";
import { plainValue } from "./values.js";
import { reducedMotion } from "./env.js";

export { LEVELS, levelFor };
export const overviewLevel = () => +Object.keys(LEVELS.up)[0];
export const detailLevel = () => Math.max(...Object.keys(LEVELS.down));
export const detailZoom = () => LEVELS.up[detailLevel() - 1];
const detailScale = METRICS.zoom;
const px = n => `${n}px`;
function placed(b, p, k = 1) {
  return { left: px((b.x - (p?.x ?? 0)) / k), top: px((b.y - (p?.y ?? 0)) / k),
    width: px(b.w / k), height: px(b.h / k), zoom: k === 1 ? undefined : `${k}` };
}
// Match the vanilla page: use the initial viewport, not the zoom or the later HUD size.
const aspect = Math.max(1, Math.min(4, (innerWidth - 200) / Math.max(200, innerHeight - 120)));
function cardView(M, mi) {
  const { G, A } = M, path = G.modules[mi], parts = path.split("/");
  const ns = G.nodes.filter(n => n.mod === mi && !(n.world && !n.from)), counts = {}, exports = [];
  for (const n of ns) {
    const f = famOf(n); counts[f] = (counts[f] ?? 0) + 1;
    if (n.site) continue;
    const degree = [...(A.out.get(n.id) ?? []), ...(A.inc.get(n.id) ?? [])].filter(e => {
      const id = e.from === n.id ? e.to : e.from;
      const o = A.nodes.get(id) ?? A.regions.get(id);
      return o && o.mod !== mi;
    }).length;
    if (degree) exports.push({ name: n.name, color: FAM_HEX[f], degree });
  }
  exports.sort((a, b) => b.degree - a.degree);
  return { name: A.modName(mi), path, shortPath: path.length <= 30 || parts.length < 3 ? path : `${parts[0]}/…/${parts.at(-1)}`,
    roles: Object.keys(FAM_HEX).filter(f => counts[f]).map(f => ({ name: f, count: counts[f], color: FAM_HEX[f], width: `${counts[f] / ns.length * 100}%` })),
    exports: exports.slice(0, 14), extra: exports.length - 14,
    diff: ["added", "changed", "removed"].map(st => ({ st, count: ns.filter(n => n.status === st).length, mark: STATUS[st] })).filter(v => v.count) };
}
export function holeText(p, values) {
  const v = p.key && values[p.key];
  if (v?.error) return `! ${String(v.error).slice(0, 24)}`;
  return v?.preview !== undefined ? plainValue(v.preview).slice(0, 28) : p.text;
}
function stripView(A, r) {
  const parts = [], add = (cls, text, extra) => parts.push({ cls, text, ...extra });
  let chars = 0, breaks = 0;
  for (const p of A.stripParts(r) ?? []) {
    if (p.br) { add("obr", ""); breaks++; }
    else if (p.attr) { add("oa", `${p.attr} "${p.text}"`); chars += p.attr.length + p.text.length; }
    else if ("text" in p) { add("ot", p.text); chars += p.text.length; }
    else if (p.site) {
      const n = A.nodes.get(p.site);
      if (!n || A.ctlSites.has(p.site)) continue;
      const kk = kindOf(n), text = /^\{(?:…|\.\.\.)\}$/.test(n.name) ? A.readsOf(n) || A.chipLabel(n).replace(/^\{\s*|\s*\}$/g, "") : n.name;
      const keys = (A.inc.get(n.id) ?? []).filter(e => e.type === "read").map(e => A.nodes.get(e.from)?.key).filter(Boolean);
      add(`oh k-${kk}`, text, { id: n.id, key: keys.length === 1 ? keys[0] : null, title: `${KIND[kk]?.label ?? n.kind}: ${n.name}${n.line ? ` · L${n.line}` : ""}` });
      chars += text.length + 2;
    } else if (p.region) {
      const k = A.regions.get(p.region);
      if (!k || A.empty(k)) continue;
      const text = CTL[k.kind] ? A.controlInfo(k).text : k.name ? `<${k.name} />` : k.kind;
      add(`orr frame-${k.kind}`, text);
      chars += text.length + 2;
    }
  }
  return { parts, more: chars > 64 || breaks > 1 };
}
export function boardView(M) {
  const { A, G } = M, L = layoutWorld(A, { aspect });
  const frames = new Map(), roots = [], worldBox = L.plates.get("world");
  const chip = (n, t, p, k) => ({ ...chipView(M, n), style: t ? placed(t, p, k) : {}, level: t?.level ?? detailLevel() });
  const world = worldBox ? { style: placed(worldBox), groups: L.worldGroups.map(g => ({ file: g.file, style: placed(g.label, worldBox, detailScale) })),
    titleStyle: { zoom: `${detailScale}` }, chips: [] } : null;
  for (const f of L.frames.values()) {
    const r = A.regions.get(f.id), info = CTL[r.kind] && A.controlInfo(r);
    const comp = A.nodes.get(A.compOfRegion.get(r.id));
    const program = r.kind === "program";
    const boundary = r.kind === "loading" || r.kind === "errored";
    const h = comp ? { type: "comp", chip: chip(comp, L.tokens.get(comp.id)) }
      : info ? { type: "ctl", text: info.text, aria: `${r.kind} ${info.text}${info.line ? `, line ${info.line}` : ""}`,
        read: info.site ? { ...chip(info.site, null), name: A.readsOf(info.site) || "—", badges: [] } : null,
        boundary, notifiers: boundary ? (A.inc.get(r.id) ?? []).filter(e => e.type === "notifies").map(e => ({ id: e.from, label: label(M, e.from) })) : [],
        lead: r.kind === "loading" ? "pending from" : "can fail from",
        none: r.kind === "loading" ? "nothing read below can be pending" : "nothing read below awaits" }
      : { type: "plain", text: FRAME[r.kind] ?? r.kind, b: (r.kind === "children" || r.kind === "imported") && r.name ? `<${r.name} />` : "" };
    if (comp) h.chip.style = {};
    frames.set(f.id, { id: r.id, key: r.key ?? "", kind: r.kind, ctl: !!info, dead: !!r.deadTyped,
      status: r.status && r.status !== "same" ? r.status : "", head: h,
      module: program ? { index: r.mod, path: G.modules[r.mod], card: cardView(M, r.mod) } : null,
      style: placed(program ? L.plates.get(r.mod) : f, L.frames.get(f.parent)),
      labelStyle: placed(f.label, f, detailScale), kids: [], chips: [], clusters: [], strip: null });
  }
  for (const f of L.frames.values()) (frames.get(f.parent)?.kids ?? roots).push(frames.get(f.id));
  for (const c of L.clusters) frames.get(`${c.mod}:r0`)?.clusters.push({ ...c,
    style: placed(c, L.plates.get(c.mod)), labelStyle: { zoom: `${detailScale}` } });
  for (const [id, t] of L.tokens) {
    const n = A.nodes.get(id);
    if (t.role === "world") world.chips.push(chip(n, t, worldBox, detailScale));
    if (t.role !== "named" && t.role !== "site") continue;
    const f = L.frames.get(t.region) ?? L.frames.get(`${n.mod}:r0`);
    frames.get(f?.id)?.chips.push(chip(n, t, f, detailScale));
  }
  for (const [id, b] of L.strips) frames.get(id).strip = { ...stripView(A, A.regions.get(id)), style: placed(b, L.frames.get(id), detailScale) };
  const names = G.nodes.filter(n => !n.site).length;
  return { L, roots, world, style: { width: px(L.width), height: px(L.height) }, flat: G.nodes.length > 900,
    stats: `${G.modules.length} module${G.modules.length > 1 ? "s" : ""} · ${names} names · ${G.nodes.length - names} sites · ${G.edges.length} edges` };
}

// The card is the only box with a content-dependent paint scale. It never affects layout.
// At `fitS` (the zoom that frames the whole world) the card's name must read at READ_PX on screen: its scale has that
// floor. A plate too small for the whole card at that scale gets a narrower card (it wraps and clips inside its own
// box, `tight` drops the exports), never a bigger box.
const CARD_W = 360, NAME_PX = 26, READ_PX = 16;   // 16 so the far (higher) cards of the tilted plane still read at 14
export function fitCards(L, fitS) {
  const floor = fitS > 0 ? READ_PX / (NAME_PX * fitS) : 0;
  const ks = [];
  for (const inner of document.querySelectorAll(".module > .psum > .ps-in")) {
    const p = L.plates.get(+inner.closest(".module").dataset.mod);
    if (!p) continue;
    inner.style.width = ""; inner.classList.remove("tight", "shed1", "shed2", "shed3");
    ks.push([inner, Math.min(p.w * .88 / CARD_W, p.h * .86 / (inner.offsetHeight || 200)), p]);
  }
  const sorted = ks.map(k => k[1]).sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)] ?? 1;
  for (const [inner, fit, p] of ks) {
    // but no bigger than lets the name's longest word fit across the plate (a monospace char is ~.6em)
    const word = Math.max(...nameParts(inner.querySelector(".ps-name")?.title ?? "").map(w => w.length), 1);
    const k = Math.max(Math.min(fit, median * 1.6), Math.min(floor, p.w * .9 / (word * NAME_PX * .62 + 8)));
    const tight = k > fit * 1.001, room = p.h * .86;
    inner.style.marginTop = `${(p.h * .06).toFixed(1)}px`;
    // the width that fits the plate at this scale; then, so the card never spills its plate, it sheds parts
    // (exports, then path and counts, then the role bar) until it fits, and only past that gets smaller
    inner.style.width = tight ? `${Math.max(40, Math.floor(p.w * .9 / k))}px` : "";
    let shed = 0;
    inner.classList.remove("shed1", "shed2", "shed3");
    inner.classList.toggle("tight", tight);
    if (tight) while (shed < 3 && inner.offsetHeight * k > room) inner.classList.add(`shed${++shed}`);
    const kk = tight ? Math.min(k, room / Math.max(1, inner.offsetHeight)) : k;
    inner.style.transform = `scale(${kk.toFixed(3)})`;
  }
  const ws = document.querySelector(".worldrow > .wsum > .ws-in"), wp = L.plates.get("world");
  if (ws && wp) ws.style.transform = `scale(${Math.min(wp.h * .6 / (ws.offsetHeight || 30), wp.w * .9 / (ws.offsetWidth || 300), median * 1.4).toFixed(3)})`;
}

/** A name in pieces where it may wrap: at its camel humps and separators (`CreateIssue` → `Create`, `Issue`). */
export const nameParts = s => String(s).split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[-_./])/);

export function cardCounts(M, mod, values, held, flying, recent) {
  const counts = [], keys = new Set(M.G.nodes.filter(n => n.mod === mod && !n.site && n.key).map(n => n.key));
  for (const [k, label, has] of [
    ["chg", "changing", k => recent.includes(k)], ["fail", "failed", k => !!values[k]?.error],
    ["held", "held", k => !!held[k]], ["fly", "in the air", k => !!flying[k]],
  ]) {
    const n = [...keys].filter(has).length;
    if (n) counts.push({ k, text: `${n} ${label}` });
  }
  return counts;
}

// Committed wave effects already contain the keys touched by a flush. Use them to time the visual indicator.
let seenWave = 0, recent = new Map(), recentTimer;
export function noteCardWaves(M, state, update) {
  const live = state(), mods = new Set(), now = performance.now();
  for (const fx of live.fx) {
    if (fx.n <= seenWave || fx.k !== "flush") continue;
    for (const { key } of fx.w?.ids ?? []) {
      recent.set(key, now);
      for (const id of M.keyIds.get(key) ?? []) { const n = M.nodes.get(id); if (n && !n.site) mods.add(n.mod); }
    }
  }
  seenWave = live.fxSeq;
  for (const mod of mods) {
    const el = document.querySelector(`.module[data-mod="${mod}"] > .psum`);
    if (el && !reducedMotion()) { el.classList.remove("pulse"); void el.offsetWidth; el.classList.add("pulse"); }
  }
  clearTimeout(recentTimer);
  const expire = () => {
    const now = performance.now();
    for (const [key, t] of recent) if (now - t >= 2000) recent.delete(key);
    update([...recent.keys()]);
    if (recent.size) recentTimer = setTimeout(expire, Math.max(1, recent.values().next().value + 2000 - now));
  };
  if (recent.size || mods.size) expire();
}
