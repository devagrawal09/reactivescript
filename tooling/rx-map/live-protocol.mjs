export const LIVE_PATH = "/__rx/live";
export const LIVE_READY = "rx:live:ready";
export const LIVE_REQUEST = "rx:live:request";
export const LIVE_RESPONSE = "rx:live:response";
export const LIVE_TRACE = "rx:live:trace";
export const MCP_PATH = "/__rx/mcp";
export const LIVE_METHODS = ["status", "tail", "record", "state", "value", "why", "pending", "boundary_history"];
export const ACT_METHODS = ["travel", "resume", "timeline"];
export function matchesKey(record, key) {
  const root = record.key ?? record.region;
  if (key === undefined || key === root) return true;
  if (!root || !key.startsWith(`${root}.`)) return false;
  if (!record.path) return true;
  const parts = key.slice(root.length + 1).split(".");
  return record.path.split(".").slice(0, parts.length).every((p, i) => p === "*" || parts[i] === "*" || p === parts[i]);
}
