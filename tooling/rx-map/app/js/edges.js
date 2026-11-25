// An edge as the edge layer draws it: its path on the board's boxes and its style. Drawn from what depends to what
// it depends on, so a read points at what it reads.
import { edgeStyle } from "./vocab.js";
import { edgePath } from "./geometry.js";

const GLOW = { added: "#22c55e", removed: "#ef4444", changed: "#e879f9" };
/** `null` when an end is not on the board (hidden, or not laid out yet). */
export function edgeView(e, boxes, focused) {
  const [from, to] = e.type === "read" || e.type === "notifies" ? [e.to, e.from] : [e.from, e.to];
  const a = boxes[from], b = boxes[to], s = edgeStyle(e);
  if (!a || !b || !s) return null;
  const changed = e.status && e.status !== "same";
  return {
    d: edgePath(a, b), c: s.c, w: s.w, dash: s.d, op: changed ? 1 : focused ? 0.95 : 0.55,
    glow: changed ? GLOW[e.status] : focused ? s.c : "", glowW: s.w + 6, glowOp: changed ? (e.status === "removed" ? 0.35 : 0.45) : 0.14,
  };
}
