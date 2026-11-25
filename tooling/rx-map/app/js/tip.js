// The tooltip's place: beside the pointer, kept on screen (map.html placeTip).
export function placeTip(x, y) {
  const tip = document.getElementById("tip"); if (!tip) return;
  const w = tip.offsetWidth, h = tip.offsetHeight, vw = innerWidth, vh = innerHeight;
  // never over an open side panel (a column on the right): the tooltip stays left of it
  const side = document.getElementById("side"), sr = side && !side.classList.contains("closed") ? side.getBoundingClientRect() : null;
  const right = sr && sr.width && sr.left > vw / 3 ? sr.left - 8 : vw - 8;
  let left = x + 16 + w > right ? x - 16 - w : x + 16;
  left = Math.min(left, right - w);
  const top = y + 18 + h > vh - 8 ? y - 12 - h : y + 18;
  tip.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(60, top)}px)`;
}
/** Beside an element (keyboard focus): at its top right. */
export function placeTipAt(id) {
  const el = document.querySelector(`#board [data-id="${CSS.escape(id)}"]`); if (!el) return;
  const b = el.getBoundingClientRect(); placeTip(b.right, b.top);
}
let px = 0, py = 0;
/** Follows the pointer over the board (the tooltip is placed there). */
export function pointerAt(ev) { px = ev.clientX; py = ev.clientY; if (document.getElementById("tip")?.classList.contains("on")) placeTip(px, py); }
/** After the tooltip's content changed: place it at the pointer. */
export function placeTipNow() { requestAnimationFrame(() => placeTip(px, py)); }
/** Calls `f` when the pointer goes onto the HUD (header, side panel, bar, minimap) or leaves the page: a tooltip from
 *  the board has nothing to point at there. Returns the unsubscribe. */
export function onPointerOffBoard(f) {
  const over = ev => { if (ev.target?.closest?.(".hud") && !ev.target.closest("#tip")) f(); };
  const out = ev => { if (!ev.relatedTarget) f(); };
  document.addEventListener("mouseover", over);
  document.addEventListener("mouseout", out);
  return () => { document.removeEventListener("mouseover", over); document.removeEventListener("mouseout", out); };
}
