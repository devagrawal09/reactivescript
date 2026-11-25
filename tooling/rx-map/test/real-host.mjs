#!/usr/bin/env node
// The trace contract's conformance suite against the REAL host (`./live` in a running .rx dev app), plus DOM checks
// of time travel. Needs a Solid with `openView` (solidjs/solid#5089), Playwright, and pnpm.
//
//   SOLID_VIEW=<solid checkout or its packages dir, built> node test/real-host.mjs [--shots <dir>]
//   APP=<dir of an installed copy of test/shelf-app> node test/real-host.mjs
//
// With SOLID_VIEW, the app is test/shelf-app (the rx-r1 shelf template with a deterministic fake server: `save` fails
// every 4th call, fixed delays, counted ids; `?cap=N` sets `globalThis.__RX_TIMELINE_CAPACITY__`), copied to a temp
// dir and installed with pnpm, linked to this repository and to SOLID_VIEW's solid-js, @solidjs/signals and
// @solidjs/web. Without SOLID_VIEW or APP it skips. `npm test` runs it. Playwright comes from $NODE_PATH; Chromium from
// $CHROME or Playwright's headless shell.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runConformanceAsync } from "../conformance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
if (!process.env.APP && !process.env.SOLID_VIEW) {
  console.log("skip real-host.mjs: set SOLID_VIEW to a built Solid with openView (or APP to an installed shelf app)");
  process.exit(0);
}
const die = msg => { console.error(`FAIL real-host.mjs: ${msg}`); process.exit(1); };
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { die("no playwright: put its node_modules on NODE_PATH"); }
const args = process.argv.slice(2);
const shots = args.includes("--shots") ? resolve(args[args.indexOf("--shots") + 1]) : null;
const app = process.env.APP ? resolve(process.env.APP) : setUpApp(resolve(process.env.SOLID_VIEW));
const chrome = process.env.CHROME ?? (() => {
  const base = join(homedir(), ".cache/ms-playwright");
  const dir = existsSync(base) && readdirSync(base).filter(d => d.startsWith("chromium_headless_shell")).sort().pop();
  return dir ? join(base, dir, "chrome-headless-shell-linux64/chrome-headless-shell") : undefined;
})();
const TICK = Number(process.env.TICK_MS ?? 80);

