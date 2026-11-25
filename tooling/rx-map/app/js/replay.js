import { servedTrace } from "./env.js";
import { keyName } from "./vocab.js";

const trace = servedTrace();
const records = (trace?.messages ?? []).filter(m => m?.source === "rx-map" && (m.v === undefined || m.v === 1));

export function replay(receive, active) {
  // The static graph is the one supplied with the recording. Transport/control replies are not app activity.
  const allowed = new Set(["reset", "snapshot", "flush", "flight", "held", "released", "boundary", "run", "revert"]);
  queueMicrotask(() => {
    if (active()) for (const m of records) if (allowed.has(m.type)) receive(m);
  });
}

export function traceEvents(graph) {
  const names = new Map(graph.nodes.map(n => [n.key, n]));
  const regions = new Map(graph.regions.flatMap(r => [[r.key, r], [r.id, r]]));
  const first = records.find(m => typeof m.at === "number")?.at ?? 0;
  const row = (m, r, kind, name, state) => ({
    kind, name, state, id: r?.id ?? "", detail: m.error ?? m.reason ?? m.args ?? "",
    when: typeof m.at === "number" ? `${Math.round(m.at - first)} ms` : "",
  });
  const boundary = m => {
    const r = regions.get(m.region);
    return row(m, r, "boundary", r?.head?.text ?? keyName(m.region), m.state);
  };
  return records.flatMap(m => {
    if (m.type === "boundary") return [boundary(m)];
    if (m.type === "run") return [row(m, names.get(m.key), "run", keyName(m.key), `${m.state} · #${m.id}`)];
    if (m.type === "revert") return [row(m, names.get(m.key), "revert", keyName(m.key), m.origin ?? "reverted")];
    if (m.type === "snapshot") return [
      ...(m.boundaries ?? []).map(b => boundary({ ...b, at: m.at })),
      ...(m.runs ?? []).map(r => row({ at: r.since }, names.get(r.key), "run", keyName(r.key), `in progress · #${r.id}`)),
    ];
    return [];
  });
}
