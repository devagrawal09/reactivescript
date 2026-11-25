import { createCollector } from "../../coverage.mjs";
import { coverageLive } from "./env.js";

// Index paths once per observation update, rather than scanning the universe per token.
export function coverageView(file) {
  const targets = Object.create(null), modules = Object.create(null), edges = Object.create(null);
  let covered = 0, total = 0;
  for (const [id, path] of Object.entries(file?.paths ?? {})) {
    const hit = file.hits?.[id], seen = (hit?.n ?? 0) > 0;
    const m = modules[path.module] ??= { covered: 0, total: 0 };
    total++; m.total++;
    if (seen) { covered++; m.covered++; }
    const t = targets[path.target] ??= { rows: [], uncovered: false };
    t.rows.push({ id, label: path.label, seen, by: (hit?.by ?? []).join(", ") });
    if (path.kind === "edge") edges[id] = !seen;
    else if (!seen) t.uncovered = true;
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
  if (["flush", "snapshot", "flight", "boundary", "run", "revert"].includes(message.type) && !queued) {
    queued = true;
    queueMicrotask(() => { queued = false; publish(collector.result()); });
  }
}
