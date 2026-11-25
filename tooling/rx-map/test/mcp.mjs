import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { LIVE_READY, LIVE_REQUEST, LIVE_RESPONSE } from "../live-protocol.mjs";
import { rxMap } from "../vite.mjs";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
const cli = fileURLToPath(new URL("../rx-map.mjs", import.meta.url));
const RXC = process.env.RXC ?? ["release", "debug"].map(mode => join(repo, `compiler/target/${mode}/rxc`)).find(existsSync) ?? "rxc";
const request = (id, method, params) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
function client(t, args) {
  const child = spawn(process.execPath, [cli, "mcp", ...args], { env: { ...process.env, RXC }, stdio: ["pipe", "pipe", "inherit"] });
  t.after(() => { child.stdin.end(); child.kill(); });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let id = 0;
  const send = line => child.stdin.write(line + "\n");
  const receive = async () => JSON.parse((await lines.next()).value);
  const rpc = async (method, params) => {
    send(request(++id, method, params));
    const reply = await receive();
    assert.equal(reply.id, id);
    assert.equal(reply.jsonrpc, "2.0");
    return reply;
  };
  const call = async (name, args) => (await rpc("tools/call", { name, arguments: args })).result;
  const text = async (name, args) => {
    const r = await call(name, args);
    assert.ok(!r.isError, r.content[0].text);
    return r.content[0].text;
  };
  const json = async (name, args) => JSON.parse(await text(name, { ...args, format: "json" }));
  return { send, receive, rpc, call, text, json };
}

test("stdio JSON-RPC negotiation, notifications, catalog and errors", { timeout: 10000 }, async t => {
  const c = client(t, ["--root", repo, "--entry", "examples/notes/main.rx"]);
  assert.equal((await c.rpc("initialize", { protocolVersion: "2025-06-18" })).result.protocolVersion, "2025-06-18");
  assert.equal((await c.rpc("initialize", { protocolVersion: "1900-01-01" })).result.protocolVersion, "2025-11-25");
  c.send('{"jsonrpc":"2.0","method":"notifications/initialized"}');
  assert.deepEqual((await c.rpc("ping")).result, {});
  c.send("{");
  assert.equal((await c.receive()).error.code, -32700);
  c.send("null");
  assert.equal((await c.receive()).error.code, -32600);
  assert.equal((await c.rpc("ping", [])).error.code, -32602);
  assert.equal((await c.rpc("bad")).error.code, -32601);
  const list = (await c.rpc("tools/list")).result.tools;
  assert.deepEqual(list.map(x => x.name), ["check", "overview", "find", "node", "reach", "boundary", "diff", "live_status", "tail", "value", "state", "why", "pending"]);
  assert.ok(list.every(t => t.annotations.readOnlyHint));
  assert.equal((await c.call("node")).isError, true);
  assert.equal((await c.call("reach", { key: "x", direction: "sideways" })).isError, true);
  assert.equal((await c.call("unknown")).isError, true);
  assert.equal((await c.rpc("resources/read", { uri: "rx://wrong" })).error.code, -32602);
});

test("static queries and resources on notes", { timeout: 10000 }, async t => {
  const c = client(t, ["--root", repo, "--entry", "examples/notes/main.rx"]);
  assert.equal(await c.text("check"), "ok");
  assert.deepEqual((await c.json("overview")).map(m => m.file),
    ["examples/notes/data.rx", "examples/notes/ui.rx", "examples/notes/main.rx"]);
  const key = "examples/notes/data.rx||notes";
  assert.ok((await c.json("find", { query: "NOTES" })).some(n => n.key === key && n.line === 28));
  const node = await c.json("node", { key });
  assert.equal(node.role, "state");
  assert.deepEqual(node.marks, { pending: true, question: true, io: false, trust: false });
  assert.match(node.declaration, /await listNotes/);
  assert.ok(node.reads.some(n => n.key.endsWith("||query")));
  assert.ok(node.calls.some(n => n.key.endsWith("||listNotes")));
  assert.ok(node.writtenBy.some(n => n.key.endsWith("||save")));
  assert.match((await c.call("node", { key: key + "s" })).content[0].text, /did you mean: examples\/notes\/data\.rx\|\|notes/);
  assert.deepEqual(await c.json("reach", { key, direction: "down", depth: 0 }), []);
  assert.ok((await c.json("reach", { key, direction: "down", depth: 1 })).every(n => n.depth === 1 && n.kind !== "server"));
  assert.ok((await c.json("reach", { key, direction: "up", depth: 1 })).some(n => n.key.endsWith("||save")));
  const boundaries = await c.json("boundary");
  assert.equal(boundaries.length, 4);
  const b = await c.json("boundary", { key: boundaries.find(b => b.kind === "loading").key });
  assert.equal(b.line, 24);
  assert.ok(b.notifiers.some(n => n.key === key && n.via.key.includes("NoteList")));
  const list = (await c.rpc("resources/list")).result.resources;
  assert.deepEqual(list.map(r => r.uri), ["rx://graph", "rx://model"]);
  for (const { uri } of list) {
    const [r] = (await c.rpc("resources/read", { uri })).result.contents;
    assert.equal(r.mimeType, "application/json");
    const data = JSON.parse(r.text);
    assert.equal(Array.isArray(data) ? data[0].file : data.modules[0], "examples/notes/data.rx");
  }
});

