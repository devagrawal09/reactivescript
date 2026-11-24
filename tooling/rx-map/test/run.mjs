#!/usr/bin/env node
// Runs the live-mode harnesses in headless Chromium and checks what they report.
//
//   node test/run.mjs                 # live.html (made-up messages) and engine.html (a real Solid dev build)
//   node test/run.mjs --shots <dir>   # also writes screenshots of the lit map
//
// Needs `rxc` (as for the CLI: $RXC, compiler/target/{release,debug}/rxc, PATH) and a Chromium: $CHROME, else
// Playwright's headless shell. engine.html needs Solid's built dev dists: $SOLID_PACKAGES (a solid checkout's
// `packages` dir); without it that part is skipped.
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph } from "../graph.mjs";

const here = fileURLToPath(new URL("..", import.meta.url));
const repo = resolve(here, "../..");
const args = process.argv.slice(2);
const shots = args.includes("--shots") ? resolve(args[args.indexOf("--shots") + 1]) : null;

const rxc = process.env.RXC ?? [resolve(repo, "compiler/target/release/rxc"), resolve(repo, "compiler/target/debug/rxc")].find(existsSync) ?? "rxc";
const chrome = process.env.CHROME ?? (() => {
  const base = join(homedir(), ".cache/ms-playwright");
  const dir = existsSync(base) && readdirSync(base).filter(d => d.startsWith("chromium_headless_shell")).sort().pop();
  return dir ? join(base, dir, "chrome-headless-shell-linux64/chrome-headless-shell") : "chromium";
})();
const solid = process.env.SOLID_PACKAGES ?? resolve(repo, "../store-proto-base/packages");

const model = JSON.parse(execFileSync(rxc, ["model", "examples/users.rx"], { cwd: repo, encoding: "utf8" }));
const graph = buildGraph(model, { root: repo });
graph.title = "users.rx";
const graphJSON = JSON.stringify(graph);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json" };
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/graph.json") return res.writeHead(200, { "content-type": TYPES[".json"] }).end(graphJSON);
  const [root, path] = url.pathname.startsWith("/solid/") ? [solid, url.pathname.slice(7)] : [here, url.pathname.slice(1)];
  const file = resolve(root, path);
  if (!file.startsWith(root) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const run = (url, extra, budget = 8000) => new Promise((ok, fail) => execFile(chrome,
  ["--no-sandbox", "--headless", "--disable-gpu", "--window-size=1400,900", `--virtual-time-budget=${budget}`, ...extra, url],
  { maxBuffer: 1 << 26 }, (e, out) => (e ? fail(e) : ok(out))));
const result = async (page, budget) => {
  const dom = await run(`${origin}/test/${page}`, ["--dump-dom"], budget);
  const m = /<pre id="result"[^>]*>([\s\S]*?)<\/pre>/.exec(dom);
  const text = m?.[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  if (!text) return { ok: false, checks: [{ what: `${page} reported nothing`, ok: false }] };
  return JSON.parse(text);
};

let failed = 0;
const report = (page, r) => {
  for (const c of r.checks) {
    console.log(`${c.ok ? "ok  " : "FAIL"} ${page}: ${c.what}${c.ok ? "" : `\n     got: ${JSON.stringify(c.got)}`}`);
    if (!c.ok) failed++;
  }
};
try {
  report("live.html", await result("live.html"));
  report("fake.html", await result("fake.html", 30000));
  if (existsSync(join(solid, "solid/dist/solid.dev.js"))) report("engine.html", await result("engine.html"));
  else console.log(`skip engine.html: no Solid dev build at ${solid} (set SOLID_PACKAGES)`);
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await run(`${origin}/test/live.html?shot`, [`--screenshot=${join(shots, "live.png")}`]);
    console.log(`wrote ${join(shots, "live.png")}`);
  }
} finally {
  server.close();
}
if (failed) { console.log(`${failed} failed`); process.exit(1); }
