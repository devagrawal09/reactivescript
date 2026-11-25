import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { LIVE_READY, LIVE_REQUEST, LIVE_RESPONSE, LIVE_TRACE } from "../live-protocol.mjs";
import { rxMap } from "../vite.mjs";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
const cli = fileURLToPath(new URL("../rx-map.mjs", import.meta.url));
const RXC = process.env.RXC ?? ["release", "debug"].map(mode => join(repo, `compiler/target/${mode}/rxc`)).find(existsSync) ?? "rxc";
const request = (id, method, params) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
function client(t, args, env = { ...process.env, RXC }) {
  const child = spawn(process.execPath, [cli, "mcp", ...args], { env, stdio: ["pipe", "pipe", "inherit"] });
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
  assert.deepEqual(list.map(x => x.name), ["check", "overview", "find", "node", "reach", "boundary", "diff", "coverage", "uncovered", "live_status", "tail", "record", "value", "state", "why", "pending"]);
  assert.ok(list.every(t => t.annotations.readOnlyHint === (t.name !== "record")));
  assert.equal((await c.call("node")).isError, true);
  assert.equal((await c.call("reach", { key: "x", direction: "sideways" })).isError, true);
  assert.equal((await c.call("unknown")).isError, true);
  assert.equal((await c.rpc("resources/read", { uri: "rx://wrong" })).error.code, -32602);
});

test("static queries and resources on notes", { timeout: 60000 }, async t => {
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
  assert.match(await c.text("check"), /^main\.rx:\d+:\d+\s+PARSE/);
  assert.match(await c.text("overview"), /^program has 1 error; answers from the last good build at .+; changed since: main\.rx/m);
  const stale = await c.call("node", { key: "main.rx||result", format: "json" });
  assert.equal(JSON.parse(stale.content[0].text).declaration.trim(), "result = count + 1");
  assert.match(stale.content[1].text, /last good build/);
  const { freshness } = JSON.parse(stale.content[2].text);
  assert.equal(freshness.find(e => e.entry === "main.rx").status, "last good build");
  assert.equal(freshness.find(e => e.entry === "other.rx").status, "current");
  // One broken dependency must not hide an independent checker error
  // in the same entry's graph.
  put("dep.rx", "export source count := 1\nsource broken :=\n");
  put("main.rx", 'import { count } from "./dep.rx"\nresult = count + missing\n');
  const batch = await c.text("check");
  assert.match(batch, /dep\.rx:\d+:\d+ PARSE/);
  assert.match(batch, /main\.rx:\d+:\d+ UNBOUND/);
  assert.match(await c.text("reach", { key: "dep.rx||count", depth: 1 }), /main\.rx\|\|result/);
  put("dep.rx", "export source count := 1\n");
  put("main.rx", 'import { count } from "./dep.rx"\nresult = count + 2\n');
  assert.doesNotMatch(await c.text("overview"), /last good build/);
  assert.match(await c.text("node", { key: "main.rx||result" }), /count \+ 2/);
});

