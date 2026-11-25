import { randomUUID } from "node:crypto";
import { LIVE_METHODS, LIVE_PATH, LIVE_READY, LIVE_REQUEST, LIVE_RESPONSE, LIVE_TRACE, MCP_PATH } from "./live-protocol.mjs";
import { createMcp } from "./mcp.mjs";
import { project } from "./project.mjs";

const noPage = "no page connected; open or reload the app in a browser with Vite HMR enabled";
const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};
async function bodyOf(req) {
  let body = "";
  req.setEncoding("utf8");
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    body += chunk;
    if (body.length > 8192) throw new Error("body too large; send only {method, params}");
  }
  try { return JSON.parse(body); }
  catch { throw new Error("invalid JSON; send {method, params}"); }
}

/** Expose the dev page's read-only recorder at GET/POST /__rx/live. */
export function rxMap() {
  return {
    name: "rx:live",
    apply(_config, env) { return env.command === "serve" && !env.isPreview; },
    config: () => ({ resolve: { dedupe: ["solid-js", "@solidjs/signals"] } }),
    configureServer(server) {
      const pages = new Map(), pending = new Map();
      const entries = new Map();
      const root = server.config.root;
      const hooks = globalThis[Symbol.for("reactivescript.vite.entries")] ??= new Map();
      let app;
      let warm;
      const invalidate = () => {
        app = undefined;
        clearTimeout(warm);
        warm = setTimeout(() => { if (entries.size) try { getProject().load(); } catch { /* check reports diagnostics */ } }, 40);
        warm.unref();
      };
      const register = (file, spa) => { if (entries.get(file) !== spa) { entries.set(file, spa); invalidate(); } };
      hooks.set(root, register);
      server.httpServer?.once("close", () => { clearTimeout(warm); if (hooks.get(root) === register) hooks.delete(root); });
      server.watcher?.on("all", (event, file) => {
        if (event === "unlink") entries.delete(file);
        if (file.endsWith(".rx") || file.endsWith(".ts") || file.endsWith("tsconfig.json")) invalidate();
      });
      const getProject = () => app ??= project({ root, entries: [...entries.keys()], spa: [...entries.values()].some(Boolean), managed: true });
      const capacity = 5000, ring = new Array(capacity);
      let seq = 0, mark, lastPage;
      const records = (since, limit, filter, page) => {
        const out = [];
        for (let i = seq; i > since && i > seq - capacity && out.length < limit; i--) {
          const { data, socket } = ring[(i - 1) % capacity];
          if (page && socket !== page) continue;
          if (filter !== "all" && data.type === "flush") {
            const changes = data.changes.filter(c => c?.key);
            if (changes.length) out.push({ ...data, changes });
          } else out.push(data);
        }
        return out.reverse();
      };
      const ws = server.ws;
      ws.on(LIVE_READY, (_data, client) => {
        const socket = client.socket;
        if (pages.has(socket)) return;
        pages.set(socket, client);
        lastPage = socket;
        socket.once("close", () => {
          pages.delete(socket);
          for (const p of pending.values()) if (p.socket === socket) p.finish(null);
        });
      });
      ws.on(LIVE_RESPONSE, (data, client) => {
        const p = pending.get(data?.id);
        if (p && p.socket === client.socket) p.finish(data);
      });
      ws.on(LIVE_TRACE, (record, client) => {
        if (!pages.has(client.socket) || !record || typeof record.type !== "string" || typeof record.at !== "number") return;
        if (record.type === "flush" && !Array.isArray(record.changes)) return;
        ring[seq % capacity] = { socket: client.socket, data: { ...record, seq: ++seq } };
      });
      async function live(method, params = {}) {
        const client = [...pages.values()].at(-1);
        if (method === "tail") {
          const { since = 0, limit = 20, filter } = params;
          if (!Number.isSafeInteger(since) || since < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > capacity)
            throw new Error("tail takes a nonnegative since and a limit from 1 to 5000");
          return records(since, limit, filter, client?.socket ?? lastPage);
        }
        if (method === "record") {
          if (params.action === "start") {
            if (!client) throw new Error(noPage);
            if (mark) throw new Error("recording already active");
            mark = { since: seq, filter: params.filter ?? "semantic", page: client.socket };
          } else if (params.action === "stop") {
            if (!mark) throw new Error("no active recording");
            const current = mark; mark = undefined;
            const result = records(current.since, capacity, params.filter ?? current.filter, current.page);
            const start = result[0]?.at ?? 0;
            return { recording: false, truncated: seq - current.since > capacity,
              records: result.map(r => ({ ...r, at: Math.max(0, r.at - start) })) };
          } else if (params.action !== "status") throw new Error("use record start, stop or status");
          return { recording: !!mark, since: mark?.since, filter: mark?.filter };
        }
        if (!client) throw new Error(noPage);
        const id = randomUUID();
        const response = await new Promise(resolve => {
          const finish = data => { pending.delete(id); clearTimeout(timer); resolve(data); };
          const timer = setTimeout(() => finish(null), 4500);
          pending.set(id, { socket: client.socket, finish });
          try { client.send(LIVE_REQUEST, { id, method, params }); }
          catch { finish(null); }
        });
        if (!response) throw new Error(noPage);
        if (response.error !== undefined) throw new Error(response.error);
        return method === "status" ? { ...response.result, pages: pages.size } : response.result;
      }
      const mcp = createMcp({ getProject, live });
      const print = server.printUrls.bind(server);
      server.printUrls = () => {
        print();
        const url = server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network[0];
        server.config.logger.info(`  ➜ RX live: ${url ? new URL(LIVE_PATH, url).href : LIVE_PATH}`);
        server.config.logger.info(`  ➜ RX MCP: ${url ? new URL(MCP_PATH, url).href : MCP_PATH}`);
      };
      server.middlewares.use(MCP_PATH, async (req, res) => {
        if (req.url && req.url !== "/") return send(res, 404, { error: `use ${MCP_PATH}` });
        if (req.method !== "POST") { res.setHeader("allow", "POST"); return send(res, 405, { error: "use POST JSON-RPC" }); }
        // Same-origin browser requests only; local CLI clients do not send Origin.
        if (req.headers.origin) {
          try { if (new URL(req.headers.origin).host !== req.headers.host) throw new Error(); }
          catch { return send(res, 403, { error: "origin not allowed" }); }
        }
        if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json")
          return send(res, 415, { error: "send application/json" });
        let msg;
        try { msg = await bodyOf(req); }
        catch (e) { return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: e.message } }); }
        const result = await mcp(msg);
        if (result) return send(res, 200, result);
        res.writeHead(202).end();
      });
      server.middlewares.use(LIVE_PATH, async (req, res) => {
        if (req.url && req.url !== "/") return send(res, 404, { error: `use ${LIVE_PATH}` });
        if (req.method !== "GET" && req.method !== "POST") return send(res, 405, { error: "use GET for status or POST {method, params}" });
        let method = "status", params;
        if (req.method === "POST") {
          if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json")
            return send(res, 415, { error: "send application/json with {method, params}" });
          try {
            const body = await bodyOf(req);
            method = body?.method;
            params = body?.params;
            if (!LIVE_METHODS.includes(method)) throw new Error(`use method ${LIVE_METHODS.join(", ")}`);
            if (params !== undefined && (!params || typeof params !== "object" || Array.isArray(params)))
              throw new Error("params must be an object");
          } catch (e) { return send(res, 400, { error: e.message }); }
        }
        try { return send(res, 200, { result: await live(method, params) }); }
        catch (e) { return send(res, e.message === noPage ? 503 : 400, { error: e.message }); }
      });
    },
  };
}
