import { createInterface } from "node:readline";
import { plain, project } from "./project.mjs";
import { liveText, queryDiff, queryGraph } from "./query.mjs";
import { LIVE_METHODS, LIVE_PATH } from "./live-protocol.mjs";

const str = { type: "string", minLength: 1, maxLength: 1024 };
const integer = minimum => ({ type: "integer", minimum });
const tool = (name, description, properties = {}, required = []) => ({
  name, description, annotations: { readOnlyHint: true },
  inputSchema: { type: "object", properties: { ...properties, format: { type: "string", enum: ["text", "json"] } },
    required, additionalProperties: false },
});
const tools = [
  tool("check", "Check the program for compiler diagnostics."),
  tool("overview", "List modules in dependency order, with roles, components, boundaries, and top-level keys."),
  tool("find", "Find nodes by name or stable key (case-insensitive).", { query: { type: "string" } }, ["query"]),
  tool("node", "Describe a node and its static relationships.", { key: str }, ["key"]),
  tool("reach", "Trace what a change can affect (down) or what can change a node (up).",
    { key: str, direction: { type: "string", enum: ["down", "up"] }, depth: integer(0) }, ["key", "direction"]),
  tool("boundary", "List loading and errored boundaries, or show what can notify one.", { key: str }),
  tool("diff", "Compare behavior in the working tree against a Git ref (default HEAD).", { ref: str }),
  tool("live_status", "Show connected pages, flush count, and uptime."),
  tool("tail", "Read recent flushes, flights, boundaries, runs and reverts. since is an exclusive record sequence number.",
    { since: integer(0), limit: { ...integer(1), maximum: 5000 }, filter: { type: "string", enum: ["semantic", "all"] } }),
  { ...tool("record", "Mark and retrieve a trace recording.", { action: { type: "string", enum: ["start", "stop", "status"] },
    filter: { type: "string", enum: ["semantic", "all"] } }, ["action"]), annotations: { readOnlyHint: false } },
  tool("value", "Read the latest value preview for a key in the running page.", { key: str }, ["key"]),
  tool("state", "Read current value, pending and error for a key, or current values, flights, tripped boundaries, running actions and recent reverts.", { key: str }),
  tool("why", "Show current state, the last change, other keys in that flush, and related actions and reverts.", { key: str }, ["key"]),
  tool("pending", "List nodes waiting for a request to finish."),
];
const resources = ["graph", "model"].map(name => ({ uri: `rx://${name}`, name, mimeType: "application/json" }));
const liveMethods = new Map(LIVE_METHODS.map(k => [k === "status" ? "live_status" : k, k]));
const versions = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
const errorMessage = e => plain(e?.message ?? e);
const textContent = text => ({ type: "text", text: plain(text) });
const invalid = (code, message) => Object.assign(new Error(message), { rpcCode: code });

function validate({ name, inputSchema: s }, args) {
  if (!object(args)) throw new Error(`arguments must be an object; see tools/list for ${name}`);
  for (const k of s.required) if (!Object.hasOwn(args, k)) throw new Error(`missing ${k}; see tools/list for ${name}`);
  for (const [k, v] of Object.entries(args)) {
    const p = Object.hasOwn(s.properties, k) && s.properties[k];
    const valid = p && (p.type === "integer" ? Number.isSafeInteger(v) && v >= p.minimum && !(v > p.maximum)
      : typeof v === "string" && !(v.length < p.minLength || v.length > p.maxLength) && (!p.enum || p.enum.includes(v)));
    if (!valid) throw new Error(`invalid argument ${k}; see tools/list for ${name}`);
  }
}

async function liveCall(dev, method, params) {
  const signal = AbortSignal.timeout(5000);
  const candidates = dev ? [dev] : ["http://localhost:3000", "http://localhost:5173"];
  const outcomes = await Promise.all(candidates.map(async url => {
    try {
      const res = await fetch(new URL(LIVE_PATH, url), {
        method: "POST", signal, redirect: "error", headers: { "content-type": "application/json" },
        body: JSON.stringify({ method, params }),
      });
      const body = await res.json();
      return res.ok && Object.hasOwn(body, "result") ? { result: body.result }
        : typeof body.error === "string" ? { error: body.error } : null;
    } catch { return null; }
  }));
  const hit = outcomes.find(x => x && Object.hasOwn(x, "result"));
  if (hit) return hit.result;
  throw new Error(outcomes.find(Boolean)?.error ?? "no dev server / no page connected; start Vite with rxMap(), open the app, and set --dev if needed");
}