test("field queries and search visibility through MCP", { timeout: 10000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "rx-map-fields-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "live.rx"), `import pure { liveImport } from "./api"
source ui := { hidden: false, count: 0 }
action replace() { ui := { hidden: true, count: 1 } }
hiddenReader = ui.hidden
countReader = ui.count
live = hiddenReader
`);
  const c = client(t, ["--root", root]);
  const rootKey = "live.rx||ui", key = `${rootKey}.hidden`;
  assert.equal((await c.json("find", { query: "live" }))[0].key, "live.rx||live");
  assert.deepEqual((await c.json("find", { query: "live" })).map(n => n.key), ["live.rx||live"]);
  assert.ok(!(await c.json("find", { query: "live" })).some(n => n.kind === "import"));
  assert.ok((await c.json("find", { query: "live", imports: true })).some(n => n.kind === "import"));
  assert.doesNotMatch(await c.text("overview"), /liveImport/);
  assert.match(await c.text("overview", { imports: true }), /liveImport/);
  assert.equal((await c.json("find", { query: key }))[0].key, key);
  const field = await c.json("node", { key });
  assert.deepEqual(field.readBy.map(r => r.key), ["live.rx||hiddenReader"]);
  assert.deepEqual(field.writtenBy.map(w => w.key), ["live.rx||replace"]);
  const overview = await c.json("node", { key: rootKey });
  assert.deepEqual(overview.fields.map(f => f.field), ["count", "hidden"]);
  assert.deepEqual((await c.json("reach", { key, depth: 2 })).map(n => n.key), ["live.rx||hiddenReader", "live.rx||live"]);
  assert.deepEqual((await c.json("reach", { key, direction: "up", depth: 1 })).map(n => n.key), ["live.rx||replace"]);
});

test("nested MCP field queries distinguish sibling reads and writes", { timeout: 10000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "rx-map-paths-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "state.rx");
  writeFileSync(file, `source ui := { panel: { hidden: false, count: 0 } }
action hide() { ui.panel.hidden := true }
action bump() { ui.panel.count := 1 }
hiddenReader = ui.panel.hidden
countReader = ui.panel.count
`);
  const model = JSON.parse(execFileSync(RXC, ["model", file], { encoding: "utf8" }))[0];
  // rx/integ's compiler predates nested edges. Still test its safe fallback.
  const precise = process.env.RX_MAP_TEST_FIELD_PATHS === "1" || model.computations.some(c => c.writes.some(w => w.field));
  const c = client(t, ["--root", root]);
  const key = "state.rx||ui.panel.hidden";
  const data = await c.json("node", { key });
  assert.deepEqual(data.readBy.map(r => r.key), precise ? ["state.rx||hiddenReader"] : ["state.rx||hiddenReader", "state.rx||countReader"]);
  assert.deepEqual(data.writtenBy.map(w => w.key), precise ? ["state.rx||hide"] : ["state.rx||hide", "state.rx||bump"]);
  if (precise) {
    assert.equal(data.writtenBy[0].field, "panel.hidden");
    assert.deepEqual((await c.json("reach", { key, direction: "up" })).map(n => n.key), ["state.rx||hide"]);
    assert.equal((await c.json("find", { query: key }))[0].key, key);
  }
});

test("HTTP and MCP live tools select the newest page, correlate replies, and report disconnects", { timeout: 10000 }, async t => {
  const ws = new EventEmitter();
  const endpoints = new Map();
  const http = createServer((req, res) => { const endpoint = endpoints.get(req.url); req.url = ""; void endpoint(req, res); });
  const config = { ws, config: { root: repo }, middlewares: { use(path, fn) { endpoints.set(path, fn); } }, printUrls() {} };
  rxMap().configureServer(config);
  await new Promise(r => http.listen(0, "127.0.0.1", r));
  t.after(() => http.close());
  const dev = `http://127.0.0.1:${http.address().port}`, url = `${dev}/__rx/live`;
  const c = client(t, ["--dev", dev]);
  const httpRpc = async (method, params) => (await fetch(`${dev}/__rx/mcp`, { method: "POST",
    headers: { "content-type": "application/json" }, body: request(1, method, params) })).json();
  assert.deepEqual((await httpRpc("tools/list")).result, (await c.rpc("tools/list")).result);
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
  await c.json("record", { action: "start" });
  ws.emit(LIVE_TRACE, { type: "flight", at: 100, key, state: "start" }, newest);
  ws.emit(LIVE_TRACE, { type: "flush", at: 120, changes: [{ key: null, name: "internal" }] }, newest);
  ws.emit(LIVE_TRACE, { type: "flight", at: 250, key, state: "land" }, newest);
  newest.socket.emit("close");
  const trace = await c.json("record", { action: "stop" });
  assert.deepEqual(trace.records.map(r => [r.type, r.at]), [["flight", 0], ["flight", 150]]);
  await c.json("record", { action: "start" });
  ws.emit(LIVE_TRACE, { type: "flush", at: 300, changes: [{ key, instance: "1" }, { key, instance: "2" }] }, oldest);
  ws.emit(LIVE_TRACE, { type: "revert", at: 305, key, instance: "2", reason: "superseded" }, oldest);
  const filtered = await c.text("record", { action: "stop", key, instance: "2", kinds: ["revert"] });
  assert.match(filtered, /instance 2.*revert superseded \(replaced by the answer, not a failure\)/);
  assert.deepEqual((await c.json("tail", { key, instance: "2", kinds: ["flush"] })).at(-1).changes, [{ key, instance: "2" }]);
  ws.emit(LIVE_TRACE, { type: "flush", at: 310, changes: [{ key, path: "total" }, { key, path: "count" }, { key: "test.rx||other" }] }, oldest);
  assert.deepEqual((await c.json("tail", { key: `${key}.total`, limit: 1 }))[0].changes, [{ key, path: "total" }]);
  assert.equal((await c.json("tail", { key: `${key}.total`, whole: true, limit: 1 }))[0].changes.length, 3);
  assert.equal((await httpRpc("tools/call", { name: "travel", arguments: { seq: 1 } })).result.isError, true);
  assert.deepEqual(await c.json("live_status"), { pages: 1, flushes: 2, uptime: 15 });
  oldest.socket.emit("close");
  assert.equal((await fetch(url)).status, 503);
});

