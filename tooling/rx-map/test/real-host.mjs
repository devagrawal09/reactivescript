#!/usr/bin/env node
// The trace contract's conformance suite against the REAL host (`./live` in a running .rx dev app), plus DOM checks
// of time travel. Not part of `npm test`: it needs a Vite app and a Solid with `openView` (#5089).
//
//   APP=<dir of a Vite .rx app> node test/real-host.mjs [--shots <dir>]
//
// The app is the shelf template (rx-r1-browser) with a deterministic fake server (`save` fails every 4th call, fixed
// delays, counted ids) and `?cap=N` in main.ts setting `globalThis.__RX_TIMELINE_CAPACITY__`. Playwright comes from
// $NODE_PATH; Chromium from $CHROME or Playwright's headless shell.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { runConformanceAsync } from "../conformance.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const args = process.argv.slice(2);
const shots = args.includes("--shots") ? resolve(args[args.indexOf("--shots") + 1]) : null;
const app = resolve(process.env.APP ?? "/tmp/r4-shelf");
const chrome = process.env.CHROME ?? (() => {
  const base = join(homedir(), ".cache/ms-playwright");
  const dir = existsSync(base) && readdirSync(base).filter(d => d.startsWith("chromium_headless_shell")).sort().pop();
  return dir ? join(base, dir, "chrome-headless-shell-linux64/chrome-headless-shell") : undefined;
})();
const TICK = Number(process.env.TICK_MS ?? 80);

// ---- the dev server ------------------------------------------------------------------------------------------------
const port = 3190 + Math.floor(Math.random() * 400);
const vite = spawn(join(app, "node_modules/.bin/vite"), ["--port", String(port), "--strictPort"], { cwd: app, stdio: ["ignore", "pipe", "pipe"] });
let viteLog = "";
vite.stdout.on("data", d => (viteLog += d));
vite.stderr.on("data", d => (viteLog += d));
const origin = `http://localhost:${port}`;
for (let i = 0; !viteLog.includes("Local:"); i++) {
  if (i > 300 || vite.exitCode !== null) { console.error(`vite did not start (exit ${vite.exitCode}) on port ${port}:\n${viteLog}`); process.exit(1); }
  await new Promise(r => setTimeout(r, 100));
}