test("entry discovery, mtime invalidation, diagnostics and Git diff", { timeout: 10000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "rx-map-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (f, s) => writeFileSync(join(root, f), s);
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  put("dep.rx", "export source count := 1\n");
  put("main.rx", 'import {\n count\n} from "./dep.rx"\nresult = count + 1\n');
  put("other.rx", '// import { count } from "./main.rx"\nsource other := 0\n');
  put("helper.d.rx", "pure fn helper(): number\n");
  mkdirSync(join(root, "node_modules"));
  mkdirSync(join(root, "dist"));
  put("node_modules/bad.rx", "?");
  put("dist/bad.rx", "?");
  git("add", "*.rx");
  git("-c", "user.name=rx-map", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "Add fixture");
  const c = client(t, ["--root", root]);
  assert.equal(await c.text("check"), "ok");
  assert.deepEqual((await c.json("overview")).map(x => x.file), ["dep.rx", "main.rx", "other.rx"]);
  put("dep.rx", "export source count := 1\nsource another := 2\n");
  utimesSync(join(root, "dep.rx"), new Date(), new Date(Date.now() + 1000));
  assert.equal((await c.json("find", { query: "another" }))[0].key, "dep.rx||another");
  assert.match(await c.text("diff"), /added source another.*dep.rx\|\|another.*dep.rx:2/);
  assert.equal((await c.call("diff", { ref: "not-a-ref" })).isError, true);
  put("main.rx", "source broken :=\n");
  assert.match(await c.text("check"), /^main\.rx:\d+:\d+\s+error/);
  assert.equal((await c.call("overview")).isError, true);
  // One broken dependency must not hide an independent checker error
  // in the same entry's graph.
  put("dep.rx", "export source count := 1\nsource broken :=\n");
  put("main.rx", 'import { count } from "./dep.rx"\nresult = count + missing\n');
  const batch = await c.text("check");
  assert.match(batch, /dep\.rx:.*error PARSE/);
  assert.match(batch, /main\.rx:.*error UNBOUND/);
});

test("HTTP and MCP live tools select the newest page, correlate replies, and report disconnects", { timeout: 10000 }, async t => {
  const ws = new EventEmitter();
  let endpoint;
  const http = createServer((req, res) => { req.url = ""; void endpoint(req, res); });
  const config = { ws, middlewares: { use(path, fn) { assert.equal(path, "/__rx/live"); endpoint = fn; } }, printUrls() {} };
  rxMap().configureServer(config);
  await new Promise(r => http.listen(0, "127.0.0.1", r));
  t.after(() => http.close());
  const dev = `http://127.0.0.1:${http.address().port}`, url = `${dev}/__rx/live`;
  const c = client(t, ["--dev", dev]);
  assert.equal((await fetch(url)).status, 503);
  assert.match((await c.call("live_status")).content[0].text, /no page connected/);
  const key = "test.rx||count";
  let oldest;
  const page = flushes => ({
    socket: new EventEmitter(),
    send(event, { id, method, params }) {
      assert.equal(event, LIVE_REQUEST);
      const result = method === "status" ? { flushes, uptime: 15 } : { key: params.key, preview: `${flushes}`, file: "test.rx", line: 1 };
      if (this !== oldest) ws.emit(LIVE_RESPONSE, { id, error: "stale response" }, oldest);
      ws.emit(LIVE_RESPONSE, { id, result }, this);
    },
  });
  oldest = page(2);
  const newest = page(4);
  ws.emit(LIVE_READY, undefined, oldest);
  ws.emit(LIVE_READY, undefined, newest);
  ws.emit(LIVE_READY, undefined, oldest);
  assert.deepEqual((await (await fetch(url)).json()).result, { pages: 2, flushes: 4, uptime: 15 });
  assert.equal(await c.text("value", { key }), `${key}=4  test.rx:1`);
  newest.socket.emit("close");
  assert.deepEqual(await c.json("live_status"), { pages: 1, flushes: 2, uptime: 15 });
  oldest.socket.emit("close");
  assert.equal((await fetch(url)).status, 503);
});
