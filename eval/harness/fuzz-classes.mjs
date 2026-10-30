// Round 8, after the run (post hoc, Ryan 2026-10-30): each first hole in Ryan's terms. A tear: the screen disagrees
// with itself or with what was accepted, and stays so; a flickered reversion: an accepted change visibly goes back
// until a refresh answers; a silent hold: a consistent held view (the previous filter's list right after a switch)
// with nothing on screen acknowledging it; never settles: still loading once everything has answered; a crash: a
// page error or a page that crashes. Classes come from the hole's kind and its last step, checked against replays
// (README); `cause` names the filed Solid bug where a replay tied the kind to it.
// Usage: node harness/fuzz-classes.mjs <dir of json results> [--json out.json]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function classify(v, arm) {
  const last = v.trail.at(-1) ?? "";
  if (v.kind === "page error" || v.kind === "page crash") return { cls: "crash", cause: v.kind !== "page error" ? null : arm === "rx" ? "handler read (R-8)" : "unhandled rejection" };
  if (v.kind === "at rest: detail" && /loading/.test(v.detail)) return { cls: "never settles", cause: "solid#4437" };
  if (v.kind === "at rest: rows" && /shows \[\]/.test(v.detail)) return { cls: "tear", cause: "solid#4440" };
  if (/^(closed row shown|open row in closed list|open row missing)$/.test(v.kind) && /^filter /.test(last)) return { cls: "silent hold", cause: null };
  if (v.kind === "closed row shown") return { cls: "flickered reversion", cause: null };
  if (/title|assignee/.test(v.kind) && !/^at rest/.test(v.kind)) return { cls: "flickered reversion", cause: null };
  return { cls: "tear", cause: null };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const a = process.argv.slice(2); const dir = path.resolve(a[0]); const out = {};
  for (const f of readdirSync(dir).filter(f => f.endsWith(".json"))) {
    const j = JSON.parse(readFileSync(path.join(dir, f), "utf8")); const arm = path.basename(j.dir).match(/-(react|rx|solid|foldkit)-\d+$/)[1];
    for (const v of j.violations) { const { cls, cause } = classify(v, arm); const k = cause ? `${cls} (${cause})` : cls; out[arm] ??= {}; out[arm][k] = (out[arm][k] ?? 0) + 1; }
  }
  for (const [arm, ks] of Object.entries(out)) console.log(`${arm}: ${Object.entries(ks).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  const o = a.indexOf("--json"); if (o >= 0) writeFileSync(a[o + 1], JSON.stringify(out, null, 2) + "\n");
}
