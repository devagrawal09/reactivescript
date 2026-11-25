import { createCollector } from "../../coverage.mjs";
import { coverageLive } from "./env.js";

// Index paths once per observation update, rather than scanning the universe per token.
export function coverageView(file) {
  const targets = Object.create(null), modules = Object.create(null), edges = Object.create(null);
  let covered = 0, total = 0;
  for (const [id, path] of Object.entries(file?.paths ?? {})) {
    const hit = file.hits?.[id], seen = (hit?.n ?? 0) > 0;
    // An ignored path (`// rx-coverage-ignore: why`) is neutral: out of the totals, never dimmed, listed with its reason.
    const ignored = path.ignored ?? "";
    const m = modules[path.module] ??= { covered: 0, total: 0 };
    if (!ignored) { total++; m.total++; }
    if (seen && !ignored) { covered++; m.covered++; }
    const t = targets[path.target] ??= { rows: [], uncovered: false };
    t.rows.push({ id, label: path.label, seen, ignored, by: (hit?.by ?? []).join(", ") });
    if (path.kind === "edge") edges[id] = !seen && !ignored;
    else if (!seen && !ignored) t.uncovered = true;
  }
  return { targets, modules, edges, covered, total, percent: total ? Math.round(100 * covered / total) : 100 };
}

const live = coverageLive();
let collector, graphNow, queued = false;
export function coverageGraph(graph) {
  if (!live || graphNow === graph) return null;
  graphNow = graph;
  collector ??= createCollector({ graphs: () => [graphNow], tool: "live" });
  return collector.result();
}

export function feedCoverage(message, publish) {
  if (!collector) return;
  collector.feed(message);
  if (["flush", "snapshot", "flight", "boundary", "run", "caught", "revert"].includes(message.type) && !queued) {
    queued = true;
    queueMicrotask(() => { queued = false; publish(collector.result()); });
  }
}