test("warm HTTP MCP keeps a last-good graph after watcher invalidation", { timeout: 10000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "rx-map-warm-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "main.rx");
  writeFileSync(file, "source count := 1\n");
  const endpoints = new Map();
  const server = createServer((req, res) => { const fn = endpoints.get(req.url); req.url = ""; void fn(req, res); });
  const watcher = new EventEmitter();
  rxMap().configureServer({ config: { root }, ws: new EventEmitter(), watcher, httpServer: server,
    middlewares: { use(path, fn) { endpoints.set(path, fn); } }, printUrls() {} });
  globalThis[Symbol.for("reactivescript.vite.entries")].get(root)(file, true);
  const deleted = join(root, "deleted.rx"), declaration = join(root, "browser.d.rx");
  writeFileSync(deleted, "source other := 2\n");
  writeFileSync(declaration, "export pure fn trouble(): ref boolean\n");
  globalThis[Symbol.for("reactivescript.vite.entries")].get(root)(declaration, true, {
    check() { throw new Error("declarations are not entries"); },
  });
  globalThis[Symbol.for("reactivescript.vite.entries")].get(root)(deleted, true);
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const call = async name => (await (await fetch(`http://127.0.0.1:${server.address().port}/__rx/mcp`, {
    method: "POST", headers: { "content-type": "application/json" }, body: request(1, "tools/call", { name }),
  })).json()).result;
  assert.match((await call("overview")).content[0].text, /main\.rx\|\|count/);
  assert.equal((await call("check")).content[0].text, "ok");
  rmSync(deleted);
  rmSync(declaration);
  watcher.emit("all", "unlink", deleted);
  watcher.emit("all", "unlink", declaration);
  assert.equal((await call("check")).content[0].text, "ok");
  assert.doesNotMatch((await call("overview")).content[0].text, /deleted\.rx|browser\.d\.rx/);
  writeFileSync(file, "source broken :=\n");
  watcher.emit("all", "change", file);
  const stale = (await call("overview")).content[0].text;
  assert.match(stale, /^program has 1 error; answers from the last good build at .+; changed since: main\.rx/);
  assert.match(stale, /main\.rx\|\|count/);
  assert.match((await call("check")).content[0].text, /PARSE/);
});