/** Serve newline-delimited JSON-RPC over stdio (or supplied Node streams). */
export function createMcp({ dev = process.env.RX_DEV_URL, getProject, live = (method, p) => liveCall(dev, method, p), ...options } = {}) {
  const local = getProject ? null : project(options);
  const projectFor = getProject ?? (() => local);
  const call = async ({ name, arguments: args = {} } = {}) => {
    try {
      const t = tools.find(t => t.name === name);
      if (!t) throw new Error(`unknown tool ${JSON.stringify(name)}; use tools/list`);
      validate(t, args);
      const { format, ...p } = args;
      let answer;
      if (liveMethods.has(name)) {
        const method = liveMethods.get(name);
        const data = await live(method, p).catch(e => {
          if (["state", "value"].includes(method) && /no (dev server|page)/.test(e.message)) return { key: p.key, observation: "unobserved" };
          throw e;
        });
        answer = { data, text: liveText(method, data) };
      } else if (name === "check") {
        const data = projectFor().check();
        answer = { data, text: data.map(d => `${d.file}:${d.line}:${d.column} ${d.code} ${d.message}`).join("\n") || "ok" };
      } else if (name === "diff") {
        try { answer = queryDiff(projectFor().diff(p.ref ?? "HEAD")); }
        catch (e) { throw new Error(`${errorMessage(e)}\nUse an existing Git ref and check that both versions compile.`); }
      } else {
        answer = queryGraph(projectFor().load().graph, name, p);
        if (name === "boundary" && p.key && (dev || getProject)) {
          answer.data.live = await live("boundary_history", { key: p.key, keys: answer.data.notifiers.map(n => n.key) })
            .catch(() => ({ observation: "unobserved" }));
          answer.text += `\n${liveText("boundary_history", answer.data.live)}`;
        }
      }
      return { content: [textContent(format === "json" ? JSON.stringify(answer.data, null, 2) : answer.text)] };
    } catch (e) { return { isError: true, content: [textContent(errorMessage(e))] }; }
  };
  async function dispatch(method, params) {
    const app = { load: () => projectFor().load() };
    switch (method) {
      case "initialize": {
        const v = params?.protocolVersion;
        if (typeof v !== "string") throw invalid(-32602, "initialize requires protocolVersion");
        return { protocolVersion: versions.includes(v) ? v : versions[0],
          capabilities: { tools: {}, resources: {} }, serverInfo: { name: "rx-map", version: "0.1.0" } };
      }
      case "ping": case "notifications/initialized": return {};
      case "tools/list": return { tools };
      case "tools/call": return call(params);
      case "resources/list": return { resources };
      case "resources/read": {
        const r = resources.find(r => r.uri === params?.uri);
        if (!r) throw invalid(-32602, "unknown resource URI; use resources/list");
        return { contents: [{ uri: r.uri, mimeType: r.mimeType, text: JSON.stringify(app.load()[r.name]) }] };
      }
      default: throw invalid(-32601, `method not found: ${method}`);
    }
  }
  return async function receive(msg) {
    const failure = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
    const id = msg?.id;
    const validId = typeof id === "string" || Number.isSafeInteger(id);
    if (!object(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string" || (Object.hasOwn(msg, "id") && !validId)) {
      return failure(validId ? id : null, -32600, "invalid request");
    }
    if (!validId) return; // Client notifications require no response.
    if (msg.params !== undefined && !object(msg.params)) return failure(id, -32602, "params must be an object");
    try { return { jsonrpc: "2.0", id, result: await dispatch(msg.method, msg.params) }; }
    catch (e) { return failure(id, e.rpcCode ?? -32603, errorMessage(e)); }
  };
}

export async function serveMcp({ input = process.stdin, output = process.stdout, ...options } = {}) {
  const receive = createMcp(options);
  const active = new Set();
  async function receiveLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch {
      output.write('{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"parse error"}}\n');
      return;
    }
    const reply = await receive(msg);
    if (reply) output.write(JSON.stringify(reply) + "\n");
  }
  for await (const line of createInterface({ input, crlfDelay: Infinity, terminal: false })) {
    if (!line.trim()) continue;
    const task = receiveLine(line);
    active.add(task);
    void task.finally(() => active.delete(task));
  }
  await Promise.all(active);
}