const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (what, ok, got) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok || got === undefined ? "" : `\n     got: ${typeof got === "string" ? got : JSON.stringify(got)}`}`);
  if (!ok) failed++;
};

// A page of the app, idle (no question in the air, no action running), with a view attached.
async function openApp(query = "") {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); });
  await page.goto(`${origin}/${query}`);
  await page.waitForFunction(() => globalThis.__RX__?.attach && document.querySelector(".counts"), null, { timeout: 15000 });
  await waitIdle(page);
  await page.evaluate(() => {
    // the app's markup; an empty style attribute a click can leave on an element is not the app's
    const t = (globalThis.__T = { msgs: [], dom: {}, html: () => document.getElementById("app").innerHTML.replace(/ style=""/g, "") });
    t.view = globalThis.__RX__.attach(m => {
      t.msgs.push(m);
      // what the page showed after each live flush
      if (m.type === "flush") t.dom[m.seq] = t.html();
    });
  });
  page.errors = errors;
  return page;
}
async function waitIdle(page, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const busy = await page.evaluate(() => {
      let s;
      const v = globalThis.__RX__.attach(m => { if (m.type === "snapshot") s = m; });
      v.post({ type: "snapshot?" });
      v.detach();
      return s.flights.length + s.runs.length;
    });
    if (!busy) return;
    await sleep(50);
  }
}
const drain = page => page.evaluate(() => globalThis.__T.msgs.splice(0));
const post = (page, msg) => page.evaluate(m => globalThis.__T.view.post(m), msg);

// Things a reader does, in turn: toggle a book, switch filters, add a book, search.
async function act(page, i) {
  const n = i % 6;
  if (n === 0) await page.locator('li[data-testid="book"] input[type="checkbox"]').nth(1).click();
  else if (n === 1) await page.getByRole("button", { name: "unread", exact: true }).click();
  else if (n === 2) {
    await page.getByPlaceholder("Title", { exact: true }).fill(`Book ${i}`);
    await page.getByPlaceholder("Author", { exact: true }).fill(`Author ${i}`);
    await page.getByRole("button", { name: "Add", exact: true }).click();
  } else if (n === 3) await page.getByRole("button", { name: "all", exact: true }).click();
  else if (n === 4) await page.getByPlaceholder("Search title or author", { exact: true }).fill("le");
  else await page.getByPlaceholder("Search title or author", { exact: true }).fill("");
}

function makeHost(graph, opts = {}) {
  return (async () => {
    const page = await openApp(opts.capacity && opts.capacity !== 2000 ? `?cap=${opts.capacity}` : "");
    const subs = new Set();
    let acts = 0;
    const flushOut = async () => { for (const m of await drain(page)) for (const fn of subs) fn(m); };
    return {
      page,
      subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
      async post(msg) { await post(page, msg); await flushOut(); },
      async act() { await act(page, acts++); await flushOut(); },
      async tick(n = 1) { await sleep(n * TICK); await flushOut(); },
      async editModule() { throw new Error("the real host plans no HMR yet (TRACE-CONTRACT §2 module replacement)"); },
      async dispose() { await page.close(); },
    };
  })();
}

try {
  // ---- conformance -------------------------------------------------------------------------------------------------
  const first = await openApp();
  const graph = await first.evaluate(() => JSON.parse(JSON.stringify(globalThis.__RX__.graphs[0])));
  graph.title = "shelf (real host)";
  await first.close();
  const results = await runConformanceAsync(makeHost, [graph], { seed: 1 });
  console.log("-- conformance against the real host");
  for (const r of results) {
    const hmr = r.check.startsWith("hmr ");
    const line = `${r.ok ? "ok  " : hmr ? "n/a " : "FAIL"} ${r.check}${r.graph ? ` [${r.graph}]` : ""}${r.detail ? `: ${r.detail}` : ""}`;
    console.log(line);
    if (!r.ok && !hmr) failed++;
  }

  // ---- the DOM under travel ----------------------------------------------------------------------------------------
  console.log("-- DOM under travel");
  const page = await openApp();
  if (shots) {
    // the map beside the app, as the devtools' Map view hosts it
    await page.evaluate(() => {
      document.getElementById("app").style.cssText = "position:fixed;left:0;top:0;width:560px;height:100%;overflow:auto";
      const el = document.createElement("div");
      el.style.cssText = "position:fixed;left:560px;top:0;right:0;bottom:0;border-left:1px solid #333";
      document.body.append(el);
      globalThis.__RX__.mount(el);
    });
    await sleep(800);
  }
  // the store guesses first (toggle, add: each a guess, a save and a refresh), then plain writes (filters, search)
  for (const i of [0, 2, 1, 3, 4, 5]) { await act(page, i); await sleep(700); }
  await waitIdle(page);
  await drain(page);
  const { head, dom, steps, guessed } = await page.evaluate(() => {
    let tl;
    const v = globalThis.__RX__.attach(m => { if (m.type === "timeline") tl = m; });
    v.post({ type: "hello", want: ["timeline"] });
    v.detach();
    const guessed = tl.steps.filter(s => s.changes.some(c => c.name?.endsWith(".$guess"))).map(s => s.seq);
    return { head: tl.head, steps: tl.steps.map(s => s.seq), dom: globalThis.__T.dom, guessed };
  });
  const liveDom = await page.evaluate(() => globalThis.__T.html());
  // the first load landed before the view attached; every step after it has the DOM it showed
  const seen = steps.filter(s => dom[s] !== undefined);
  check(`recorded ${steps.length} steps, head ${head}, a DOM snapshot for ${seen.length}`, seen.length > 5 && seen.length >= steps.length - 1, { steps, have: Object.keys(dom) });
  check("the live DOM is the head's", liveDom === dom[head]);

  const shownAt = async n => {
    await post(page, { type: "travel", to: n });
    const reply = (await drain(page)).find(m => m.type === "step" || m.type === "travel-denied");
    return { reply, html: await page.evaluate(() => globalThis.__T.html()) };
  };
  // Known gap (Solid, reported): a store guess is recorded on the store's guess carrier (`books.$guess`), and its
  // confirmed landing changes no shown value, so no record names the property nodes it moved (`books.length`, a row's
  // `read`); pins cannot take the list back past it. Seqs before the last carrier change are checked separately.
  const lastGuess = Math.max(0, ...guessed);
  const exact = seen.filter(n => n >= lastGuess), gap = seen.filter(n => n < lastGuess);
  const order = [...exact].reverse().concat(exact.filter((_, i) => i % 2 === 0), [exact[0], exact.at(-1)]);
  const bad = [];
  for (const n of order) {
    const { reply, html } = await shownAt(n);
    if (reply?.type !== "step") bad.push({ n, reply });
    else if (html !== dom[n]) bad.push({ n, want: dom[n].length, got: html.length, diff: firstDiff(dom[n], html) });
  }
  check(`travel(n) shows the DOM the page showed at n: ${order.length} travels back and forth over seqs ${exact.join(",")}`, exact.length >= 4 && bad.length === 0, { bad: bad.map(b => b.n), first: bad.slice(0, 2) });
  const gapBad = [];
  for (const n of gap) {
    const { reply, html } = await shownAt(n);
    if (reply?.type !== "step" || html !== dom[n]) gapBad.push(n);
  }
  console.log(`info known gap (store guess carrier): seqs ${gap.join(",") || "none"} before the last guess at #${lastGuess}; DOM differs at ${gapBad.join(",") || "none"}`);

  // a seq in the middle, with the map looking at it
  const mid = exact[Math.floor(exact.length / 2)];
  const midShown = await shownAt(mid);
  check(`…and travel(${mid}) again shows it`, midShown.html === dom[mid]);
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await sleep(900);
    await page.screenshot({ path: join(shots, "travel-mid.png") });
    console.log(`wrote ${join(shots, "travel-mid.png")}`);
  }

  // live work beneath the view is hidden, and lands at resume
  const beneath = await page.evaluate(() => globalThis.__T.html());
  await page.getByRole("button", { name: "read", exact: true }).first().click({ force: true });
  await sleep(300);
  const during = await drain(page);
  check("a click while viewing changes nothing shown", (await page.evaluate(() => globalThis.__T.html())) === beneath);
  check("…and sends no flush", !during.some(m => m.type === "flush"), during.map(m => m.type));
  await post(page, { type: "resume" });
  await sleep(100);
  const resumed = await drain(page);
  const r = resumed.find(m => m.type === "resume");
  const after = await page.evaluate(() => ({ html: globalThis.__T.html(), on: document.querySelector(".chips button.on")?.textContent }));
  check("resume lands the click made while viewing", r && after.on === "read", { resume: r && { head: r.head, changes: r.changes.map(c => c.name) }, on: after.on });
  check("…as one new step after the old head", r?.head === head + 1 && resumed.some(m => m.type === "flush" && m.seq === head + 1), resumed.map(m => `${m.type}${m.seq ?? ""}`));
  const filterChange = r?.changes.find(c => c.name === "filter");
  check("…whose resume changes run from the viewed seq to live (filter: prev → preview)", filterChange && filterChange.preview === '"read"', r?.changes);

  // back to a recorded seq, then live, with nothing done beneath: the DOM is live's again
  const liveNow = await page.evaluate(() => globalThis.__T.html());
  await shownAt(exact[1]);
  await post(page, { type: "resume" });
  const r2 = (await drain(page)).find(m => m.type === "resume");
  const back = await page.evaluate(() => globalThis.__T.html());
  check("resume with nothing beneath restores the live DOM", back === liveNow && r2?.head === head + 1, { head: r2?.head, diff: back === liveNow ? null : firstDiff(liveNow, back) });

  if (shots) {
    await drain(page);
    await shownAt(exact[0]);
    await sleep(900);
    await page.screenshot({ path: join(shots, "travel-early.png") });
    // the known gap: a seq before a confirmed store guess (the list does not go back)
    if (gap.length) {
      await shownAt(gap[0]);
      await sleep(900);
      await page.screenshot({ path: join(shots, "gap-store-guess.png") });
    }
    await post(page, { type: "resume" });
    await sleep(900);
    await page.screenshot({ path: join(shots, "resumed.png") });
    console.log(`wrote ${join(shots, "travel-early.png")}, ${join(shots, "gap-store-guess.png")}, ${join(shots, "resumed.png")}`);
  }

  // denied: evicted seqs, and while an action is still running
  await post(page, { type: "travel", to: 0 });
  const d0 = (await drain(page)).find(m => m.type === "travel-denied");
  check("travel to a seq never recorded is denied (evicted)", d0?.reason === "evicted", d0);
  await act(page, 0); // toggle: an action awaiting save()
  await post(page, { type: "travel", to: steps[0] });
  const d1 = (await drain(page)).find(m => m.type === "travel-denied" || m.type === "step");
  check("travel while an action is running is denied (pending)", d1?.type === "travel-denied" && d1.reason === "pending", d1);
  await waitIdle(page);

  check("no page errors", page.errors.length === 0, page.errors.slice(0, 5));
} finally {
  await browser.close();
  vite.kill();
}

function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return { at: i, want: a.slice(Math.max(0, i - 40), i + 80), got: b.slice(Math.max(0, i - 40), i + 80) };
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