test("warm MCP check runs the Vite RX frontend without RXC and flags old transforms", { timeout: 10000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "rx-map-frontend-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "main.rx"), declaration = join(root, "adapter.d.rx");
  writeFileSync(file, `import { trouble } from "./adapter"\nexport default component App() {\n  flag = trouble()\n  <p>{flag}</p>\n}\n`);
  writeFileSync(declaration, "export pure fn trouble(): ref boolean\n");
  writeFileSync(join(root, "adapter.ts"), "export const trouble = () => () => false;\n");
  let frontend;
  try { frontend = (await import("../../../compiler/vite.mjs")).default(); }
  catch (e) { if (/native binding/.test(e.message)) return t.skip("Node-API compiler is not built"); throw e; }
  const endpoints = new Map(), server = new EventEmitter();
  rxMap().configureServer({ config: { root }, ws: new EventEmitter(), watcher: new EventEmitter(), httpServer: server,
    middlewares: { use(path, fn) { endpoints.set(path, fn); } }, printUrls() {} });
  t.after(() => server.emit("close"));
  const ctx = { id: file, moduleId: file, root, solid: { generate: "dom", dev: true, hydratable: false }, addWatchFile() {} };
  frontend.compile("", ctx);
  const http = createServer((req, res) => { req.url = ""; void endpoints.get("/__rx/mcp")(req, res); });
  await new Promise(r => http.listen(0, "127.0.0.1", r));
  t.after(() => http.close());
  const check = async () => (await (await fetch(`http://127.0.0.1:${http.address().port}`, { method: "POST",
    headers: { "content-type": "application/json" }, body: request(1, "tools/call", { name: "check" }) })).json()).result.content[0].text;
  assert.equal(await check(), "ok");
  writeFileSync(declaration, "export pure fn trouble(): ref boolean\n// edited\n");
  assert.match(await check(), /stale entry transform: main\.rx \(changed: adapter\.d\.rx\).*Touch main\.rx.*\nok$/);
  frontend.compile("", ctx);
  assert.equal(await check(), "ok");
  writeFileSync(declaration, "export pure fn trouble(\n");
  assert.match(await check(), /adapter\.d\.rx:\d+:\d+ [A-Z]+/);
});

