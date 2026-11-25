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
  if (["flush", "snapshot", "flight", "boundary", "run", "revert"].includes(message.type) && !queued) {
    queued = true;
    queueMicrotask(() => { queued = false; publish(collector.result()); });
  }
}

// ---- the dev server's newest run (vite.mjs rxMap(): GET /__rx/coverage[?probe=1]) ----------------------------------
// The live map runs in the dock's iframe (srcdoc) or a pop-out: both are on the app page's origin, so the endpoint is
// there. A page with no http(s) origin (a file, a static page) has none.
function coverageURL() {
  try { const o = new URL(document.baseURI).origin; return /^https?:/.test(o) ? `${o}/__rx/coverage` : null; } catch { return null; }
}
/** Asks the dev server whether it has a coverage run: `found({ file, mtime })`, or `found(null)`. Returns the cancel. */
export function probeCoverage(found) {
  const url = coverageURL();
  if (!url) return () => {};
  let live = true;
  Promise.resolve().then(() => fetch(`${url}?probe=1`, { cache: "no-store" }))
    .then(r => (r.ok ? r.json() : null))
    .then(j => { if (live) found(j && typeof j.file === "string" ? { file: j.file, mtime: Number(j.mtime) || 0 } : null); },
      () => { if (live) found(null); });
  return () => { live = false; };
}
/** Loads the newest run: `done(file)` with a CoverageFile, or `failed(reason)`. */
export function loadCoverageRun(done, failed) {
  const url = coverageURL();
  if (!url) return failed("no dev server");
  fetch(url, { cache: "no-store" })
    .then(r => r.json().then(j => (r.ok ? j : Promise.reject(new Error(j?.error ?? `HTTP ${r.status}`)))))
    .then(j => (j?.rxCoverage === 1 ? done(j) : failed("not a coverage file")), e => failed(String(e?.message ?? e)));
}
/** A run as the button's title says it: its file and when it was written. */
export function runTitle(run) {
  if (!run) return "";
  const d = new Date(run.mtime), pad = n => String(n).padStart(2, "0");
  return `${run.file} · ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
