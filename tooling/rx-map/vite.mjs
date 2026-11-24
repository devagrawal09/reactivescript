import { randomUUID } from "node:crypto";
import { LIVE_METHODS, LIVE_PATH, LIVE_READY, LIVE_REQUEST, LIVE_RESPONSE } from "./live-protocol.mjs";

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
    config: () => ({ resolve: { dedupe: ["solid-js"] } }),
    configureServer(server) {
      const pages = new Map(), pending = new Map();
      const ws = server.ws;
      ws.on(LIVE_READY, (_data, client) => {
        const socket = client.socket;
        if (pages.has(socket)) return;
        pages.set(socket, client);
        socket.once("close", () => {
          pages.delete(socket);
          for (const p of pending.values()) if (p.socket === socket) p.finish(null);
        });
      });
      ws.on(LIVE_RESPONSE, (data, client) => {
        const p = pending.get(data?.id);
        if (p && p.socket === client.socket) p.finish(data);
      });
      const print = server.printUrls.bind(server);
      server.printUrls = () => {
        print();
        const url = server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network[0];
        server.config.logger.info(`  ➜ RX live: ${url ? new URL(LIVE_PATH, url).href : LIVE_PATH}`);
      };
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
        const client = [...pages.values()].at(-1);
        if (!client) return send(res, 503, { error: noPage });
        const id = randomUUID();
        const response = await new Promise(resolve => {
          const finish = data => { pending.delete(id); clearTimeout(timer); resolve(data); };
          const timer = setTimeout(() => finish(null), 4500);
          pending.set(id, { socket: client.socket, finish });
          try { client.send(LIVE_REQUEST, { id, method, params }); }
          catch { finish(null); }
        });
        if (!response) return send(res, 503, { error: noPage });
        if (response.error !== undefined) return send(res, 400, { error: response.error });
        const result = method === "status" ? { ...response.result, pages: pages.size } : response.result;
        return send(res, 200, { result });
      });
    },
  };
}
