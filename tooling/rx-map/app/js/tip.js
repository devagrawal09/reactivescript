// The tooltip's place: beside the pointer, kept on screen (map.html placeTip).
export function placeTip(x, y) {
  const tip = document.getElementById("tip"); if (!tip) return;
  const w = tip.offsetWidth, h = tip.offsetHeight, vw = innerWidth, vh = innerHeight;
  const left = x + 16 + w > vw - 8 ? x - 16 - w : x + 16, top = y + 18 + h > vh - 8 ? y - 12 - h : y + 18;
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