test("reach follows the argument into its prop, not its sibling", { timeout: 10000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "rx-map-props-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "main.rx"), `source left := 1
source right := 2
component Row(props: { left: number, right: number }) {
  leftText = props.left + 1
  rightText = props.right + 1
  <p>{leftText} {rightText}</p>
}
export default component App() {
  <Row left={left} right={right} />
}
`);
  const c = client(t, ["--root", root]);
  const down = (await c.json("reach", { key: "main.rx||left" })).map(r => r.key);
  assert.ok(down.includes("main.rx|Row|leftText"));
  assert.ok(!down.includes("main.rx|Row|rightText"));
  const up = (await c.json("reach", { key: "main.rx|Row|rightText", direction: "up" })).map(r => r.key);
  assert.ok(up.includes("main.rx||right"));
  assert.ok(!up.includes("main.rx||left"));
});

// 09 MO-11: a JS import's declaration generated from the sibling .ts (brands), a written .d.rx line, the default.
function tsModuleApp(t) {
  const root = mkdtempSync(join(tmpdir(), "rx-map-dts-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (f, s) => writeFileSync(join(root, f), s);
  mkdirSync(join(root, "node_modules/@reactivescript"), { recursive: true });
  symlinkSync(join(repo, "types"), join(root, "node_modules/@reactivescript/types"), "dir");
  symlinkSync(join(repo, "compiler"), join(root, "node_modules/@reactivescript/compiler"), "dir");
  symlinkSync(realpathSync(join(repo, "ref/node_modules/typescript")), join(root, "node_modules/typescript"), "dir");
  const users = [
    'import type { Pure, Rejects } from "@reactivescript/types";',
    "export class NotFound extends Error {}",
    "export function initials(name: string): Pure<string> { return name.slice(0, 1); }",
    "export async function save(name: string): Promise<void> { void name; }",
    "export async function logVisit(page: string): Promise<void> { void page; }",
    "",
  ].join("\n");
  put("users.ts", users);
  put("users.d.rx", "export fn save(name: string): Promise<void> rejects(NotFound)\n");
  put("main.rx", [
    'import { initials, save, logVisit, NotFound } from "./users"',
    "export default component App() {",
    '  source name := "ada"',
    '  source status := ""',
    "  first = initials(name)",
    '  action store() { try { await save(name); await logVisit("x"); status := "saved" } catch (e) { status := "failed" } }',
    "  <p>{first}{status}</p>",
    "}",
    "",
  ].join("\n"));
  return { root, put, users };
}
async function declarations(c) {
  const imported = async name => (await c.json("node", { key: `main.rx||${name}` })).imported;
  assert.deepEqual(await imported("initials"), { line: "export pure fn initials(name: string): string", from: "users.ts", origin: "brand", brands: ["Pure"] });
  assert.deepEqual(await imported("save"), { line: "export fn save(name: string): Promise<void> rejects(NotFound)", from: "users.d.rx", origin: "written" });
  assert.deepEqual(await imported("logVisit"), { line: "export fn logVisit(page: string): Promise<void>", from: "users.ts", origin: "default" });
  assert.match(await c.text("node", { key: "main.rx||initials" }), /^  imported: export pure fn initials\(name: string\): string  from users\.ts  \(brand: Pure\)$/m);
  assert.match(await c.text("node", { key: "main.rx||save" }), /^  imported: .* from users\.d\.rx  \(written\)$/m);
}

test("MO-11 through $RXC: rxc runs $RX_DTS; node shows each import's declaration; check reports a misplaced brand in the .ts", { timeout: 30000 }, async t => {
  const { root, put, users } = tsModuleApp(t);
  const c = client(t, ["--root", root], { ...process.env, RXC, RX_DTS: `${process.execPath} ${join(repo, "compiler/bin/rx-dts.mjs")}` });
  assert.equal(await c.text("check"), "ok");
  await declarations(c);
  put("users.ts", users + "export function score(n: Pure<number>): number { return n; }\n");
  utimesSync(join(root, "users.ts"), new Date(), new Date(Date.now() + 2000));
  assert.match(await c.text("check"), /^users\.ts:6:\d+\s+DECLARATION_BRAND/m);
  put("main.rx", 'import { remove } from "./users"\nexport default component App() { <p>x</p> }\n');
  assert.match(await c.text("check"), /^main\.rx:1:\d+\s+NOT_EXPORTED/m);
});

test("MO-11 through Node-API: the declare callback answers rx-dts in process", { timeout: 30000 }, async t => {
  try { createRequire(import.meta.url)(join(repo, "compiler")); } catch (e) { if (/native binding/i.test(e.message)) return t.skip("Node-API compiler is not built"); throw e; }
  const { root, put, users } = tsModuleApp(t);
  const env = { ...process.env, RX_DTS: join(root, "no-such-rx-dts") };
  delete env.RXC;
  const c = client(t, ["--root", root], env);
  await declarations(c);
  // the generator's files invalidate the snapshot: an edit to the .ts alone reaches the graph
  put("users.ts", users.replace("logVisit(page: string): Promise<void>", "logVisit(page: string): Pure<Promise<void>>"));
  utimesSync(join(root, "users.ts"), new Date(), new Date(Date.now() + 2000));
  assert.deepEqual((await c.json("node", { key: "main.rx||logVisit" })).imported, { line: "export pure fn logVisit(page: string): Promise<void>", from: "users.ts", origin: "brand", brands: ["Pure"] });
  put("users.ts", users + "export function score(n: Pure<number>): number { return n; }\n");
  utimesSync(join(root, "users.ts"), new Date(), new Date(Date.now() + 4000));
  assert.match(await c.text("overview"), /^program has 1 error/m);
});
