import { readFileSync } from "node:fs";
for (const f of process.argv.slice(2)) {
  const p = JSON.parse(readFileSync(f)); const self = new Map(); const dt = p.timeDeltas; const byId = new Map(p.nodes.map(n => [n.id, n]));
  let total = 0; p.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || "(anon)"}:${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + dt[i]); total += dt[i]; });
  console.log("==", f); [...self].sort((a, b) => b[1] - a[1]).slice(0, +(process.env.TOP ?? 22)).forEach(([k, v]) => console.log((100 * v / total).toFixed(1).padStart(5) + "%", k));
}
