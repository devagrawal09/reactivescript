// NODE_PATH=<directory containing playwright> node test/coverage-page.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { pageHTML } from "../page.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const graph = JSON.parse(readFileSync(new URL("./fixtures/users.json", import.meta.url), "utf8"));
const module = graph.modules[0];
const [source, action, equation] = ["page", "rename", "users"].map(name => graph.nodes.find(n => n.name === name));
const loading = graph.regions.find(r => r.kind === "loading");
const paths = [
  { id: `node:${source.key}`, kind: "node", target: source.key, label: "page changes", line: source.line },
  { id: `action:${action.key}:ok`, kind: "action", target: action.key, label: "rename succeeds", line: action.line },
  { id: `loading:${loading.key}`, kind: "loading", target: loading.key, label: "loading shows its fallback", line: 55 },
  { id: `edge:${source.key}->${equation.key}`, kind: "edge", target: equation.key, label: "page carries a change to users", line: equation.line },
];
const coverage = {
  rxCoverage: 1, modules: [module], paths: Object.fromEntries(paths.map(p => [p.id, { ...p, module }])),
  hits: { [paths[0].id]: { n: 3, by: ["next page"] } }, runs: [],
};
const msg = (type, fields) => ({ source: "rx-map", v: 1, type, ...fields });
const change = (seq, preview) => msg("flush", { seq, at: seq * 10, changes: [{ key: source.key, name: source.name, preview }] });
const trace = {
  rxTrace: 1, graph, test: "renaming a user", error: "Expected Grace </script> /*__GRAPH__*/null",
  messages: [
    msg("snapshot", { at: 90, values: [{ key: source.key, preview: "1" }] }),
    msg("timeline", { head: 9, steps: [{ seq: 9, at: 90, changes: [] }] }),
    msg("run", { key: action.key, id: 1, at: 95, state: "start" }),
    change(10, "2"),
    msg("boundary", { region: loading.key, state: "fallback", at: 101 }),
    msg("revert", { key: source.key, reason: "rejected", at: 102 }),
    msg("run", { key: action.key, id: 1, at: 103, state: "error", error: "NotFound: Grace" }),
    change(11, "3"),
  ],
};

const pages = new Map([
  ["/coverage", pageHTML(graph, { coverage })],
  ["/live", pageHTML(graph, { live: true })],
  ["/trace", pageHTML(graph, { trace })],
]);
const server = createServer((req, res) => {
  const html = pages.get(new URL(req.url, "http://local").pathname);
  res.writeHead(html ? 200 : 404, { "content-type": "text/html; charset=utf-8" }).end(html);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", e => { if (e.type() === "error") errors.push(e.text()); });
  const go = path => page.goto(`http://127.0.0.1:${server.address().port}${path}`);
  const select = id => page.evaluate(id => window.select(id, false), id);

  await go("/coverage");
  const chip = page.locator("#coverageChip");
  assert.equal(await chip.textContent(), "coverage 25%");
  assert.deepEqual(await page.locator(".psum .ps-coverage").allTextContents(), ["coverage 1/4"]);
  assert.equal(await page.locator(".cov-uncovered").count(), 2, "only the uncovered action and loading region dim");
  assert.equal(await page.locator(".cov-dot").count(), 2);
  assert.equal(await page.locator(`.chip[data-id="${action.id}"] .n`).evaluate(e => getComputedStyle(e).opacity), "0.42");
  for (let i = 0; i < 4; i++) await page.locator("#zoomIn").click();
  const faint = page.locator("#edges .cov-faint");
  await faint.first().waitFor({ state: "attached" });
  assert.equal(await faint.count(), 1);
  assert.equal(await faint.first().getAttribute("opacity"), "0.18");
  await select(source.id);
  assert.match(await page.locator(".coverage-paths").textContent(), /✓page changesby next page/);
  await select(action.id);
  assert.match(await page.locator(".coverage-paths").textContent(), /✗rename succeeds/);
  await chip.click();
  assert.equal(await chip.getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator(".cov-uncovered, .cov-dot, .cov-faint, .ps-coverage").count(), 0);

  await go("/live?coverage=live");
  await chip.waitFor();
  assert.match(await chip.getAttribute("title"), /^0\/[1-9][0-9]* paths/);
  const feed = messages => page.evaluate(ms => ms.forEach(m => window.__RX_VIEW__.receive(m)), messages);
  await feed([change(1, "1"), change(2, "1"), msg("step", { from: 2, to: 1, changes: change(1, "99").changes })]);
  assert.match(await chip.getAttribute("title"), /^0\//, "mount, duplicate preview and travel don't count");
  await feed([change(3, "2"), msg("boundary", { region: loading.key, state: "fallback", at: 31 })]);
  await page.waitForFunction(() => document.querySelector("#coverageChip")?.title.startsWith("2/"));

  await go("/trace");
  const scrub = page.locator("#scrub");
  const steps = trace.messages.filter(m => m.type === "flush").length;
  await page.waitForFunction(n => document.querySelector("#scrub")?.dataset.steps === String(n), steps);
  assert.equal(await scrub.getAttribute("data-steps"), String(steps));
  assert.match(await scrub.textContent(), /a recording: travel needs the app/);
  assert.equal(await page.locator("#track").getAttribute("role"), "img");
  assert.equal(await page.locator("#liveBtn").count(), 0);
  const badge = await page.locator("#traceBadge").textContent();
  assert.ok(badge.includes(trace.test) && badge.includes(trace.error));
  assert.equal(await page.locator('[data-trace-event="run"]').count(), 2);
  assert.equal(await page.locator('[data-trace-event="boundary"]').count(), 1);
  assert.equal(await page.locator('[data-trace-event="revert"]').count(), 1);
  assert.equal(await page.evaluate(key => window.__RX_VIEW__.values()[key], source.key), "3");
  assert.deepEqual(errors.filter(e => !e.includes("404")), []);
  console.log("ok: static coverage, live coverage, trace replay");
} finally {
  await browser?.close();
  server.close();
}
