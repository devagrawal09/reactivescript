#!/usr/bin/env node
// From tooling/rx-map: node app/build.mjs && node test/shots.mjs <outdir>
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { diffGraphs } from "../diff.mjs";
import { buildGraph } from "../graph.mjs";
import { pageHTML as vanilla } from "../page.mjs";

if (process.argv.length !== 3) {
  console.error("usage: node test/shots.mjs <outdir>");
  process.exit(2);
}
const outdir = resolve(process.argv[2]);
const repo = fileURLToPath(new URL("../../..", import.meta.url));
const { chromium } = createRequire("/home/lucifer/.npm/_npx/e41f203b7505f1fb/node_modules/")("playwright");
const executablePath = process.env.CHROME ?? "/home/lucifer/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell";
const rxc = process.env.RXC ?? [resolve(repo, "compiler/target/release/rxc"), resolve(repo, "compiler/target/debug/rxc")].find(existsSync) ?? "rxc";
const graphOf = entry => {
  const model = JSON.parse(execFileSync(rxc, ["model", entry], { cwd: repo, encoding: "utf8", maxBuffer: 1 << 28 }));
  return { ...buildGraph(model, { root: repo }), title: entry.replace(/^examples\//, "") };
};

const users = graphOf("examples/users.rx");
// The largest of the current examples when built individually (75 nodes).
const big = graphOf("examples/ai2/settings/main.rx");
const node = name => {
  const n = users.nodes.find(n => n.key === `examples/users.rx||${name}`);
  if (!n) throw new Error(`users.rx is missing ${name}`);
  return n;
};
const key = name => node(name).key;
const chip = name => `#board .chip[data-id="${node(name).id}"]`;
const change = (name, preview, prev) => ({ key: key(name), name: `rx:${key(name)}`, preview, prev });

// The fixtures are single snapshots, not a before/after pair.
const edited = structuredClone(users);
const renamed = edited.nodes.find(n => n.key === key("status"));
renamed.name = "userCountLabel";
renamed.key = "examples/users.rx||userCountLabel";
renamed.decl = renamed.decl?.replace(/\bstatus\b/, renamed.name);
for (const line of [renamed.line, ...edited.edges.filter(e => e.type === "read" && e.from === renamed.id).map(e => e.line)]) {
  if (edited.lines[renamed.file]?.[line]) edited.lines[renamed.file][line] = edited.lines[renamed.file][line].replace(/\bstatus\b/, renamed.name);
}
const write = edited.edges.find(e => e.from === node("rename").id && e.to === node("users").id && e.op === "write");
if (!write) throw new Error("users.rx is missing rename's write to users");
write.op = "refresh";
const diff = diffGraphs({ ...users, label: "original" }, { ...edited, label: "edited" });
diff.title = "users.rx · original → edited";

const steps = [
  { cause: key("nextPage"), changes: [change("page", "2", "1")] },
  { changes: [change("total", "4", "0")] },
  { cause: key("search"), changes: [change("query", '"ada"', '""'), change("page", "1", "2")] },
  { changes: [change("total", "1", "4")] },
  { cause: key("search"), changes: [change("query", '"grace"', '"ada"')] },
  { changes: [change("total", "2", "1")] },
].map((s, i) => ({ ...s, seq: i + 1, at: (i + 1) * 120 }));
const hmrGraph = structuredClone(users);
hmrGraph.nodes = hmrGraph.nodes.filter(n => n.key !== key("status"));
hmrGraph.edges = hmrGraph.edges.filter(e => e.from !== node("status").id && e.to !== node("status").id);
hmrGraph.nodes.push({ ...node("status"), id: "shot:added", name: "resultsLabel", key: "examples/users.rx||resultsLabel" });
const reasons = { [key("page")]: "unchanged", [key("users")]: "unchanged", [key("query")]: "type-changed",
  [key("total")]: "expr-changed", "examples/users.rx||resultsLabel": "new", [key("status")]: "gone" };
const boundary = users.regions.find(r => r.kind === "errored") ?? users.regions.find(r => r.kind === "loading");
const failure = "ServerError: listUsers 503";
const flush = { type: "flush", seq: 1, at: 120, cause: key("nextPage"), origin: 'click button "Next"',
  changes: [change("page", "2", "1"), change("total", "4", "3"), change("status", '"loading…"', '"3 users"')] };
const post = (page, ...messages) => page.evaluate(messages => {
  for (const message of messages) window.postMessage({ source: "rx-map", v: 1, ...message }, "*");
}, messages);
const visible = (page, selector) => page.locator(selector).first().waitFor({ state: "visible" });

const live = { live: true };
const scenarios = [
  { name: "static", caption: "users.rx with no live host" },
  { name: "diff", graph: diff, caption: "users.rx: status → userCountLabel; rename → users changes from a write to a refresh" },
  { name: "live", opts: live, caption: "One flush, users request in flight, and page selected", async run(page) {
    await post(page, flush, { type: "flight", key: key("users"), state: "start", at: 120 });
    await visible(page, `${chip("users")}.flying`);
    await page.locator(chip("page")).click();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
  } },
  { name: "fake", opts: { fake: 3 }, caption: "Fake host, seed 3: about two seconds of ticks, then two actions", async run(page) {
    await page.waitForTimeout(2000);
    const acted = await page.evaluate(() => {
      const host = window.__RX_FAKE__;
      if (typeof host?.act !== "function") return false;
      host.act();
      host.act();
      return true;
    });
    if (!acted) throw new Error("Fake host did not expose __RX_FAKE__.act()");
    await page.waitForTimeout(350);
  } },
  { name: "travel", opts: live, caption: "Six recorded steps; rewind from #6 to #2", async run(page) {
    await post(page, { type: "timeline", head: 6, viewing: null, capacity: 2000, steps },
      { type: "step", from: 6, to: 2, direction: "back",
        changes: [change("total", "4", "2"), change("page", "2", "1"), change("query", '""', '"grace"')] });
    await visible(page, "#liveBadge:text-is('viewing #2 of 6')");
    await page.waitForTimeout(350);
  } },
  { name: "hmr", opts: live, caption: "Reload plan preview: kept, reset, re-run, added and removed nodes", async run(page) {
    await post(page, { type: "hmr", phase: "plan", id: "h1", modules: users.modules, graph: hmrGraph, plan: {
      kept: [key("page"), key("users")], reset: [key("query")], rerun: [key("total")],
      added: ["examples/users.rx||resultsLabel"], removed: [key("status")], moved: [], reasons,
    } });
    await visible(page, "#panel :text('Module replacement')");
    await page.waitForTimeout(350);
  } },
  { name: "failures", opts: live, caption: "A failed users value and the App error boundary showing its fallback", async run(page, _context, viewport) {
    if (!boundary) throw new Error("users.rx has no error or loading boundary");
    await post(page, { type: "snapshot", at: 120, values: [{ key: key("users"), error: failure }],
      flights: [], runs: [], held: [], boundaries: [{ region: boundary.key ?? boundary.id, state: "error", error: failure }] });
    await visible(page, `${chip("users")}.failed`);
    await visible(page, ".frame.tripped .trip");
    // The source is at the top of the board, but the boundary is below Row. Frame both.
    const compact = viewport.height < 500;
    const canvas = page.locator("#canvas");
    await canvas.dispatchEvent("wheel", { ctrlKey: true, deltaY: compact ? 375 : 150,
      clientX: viewport.width / 2, clientY: viewport.height / 2 });
    await canvas.dispatchEvent("wheel", { deltaY: compact ? 100 : 110 });
    await page.waitForTimeout(350);
  } },
  { name: "held", opts: live, caption: "query's write is held waiting on the search action", async run(page) {
    await post(page, { type: "snapshot", at: 110, values: [{ key: key("query"), preview: '""' }], flights: [], runs: [], boundaries: [] },
      { type: "held", key: key("query"), by: [key("search")], at: 120 });
    await visible(page, `${chip("query")}.held .hm`);
  } },
  { name: "popout", opts: live, caption: "Live window opened with Pop out, carrying the opener's values", async run(page, context, viewport) {
    await post(page, flush);
    if (!(await page.locator("#popBtn").count())) throw new Error("No Pop out button");
    const [popup] = await Promise.all([
      context.waitForEvent("page", { timeout: 3000 }), page.locator("#popBtn").click(),
    ]);
    await popup.setViewportSize(viewport);
    return popup;
  }, async ready(popup) {
    await visible(popup, "#liveBadge:text-is('live · 1 flush')");
    await visible(popup, `${chip("page")} .lv[data-value="2"]`);
  } },
  { name: "big", graph: big, caption: `${big.title} (${big.nodes.length} nodes), the largest example graph` },
];

const variants = [["vanilla", vanilla]];
try { variants.push(["rx", (await import("../app/page.mjs")).pageHTML]); }
catch (error) {
  // Keep the baseline useful even while the rewrite cannot be built.
  variants.push(["rx", () => { throw new Error(`Cannot load app/page.mjs (run node app/build.mjs): ${error.message}`); }]);
}

mkdirSync(outdir, { recursive: true });
const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
const records = {};
async function capture(scenario, viewport, variant, render, filename, skip) {
  const path = join(outdir, filename);
  rmSync(path, { force: true }); // a previous run's PNG must not stand in for a missing shot
  const record = records[filename] = { captured: false, pageErrors: [] };
  if (skip) { record.note = skip; return record; }
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  context.setDefaultTimeout(2000);
  context.on("page", page => {
    page.on("pageerror", error => record.pageErrors.push({ type: "pageerror", message: error.message }));
    page.on("console", msg => {
      if (msg.type() === "error") record.pageErrors.push({ type: "console.error", message: msg.text() });
    });
  });
  try {
    const page = await context.newPage();
    await page.setContent(render(scenario.graph ?? users, scenario.opts), { timeout: 5000 });
    if (scenario.opts?.live) {
      // The vanilla listener ignores its own window's messages to avoid echoing host requests.
      // The rig is iframe-less: relay only our self-posted host messages through the view's public receive hook.
      await page.evaluate(() => addEventListener("message", ev => {
        if (ev.source === window && ev.data?.source === "rx-map" && ev.data?.v === 1) window.__RX_VIEW__.receive(ev.data);
      }));
    }
    let target = page;
    try {
      target = (await scenario.run?.(page, context, viewport)) ?? page;
      await scenario.ready?.(target);
    } catch (error) {
      record.note = `${scenario.name === "popout" && target === page && variant === "vanilla" ? "Skipped: " : ""}${stripVTControlCharacters(error.message)}`;
      if (scenario.name === "popout" && target === page) return record;
      // A partial render is still useful for comparison. Label it, rather than silently passing it off as the scenario.
    }
    // Chromium can miss the first compositor frame on a large board.
    await target.screenshot({ path, timeout: 5000 }).catch(error => {
      if (!error.message.includes("Unable to capture screenshot")) throw error;
      return target.screenshot({ path, timeout: 5000 });
    });
    record.captured = true;
  } catch (error) {
    record.note = stripVTControlCharacters(error.message);
  } finally {
    await context.close();
  }
  return record;
}

const esc = text => String(text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const sections = [];
try {
  for (const scenario of scenarios) for (const viewport of [{ width: 1440, height: 900 }, { width: 1440, height: 360 }]) {
    const size = `${viewport.width}x${viewport.height}`;
    const pair = [];
    for (const [variant, render] of variants) {
      const filename = `${scenario.name}-${size}-${variant}.png`;
      const skip = variant === "rx" && scenario.name === "popout" && !pair[0].record.captured
        ? "Skipped: vanilla did not open a pop-out." : undefined;
      const record = await capture(scenario, viewport, variant, render, filename, skip);
      pair.push({ variant, filename, record });
      console.log(`${record.captured ? "wrote" : "no shot:"} ${filename}${record.note ? ` (${record.note.split("\n")[0]})` : ""}`);
    }
    sections.push(`<section><h2>${scenario.name} · ${size}</h2><p>${esc(scenario.caption)}</p><div class="pair">
${pair.map(({ filename, variant, record }) => {
  const caption = `${variant === "vanilla" ? "Vanilla" : "RX"} · ${scenario.name} · ${size}`;
  return `<figure>${record.captured
    ? `<a href="${filename}"><img src="${filename}" width="${viewport.width}" height="${viewport.height}" alt="${caption}" loading="lazy"></a>`
    : `<div class="missing">No screenshot</div>`}
<figcaption>${caption}${record.pageErrors.length ? ` · ${record.pageErrors.length} browser error(s)` : ""}</figcaption>
${record.note ? `<pre>${esc(record.note)}</pre>` : ""}</figure>`;
}).join("\n")}
</div></section>`);
  }
} finally {
  await browser.close();
  writeFileSync(join(outdir, "errors.json"), JSON.stringify(records, null, 2) + "\n");
  writeFileSync(join(outdir, "index.html"), `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>rx-map: vanilla vs RX</title>
<style>
body { font: 16px system-ui, sans-serif; background: #141922; color: #ebeff6; margin: 2vw }
a { color: #94cbff }
section { margin: 2em 0 }
.pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1em }
figure { margin: 0; min-width: 0 }
img { display: block; width: 100%; height: auto }
figcaption, pre, .missing { background: #232b39; padding: .65em; margin: 0 }
pre { white-space: pre-wrap; overflow-wrap: anywhere; color: #ffb6a4 }
</style>
<h1>rx-map: vanilla vs RX</h1>
<p>Click a screenshot for the full-size PNG. See <a href="errors.json">errors.json</a> for browser and scenario errors.</p>
${sections.join("\n")}
</html>\n`);
}
console.log(`wrote ${join(outdir, "index.html")} and ${join(outdir, "errors.json")}`);
