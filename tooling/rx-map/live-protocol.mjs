export const LIVE_PATH = "/__rx/live";
export const LIVE_READY = "rx:live:ready";
export const LIVE_REQUEST = "rx:live:request";
export const LIVE_RESPONSE = "rx:live:response";
export const LIVE_TRACE = "rx:live:trace";
export const MCP_PATH = "/__rx/mcp";
export const LIVE_METHODS = ["status", "tail", "record", "state", "value", "why", "pending", "boundary_history", "trace", "hmr"];
export const ACT_METHODS = ["travel", "resume", "timeline"];
export function matchesKey(record, key) {
  const root = record.key ?? record.region;
  if (key === undefined || key === root) return true;
  if (!root || !key.startsWith(`${root}.`)) return false;
  if (!record.path) return true;
  const parts = key.slice(root.length + 1).split(".");
  return record.path.split(".").slice(0, parts.length).every((p, i) => p === "*" || parts[i] === "*" || p === parts[i]);
}

export function traceSummary(records, { key, run, limit = 20 } = {}) {
  const blocks = new Map();
  for (const r of records) {
    if (r.type !== "run" && r.type !== "call") continue;
    const id = `${r.type}:${r.id}`;
    if (r.state === "start") blocks.set(id, { ...r, writes: [], calls: [] });
    else {
      const block = blocks.get(id);
      if (block) Object.assign(block, { state: r.state, duration: Math.max(0, r.at - block.at), result: r.result, error: r.error });
    }
  }
  for (const block of blocks.values()) if (block.type === "call" && block.run !== undefined)
    blocks.get(`run:${block.run}`)?.calls.push({ id: block.id, key: block.key });
  for (const r of records) {
    const writes = r.type === "flush" ? r.changes : ["held", "released"].includes(r.type) ? [r] : [];
    for (const w of writes) {
      const write = { type: r.type === "flush" ? "write" : r.type, key: w.key, instance: w.instance, at: r.at, seq: r.seq,
        path: w.path, preview: w.compact ?? w.preview, blockers: w.blockers };
      if (w.run !== undefined) blocks.get(`run:${w.run}`)?.writes.push(write);
      if (w.call !== undefined) blocks.get(`call:${w.call}`)?.writes.push(write);
    }
  }
  return [...blocks.values()].filter(b => (run === undefined || (b.type === "run" ? b.id : b.run) === run) &&
    (matchesKey(b, key) || b.writes.some(w => matchesKey(w, key)))).slice(-limit);
}