// test/shelf-app in a temp dir, linked to this repository and to SOLID_VIEW's packages; reinstalled when the links change.
function setUpApp(solidView) {
  const pkgs = existsSync(join(solidView, "packages/solid")) ? join(solidView, "packages") : solidView;
  for (const p of ["solid/dist", "signals/dist", "web/dist"]) if (!existsSync(join(pkgs, p))) die(`${join(pkgs, p)} missing: build Solid first`);
  if (!readFileSync(join(pkgs, "signals/dist/dev.attribution.js"), "utf8").includes("openView")) die(`${pkgs}: this Solid has no openView`);
  if (!readdirSync(join(repo, "compiler")).some(f => f.endsWith(".node"))) die("build the compiler first (cd compiler && npm run build)");
  if (!existsSync(join(repo, "runtime/dist/web.js"))) die("build the runtime first (cd runtime && node build.mjs)");
  const link = p => `link:${p}`;
  const pkg = {
    name: "rx-real-host-shelf", private: true, type: "module",
    dependencies: {
      "@reactivescript/runtime": link(join(repo, "runtime")),
      "solid-js": link(join(pkgs, "solid")), "@solidjs/signals": link(join(pkgs, "signals")), "@solidjs/web": link(join(pkgs, "web")),
    },
    devDependencies: {
      "@reactivescript/compiler": link(join(repo, "compiler")), "@reactivescript/map": link(join(repo, "tooling/rx-map")),
      "@solidjs/diagnostics": "^2.0.0", "@solidjs/vite-plugin": "^3.0.1", vite: "^8.3.8",
    },
  };
  const workspace = `minimumReleaseAgeExclude:\n  - solid-js\n  - '@solidjs/*'\n  - '@reactivescript/*'\noverrides:\n`
    + ["solid-js", "@solidjs/signals", "@solidjs/web"].map(n => `  '${n}': ${pkg.dependencies[n]}\n`).join("");
  const dir = join(tmpdir(), `rx-real-host-${createHash("sha1").update(repo + pkgs).digest("hex").slice(0, 10)}`);
  mkdirSync(dir, { recursive: true });
  cpSync(join(here, "shelf-app"), dir, { recursive: true, force: true });
  const manifest = JSON.stringify(pkg, null, 2) + "\n";
  const fresh = !existsSync(join(dir, "node_modules/.bin/vite")) || !existsSync(join(dir, "package.json"))
    || readFileSync(join(dir, "package.json"), "utf8") !== manifest;
  writeFileSync(join(dir, "package.json"), manifest);
  writeFileSync(join(dir, "pnpm-workspace.yaml"), workspace);
  if (fresh) {
    console.log(`installing the shelf app in ${dir}`);
    const r = spawnSync("pnpm", ["install", "--prefer-offline"], { cwd: dir, stdio: ["ignore", "inherit", "inherit"] });
    if (r.status !== 0) die(`pnpm install failed in ${dir}`);
  }
  return dir;
}

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

  // read-only while viewing (§4b): input on the app does nothing at all, and a badge says why
  const beneath = await page.evaluate(() => globalThis.__T.html());
  const badgeText = () => page.evaluate(() => document.querySelector("[data-rx-viewing-badge]")?.shadowRoot.textContent ?? null);
  check(`a badge says the app is viewing #${mid}`, (await badgeText())?.includes(`viewing #${mid}`), await badgeText());
  await page.getByRole("button", { name: "read", exact: true }).first().click();
  await page.getByPlaceholder("Search title or author", { exact: true }).click();
  await page.keyboard.type("piranesi");
  await page.getByPlaceholder("Title", { exact: true }).fill("not while viewing").catch(() => {});
  await sleep(300);
  const during = await drain(page);
  const typed = await page.evaluate(() => [...document.querySelectorAll("input")].map(i => i.value).join("|"));
  check("clicks and typing while viewing change nothing shown", (await page.evaluate(() => globalThis.__T.html())) === beneath && !/piranesi|not while/.test(typed), typed);
  check("…and run nothing: no flush, no action", !during.some(m => m.type === "flush" || m.type === "run"), during.map(m => m.type));
  await post(page, { type: "resume" });
  await sleep(100);
  const resumed = await drain(page);
  const r = resumed.find(m => m.type === "resume");
  check("resume with nothing written beneath lands no step and gives back the exact live DOM",
    r?.head === head && !resumed.some(m => m.type === "flush") && (await page.evaluate(() => globalThis.__T.html())) === liveDom,
    { head: r?.head, msgs: resumed.map(m => m.type) });
  check("…and the badge is gone", (await badgeText()) === null);
  check("…and input works again", await (async () => {
    await page.getByRole("button", { name: "read", exact: true }).first().click();
    await sleep(100);
    const on = await page.evaluate(() => document.querySelector(".chips button.on")?.textContent);
    await page.getByRole("button", { name: "all", exact: true }).click();
    await sleep(100);
    await waitIdle(page);
    return on === "read";
  })());
  const liveNow = await page.evaluate(() => globalThis.__T.html());
  await drain(page);

  // the badge's Resume button resumes
  await shownAt(exact[1]);
  await page.locator("[data-rx-viewing-badge] button").click();
  await sleep(100);
  const r2 = (await drain(page)).find(m => m.type === "resume");
  check("the badge's Resume button resumes to the live DOM", r2 && (await page.evaluate(() => globalThis.__T.html())) === liveNow, r2);

  // step.inexact: a seq before a store guess lists the store and what reads it
  if (gap.length) {
    const { reply } = await shownAt(gap[0]);
    const want = ["src/App.rx|App|books", "src/App.rx|App|shown", "src/App.rx|App|total"];
    check(`travel(${gap[0]}), before a store guess, marks books and its readers inexact`, want.every(k => reply?.inexact?.includes(k)), reply?.inexact);
    const { reply: late } = await shownAt(head);
    check(`travel(${head}), after the last guess, marks nothing inexact`, late?.type === "step" && late.inexact === undefined, late?.inexact);
    await post(page, { type: "resume" });
    await drain(page);
  }

  // first-change prev: a name whose first value never came in a flush has it as the first change's prev
  const firstFilter = (await page.evaluate(() => {
    let tl;
    const v = globalThis.__RX__.attach(m => { if (m.type === "timeline") tl = m; });
    v.post({ type: "hello", want: ["timeline"] });
    v.detach();
    return tl.steps.flatMap(s => s.changes).find(c => c.key === "src/App.rx|App|filter");
  }));
  check("the first change of filter carries its value before (\"all\")", firstFilter?.prev === '"all"', firstFilter);

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
