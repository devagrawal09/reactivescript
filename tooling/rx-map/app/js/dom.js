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
