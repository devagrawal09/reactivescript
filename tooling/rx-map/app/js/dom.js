// Reading DOM events: .rx handlers get the event as a value; these find what it happened on.
/** The `data-id` of the closest element matching `sel` around the event's target, or "". */
export const closestId = (ev, sel) => ev?.target?.closest?.(sel)?.dataset?.id ?? "";
/** The `data-go` of the closest `.nref` (a boundary's notifier link), or "". */
export const closestGo = ev => ev?.target?.closest?.(".nref")?.dataset?.go ?? "";
/** Whether the event's target is inside an element matching `sel`. */
export const within = (ev, sel) => !!ev?.target?.closest?.(sel);
/** A mouseout that leaves an anchor (`[data-id]`) for somewhere outside it: its id, else "". */
export function leftId(ev) {
  const c = ev?.target?.closest?.("[data-id]");
  return !c || c.contains(ev.relatedTarget) ? "" : c.dataset.id;
}
/** The value / checked state of an event's target. */
export const targetValue = ev => ev?.target?.value ?? "";
export const targetChecked = ev => !!ev?.target?.checked;
/** Listens for keys on the document; returns the unsubscribe. */
export function onKey(f) { document.addEventListener("keydown", f); return () => document.removeEventListener("keydown", f); }
/** Whether a text field has the keyboard. */
export const typing = () => /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? "");
/** Whether the keyboard is on the page itself or on the element with this id. */
export const focusIsBodyOr = id => document.activeElement === document.body || document.activeElement?.id === id;
export function focusEl(id) { document.getElementById(id)?.focus(); }
export function blurActive() { document.activeElement?.blur?.(); }
/** Runs `f` on the next frame (after the first layout). */
export function nextFrame(f) { const r = requestAnimationFrame(() => f()); return () => cancelAnimationFrame(r); }
/** Runs `f` once after `ms`; returns the cancel. */
export function after(ms, f) { const t = setTimeout(() => f(), ms); return () => clearTimeout(t); }
/** Scrolls the element with `data-<name>="<value>"` into view (after the render that adds it). */
export function scrollToData(name, value) {
  requestAnimationFrame(() => document.querySelector(`[data-${name}="${CSS.escape(value)}"]`)?.scrollIntoView?.({ block: "nearest" }));
}
