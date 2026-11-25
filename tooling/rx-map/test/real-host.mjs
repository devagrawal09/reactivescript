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
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
if (!process.env.APP && !process.env.SOLID_VIEW) {
  // In CI the real host is the arbiter (TRACE-CONTRACT §5): a missing Solid build is a failure, not a skip.
  if (process.env.CI) {
    console.error("FAIL real-host.mjs: CI is set but SOLID_VIEW is not (build the Solid pinned in solid-view.json)");
    process.exit(1);
  }
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
const UNDO_KEYS = ["src/App.rx|App|undo"];
// The host's probe (at the first travel): does this Solid's view read a list's rows through its pinned container?
const listsThroughPin = page => page.evaluate(() => globalThis.__RX__.travel?.listsThroughPin === true);

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
const vite = spawn(join(app, "node_modules/.bin/vite"), ["--port", String(port), "--strictPort", "--force"], { cwd: app, stdio: ["ignore", "pipe", "pipe"] });
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
  // Solid's timing diagnostics (HOT_SCOPE_TIME…) depend on machine load, not on correctness: not page errors here.
  const timing = /^\[(HOT_SCOPE_TIME|SLOW_[A-Z_]+)\]/;
  page.on("console", m => { if ((m.type() === "error" || m.type() === "warning") && !timing.test(m.text())) errors.push(m.text()); });
  await page.goto(`${origin}/${query}`, { waitUntil: "domcontentloaded" });
  try { await page.waitForFunction(() => globalThis.__RX__?.attach && document.querySelector(".counts"), null, { timeout: 15000 }); }
  catch (e) { throw new Error(`${e.message}\n${await page.evaluate(() => JSON.stringify({ rx: !!globalThis.__RX__, text: document.body.innerText.slice(0, 1000) }))}\n${errors.join("\n")}\n${viteLog}`); }
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
      async editModule(module) {
        const file = join(app, module);
        const text = readFileSync(file, "utf8");
        try { await saveRx(page, file, text + "\n// real host conformance\n"); await flushOut(); }
        finally { await saveRx(page, file, text); }
      },
      async dispose() { await page.close(); },
      // what the app displays now (TRACE-CONTRACT §5: the arbiter)
      shown: keys => page.evaluate(k => globalThis.__T.view.shown(k), keys),
    };
  })();
}

async function saveRx(page, file, text) {
  const start = await page.evaluate(() => globalThis.__T.msgs.length);
  writeFileSync(file, text);
  try {
    await page.waitForFunction(start => globalThis.__T?.msgs.slice(start).some(m => m.type === "hmr" && ["done", "failed"].includes(m.phase)), start, { timeout: 8000 });
  } catch (e) {
    throw new Error(`${e.message}\n${await page.evaluate(() => JSON.stringify(globalThis.__T?.msgs.filter(m => m.type === "hmr").map(({ graph, plan, ...m }) => m)))}\n${viteLog}\n${page.errors.join("\n")}`);
  }
  const records = await page.evaluate(start => globalThis.__T.msgs.slice(start), start);
  const last = records.find(m => m.type === "hmr" && ["done", "failed"].includes(m.phase));
  const phases = records.filter(m => m.type === "hmr" && m.id === last.id);
  assert.deepEqual(phases.map(m => m.phase), ["plan", "apply", "done"], JSON.stringify(phases.map(({ graph, plan, ...m }) => m)));
  assert.ok(phases.every(m => m.id === phases[0].id));
  return { plan: phases[0].plan, done: phases[2], flush: records.find(m => m.type === "flush" && m.origin === `hmr ${phases[0].id}`) };
}

try {
  if (args.includes("--hmr-only")) {
    await realHmr();
  } else {
  // ---- conformance -------------------------------------------------------------------------------------------------
  const first = await openApp();
  const graph = await first.evaluate(() => JSON.parse(JSON.stringify(globalThis.__RX__.graphs[0])));
  graph.title = "shelf (real host)";
  await first.close();
  const results = await runConformanceAsync(makeHost, [graph], { seed: 1 });
  console.log("-- conformance against the real host");
  for (const r of results) {
    const line = `${r.ok ? "ok  " : "FAIL"} ${r.check}${r.graph ? ` [${r.graph}]` : ""}${r.detail ? `: ${r.detail}` : ""}`;
    console.log(line);
    if (!r.ok) failed++;
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
  const { head, dom, steps, guessed, named } = await page.evaluate(() => {
    let tl;
    const v = globalThis.__RX__.attach(m => { if (m.type === "timeline") tl = m; });
    v.post({ type: "hello", want: ["timeline"] });
    v.detach();
    const carrier = c => c.name?.endsWith(".$guess");
    const guessed = tl.steps.filter(s => s.changes.some(carrier)).map(s => s.seq);
    // Solid with the store-guess record (f9ee22ade) names the property nodes a guess moved beside its carrier
    const named = tl.steps.some(s => s.changes.some(g => carrier(g) && s.changes.some(c => c.key === g.key && c.path !== undefined && !carrier(c))));
    return { head: tl.head, steps: tl.steps.map(s => s.seq), dom: globalThis.__T.dom, guessed, named };
  });
  const liveDom = await page.evaluate(() => globalThis.__T.html());
  // the first load landed before the view attached; every step after it has the DOM it showed
  const seen = steps.filter(s => dom[s] !== undefined);
  // (the loads before the view attached have none)
  check(`recorded ${steps.length} steps, head ${head}, a DOM snapshot for ${seen.length}`, seen.length > 5 && seen.every((n, i) => i === 0 || n === seen[i - 1] + 1) && seen.at(-1) === head, { steps, have: Object.keys(dom) });
  check("the live DOM is the head's", liveDom === dom[head]);

  const shownAt = async n => {
    await post(page, { type: "travel", to: n });
    const reply = (await drain(page)).find(m => m.type === "step" || m.type === "travel-denied");
    return { reply, html: await page.evaluate(() => globalThis.__T.html()) };
  };
  // A Solid whose records name only a store guess's carrier (`books.$guess`), not the property nodes it moved
  // (`books.length`, a row's `read`), can't be taken back past a confirmed guess: there, seqs before the last carrier
  // change are only reported. With the store-guess record every seq must show exactly.
  const lastGuess = named ? 0 : Math.max(0, ...guessed);
  const exact = seen.filter(n => n >= lastGuess), gap = seen.filter(n => n < lastGuess);
  check(`this Solid's records name the properties a store guess moved: ${named ? "yes, every seq is checked" : "no, an older build: seqs before a guess are reported only"}`, true);
  const order = [...exact].reverse().concat(exact.filter((_, i) => i % 2 === 0), [exact[0], exact.at(-1)]);
  const bad = [], undoOff = new Set();
  for (const n of order) {
    const { reply, html } = await shownAt(n);
    if (reply?.type !== "step") bad.push({ n, reply });
    else if (unlessInexact(html, reply) !== unlessInexact(dom[n], reply)) bad.push({ n, want: dom[n].length, got: html.length, diff: firstDiff(dom[n], html) });
    else if (html !== dom[n]) undoOff.add(n);
  }
  check(`travel(n) shows the DOM the page showed at n: ${order.length} travels back and forth over seqs ${exact.join(",")}${named ? ` (store guesses at ${guessed.join(",")})` : ""}`,
    exact.length >= (named ? 8 : 4) && bad.length === 0 && (!named || guessed.length >= 2), { bad: bad.map(b => b.n), first: bad.slice(0, 2), guessed });
  if (named) {
    const other = [];
    const through = await listsThroughPin(page);
    for (const n of seen) {
      const { reply } = await shownAt(n);
      if (reply?.inexact && (through || !reply.inexact.includes(UNDO_KEYS[0]))) other.push({ n, inexact: reply.inexact });
    }
    if (through) {
      check("…and, this Solid's view reading a list's rows through its pinned container, nothing is marked inexact", other.length === 0, other);
      check(`…and the undo list (rewritten wholesale) shows exactly at every seq (differs at ${[...undoOff].join(",") || "none"})`, undoOff.size === 0, [...undoOff]);
    } else {
      check("…and nothing but the undo list (rewritten wholesale, an older Solid's list-items gap) and its readers is marked inexact", other.length === 0, other);
      console.log(`info the undo list, marked inexact on this older Solid, differs at ${[...undoOff].join(",") || "none"}`);
    }
  } else {
    const gapBad = [];
    for (const n of gap) {
      const { reply, html } = await shownAt(n);
      if (reply?.type !== "step" || html !== dom[n]) gapBad.push(n);
    }
    console.log(`info known gap (store guess carrier, older Solid): seqs ${gap.join(",") || "none"} before the last guess at #${lastGuess}; DOM differs at ${gapBad.join(",") || "none"}`);
  }

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
  check("filter's first state in the timeline is \"all\" (its initial value or a first change's prev)", firstFilter?.prev === '"all"' || firstFilter?.preview === '"all"', firstFilter);

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

  // denied: evicted seqs
  await post(page, { type: "travel", to: 0 });
  const d0 = (await drain(page)).find(m => m.type === "travel-denied");
  check("travel to a seq never recorded is denied (evicted)", d0?.reason === "evicted", d0);
  check("no page errors", page.errors.length === 0, page.errors.slice(0, 5));
  await page.close();

  await roundThree();
  await realHmr();
  }
} finally {
  await browser.close();
  vite.kill();
}

async function realHmr() {
  console.log("-- keyed HMR from disk");
  const filename = join(app, "src/App.rx");
  const original = readFileSync(filename, "utf8");
  const dep = join(app, "src/components/ShelfInfo.rx");
  const originalDep = readFileSync(dep, "utf8");
  const previewFile = join(app, "src/components/DraftPreview.rx");
  const originalPreview = readFileSync(previewFile, "utf8");
  const rows = join(app, "src/components/Book.rx");
  const originalRows = readFileSync(rows, "utf8");
  let text = original.replace('  source filter:', `  source counter: number := 0
  source answer: string = str(await loadAnswer("first"))
  doubled = counter * 2
  source filter:`).replace("import pure { load }", "import pure { load, loadAnswer }")
    .replace("    <h1>Shelf</h1>", `    <h1>Shelf</h1>
    <button type="button" data-testid="hmr-counter" onClick={() => { counter := c => c + 1 }}>{counter}</button>
    <p data-testid="hmr-double">{doubled}</p>
    {errored fallback(e) { <p>{e.message}</p> } {
      {loading fallback { <p data-testid="hmr-loading">Asking…</p> } {
        <p data-testid="hmr-answer">{answer}</p>
      }}
    }}
    {if true {
      source repeated := 10
      <p>{repeated}</p>
    }}
    {if true {
      source repeated := 20
      <button type="button" data-testid="hmr-reindexed" onClick={() => { repeated := c => c + 1 }}>{repeated}</button>
    }}`);
  const key = name => `src/App.rx|App|${name}`;
  let page;
  try {
    writeFileSync(filename, text);
    writeFileSync(rows, originalRows.replace("  <style>", "  source local := 0\n  <style>")
      .replace('    <span class="title">', '    <button type="button" data-testid="hmr-row" onClick={() => { local := c => c + 1 }}>{local}</button>\n    <span class="title">'));
    page = await openApp();
    const shown = async (id, want) => {
      await page.waitForFunction(([id, want]) => document.querySelector(`[data-testid="hmr-${id}"]`)?.textContent === want, [id, want]);
    };
    const values = () => page.evaluate(() => {
      let s;
      const v = globalThis.__RX__.attach(m => { if (m.type === "snapshot") s = m; });
      v.post({ type: "snapshot?" });
      v.detach();
      return Object.fromEntries(s.values.map(v => [v.key, v.preview]));
    });
    const btn = page.getByTestId("hmr-counter");
    for (let i = 0; i < 3; i++) await btn.click();
    const row = page.getByTestId("hmr-row").first();
    await row.click();
    assert.equal(await row.textContent(), "1");
    const state = async (name, value, rendered = value) => {
      if (rendered !== null) await shown("counter", rendered);
      assert.equal((await values())[key(name)], value);
    };
    const edit = async (label, update, reasons, verify) => {
      text = update(text);
      const result = await saveRx(page, filename, text);
      for (const [name, why] of Object.entries(reasons)) assert.equal(result.plan.reasons[key(name)], why, name);
      assert.ok(result.flush, "missing HMR timeline flush");
      await verify(result);
      console.log(`ok   HMR ${label}`);
      return result;
    };
    await state("counter", "3");
    await edit("unchanged: unrelated DOM edit keeps counter at 3", s => s.replace("<h1>Shelf</h1>", "<h1>New shelf</h1>"),
      { counter: "unchanged" }, async ({ done }) => {
        await page.getByRole("heading", { name: "New shelf" }).waitFor();
        await state("counter", "3");
        assert.equal(await row.textContent(), "0");
        assert.equal(done.fallback, "refresh");
        assert.ok(done.uncarried.includes("src/components/Book.rx|BookRow|local"));
      });
    await edit("init-changed: counter keeps 3 rather than taking 7", s => s.replace("counter: number := 0", "counter: number := 7"),
      { counter: "init-changed" }, async () => state("counter", "3"));
    const beforeExpr = await page.evaluate(() => {
      let n; const v = globalThis.__RX__.attach(m => { if (m.type === "timeline") n = m.head; });
      v.post({ type: "hello" }); v.detach(); return n;
    });
    const changed = await edit("expr-changed: equation goes from 6 to 9", s => s.replace("counter * 2", "counter * 3"),
      { doubled: "expr-changed" }, async ({ done, flush }) => {
        await state("counter", "3"); await shown("double", "9");
        assert.equal((await values())[key("doubled")], "9");
        assert.ok(done.changes.some(c => c.key === key("doubled") && c.prev === "6" && c.preview === "9"));
        assert.ok(flush.changes.some(c => c.key === key("doubled") && c.preview === "9"));
      });
    await waitIdle(page);
    await post(page, { type: "travel", to: beforeExpr });
    const historical = (await drain(page)).findLast(m => m.type === "step");
    assert.ok(historical?.inexact?.includes(key("doubled")), "new code cannot reproduce an old synchronous expression");
    assert.equal(historical.changes.find(c => c.key === key("doubled"))?.preview, "6");
    await post(page, { type: "travel", to: changed.flush.seq });
    await shown("double", "9");
    await post(page, { type: "resume" });
    await shown("double", "9");
    await btn.click();
    await state("counter", "4");
    await post(page, { type: "travel", to: changed.flush.seq });
    await state("counter", "3");
    await shown("double", "9");
    await post(page, { type: "resume" });
    await state("counter", "4");
    console.log(`ok   HMR travel across #${changed.flush.seq} reports the old expression; travel to the HMR step shows counter 3 instead of 4`);
    await edit("standing question with a hoisted await re-asks and keeps its previous answer", s => s.replace('loadAnswer("first")', 'loadAnswer("second")'),
      { answer: "expr-changed" }, async ({ done }) => {
        assert.ok(!done.uncarried?.includes(key("answer")));
        await shown("answer", "first"); await shown("answer", "second");
        assert.equal((await values())[key("answer")], '"second"');
        const records = await page.evaluate(() => globalThis.__T.msgs);
        assert.ok(records.some(m => m.type === "flight" && m.key === key("answer") && m.state === "start"));
        assert.ok(records.some(m => m.type === "flush" && m.origin === `hmr ${done.id}` && m.changes.some(c => c.key === key("answer") && c.preview === '"second"')),
          JSON.stringify(records.filter(m => m.type === "flush").slice(-8).map(m => [m.origin, m.changes.filter(c => c.key === key("answer"))])));
      });
    await edit("renamed: moved source keeps 4", s => s.replace(/\bcounter\b/g, (word, i) => s.slice(i - 4, i) === "hmr-" ? word : "tally"),
      { counter: "renamed", tally: "unchanged" }, async ({ plan }) => {
        assert.deepEqual(plan.moved.find(m => m.from === key("counter")), { from: key("counter"), to: key("tally") });
        await state("tally", "4");
        assert.equal((await values())[key("counter")], undefined);
      });
    await edit("type-changed: source resets",
      s => s.replace("tally: number := 7", "tally: string := \"reset\"").replace("tally * 3", "tally + \"\"").replace("tally := c => c + 1", "tally := c => c + \"!\""),
      { tally: "type-changed", doubled: "expr-changed" }, async () => { await state("tally", '"reset"', "reset"); await shown("double", "reset"); });
    await edit("kind-changed: source becomes equation", s => s.replace('source tally: string := "reset"', 'tally: string = "equation"').replace(' onClick={() => { tally := c => c + "!" }}', ""),
      { tally: "kind-changed", doubled: "upstream-changed" }, async () => { await state("tally", '"equation"', "equation"); await shown("double", "equation"); });
    await edit("new/gone: add and remove keys", s => s.replace('tally: string = "equation"', 'source fresh: string := "new"').replace("doubled = tally", "doubled = fresh").replace("{tally}", "{fresh}"),
      { tally: "gone", fresh: "new" }, async () => { await state("fresh", '"new"', "new"); assert.equal((await values())[key("tally")], undefined); });
    const depEdit = await saveRx(page, dep, originalDep.replace('${info.name} (', '${info.name} has ('));
    await page.getByText("Shelf main has (4)").waitFor();
    await state("fresh", '"new"', "new");
    assert.equal(depEdit.plan.reasons["src/components/ShelfInfo.rx|ShelfInfo|label"], "expr-changed");
    console.log("ok   HMR dependency edit: replacement code reaches the mounted importer");
    text = 'import { DraftDialog } from "./components/DraftDialog.rx"\n' + text
      .replace("  source filter:", "  source showDraft := false\n  source filter:")
      .replace('<h1>New shelf</h1>', `<h1>New shelf</h1>
    <button type="button" onClick={() => { showDraft := true }}>Open draft</button>
    {if showDraft {
      {loading fallback { <p>Preparing draft…</p> } {
        ready = await loadAnswer("ready") catch (e) => ""
        {if ready == "ready" { <DraftDialog /> }}
      }}
    }}`);
    await saveRx(page, filename, text);
    await page.getByRole("button", { name: "Open draft" }).click();
    const draft = page.getByRole("textbox", { name: "Draft text" });
    const typed = 'food,"Coffee, beans",12,USD';
    await draft.fill(typed);
    const edited = await saveRx(page, previewFile, originalPreview.replace("Preview:", "Updated:"));
    const draftKey = "src/components/DraftDialog.rx|DraftDialog|text";
    assert.equal(edited.plan.reasons[draftKey], "unchanged");
    await page.getByTestId("draft-preview").getByText(`Updated: ${typed}`, { exact: true }).waitFor({ timeout: 5000 });
    assert.equal(await draft.inputValue(), typed);
    assert.equal((await values())[draftKey], JSON.stringify(typed));
    console.log("ok   HMR child edit preserves parent draft after async remount");
    await edit("scope-changed: move to module scope resets", s => s.replace('  source fresh: string := "new"\n', "")
      .replace("export default component App()", 'source fresh: string := "new"\n\nexport default component App()'),
      { fresh: "scope-changed" }, async ({ plan }) => {
        assert.ok(plan.reset.includes("src/App.rx||fresh"));
        await shown("counter", "new");
        assert.equal((await values())["src/App.rx||fresh"], '"new"');
      });
    await page.getByTestId("hmr-reindexed").click();
    await shown("reindexed", "21");
    await edit("reindexed: #1 shifts to base key and keeps 21", s => s.replace(/    \{if true \{\n      source repeated := 10\n      <p>\{repeated\}<\/p>\n    \}\}\n/, ""),
      { "repeated#1": "reindexed" }, async ({ plan }) => {
        assert.deepEqual(plan.moved.find(m => m.from === key("repeated#1")), { from: key("repeated#1"), to: key("repeated") });
        await shown("reindexed", "21");
        assert.equal((await values())[key("repeated")], "21");
      });
    assert.deepEqual(page.errors, []);
  } finally {
    await page?.close();
    writeFileSync(filename, original);
    writeFileSync(dep, originalDep);
    writeFileSync(previewFile, originalPreview);
    writeFileSync(rows, originalRows);
  }
}

// Round-3 tester feedback (usability/round3-browser.md, tool point 3): (a) an undo list (an array of objects, prepended
// and filtered) must come back intact; (b) a component-scoped name shows the instance alive at the viewed seq, never a
// disposed one's value or error; (c) travel asked for while a hold is in the air waits for it instead of failing.
async function roundThree() {
  console.log("-- round 3: undo list, remounted instances, travel while pending");
  const page = await openApp();
  const html = () => page.evaluate(() => globalThis.__T.html());
  const timeline = () => page.evaluate(() => {
    let tl;
    const v = globalThis.__RX__.attach(m => { if (m.type === "timeline") tl = m; });
    v.post({ type: "hello", want: ["timeline"] });
    v.detach();
    return tl;
  });
  const settle = async () => { await sleep(150); await waitIdle(page); await sleep(100); };
  // a travel may wait for a hold to land (travel-pending): take the step when it comes
  const travelTo = async n => {
    await post(page, { type: "travel", to: n });
    for (let i = 0; i < 80; i++) {
      const reply = (await drain(page)).find(m => m.type === "step" || m.type === "travel-denied");
      if (reply) return reply;
      await sleep(50);
    }
  };
  // a toggle is done when its undo entry shows (save, then refresh: ~500 ms), not merely when nothing is in flight
  const undoCount = () => page.evaluate(() => document.querySelectorAll(".undo-entry").length);
  const toggle = async i => {
    const before = await undoCount();
    await page.locator('li[data-testid="book"] input[type="checkbox"]').nth(i).click();
    for (let t = 0; t < 60 && (await undoCount()) === before; t++) await sleep(50);
    await settle();
  };
  // (a) three successful toggles prepend three undo entries; undoing the middle one filters it out
  await toggle(1);
  await toggle(2);
  await toggle(3);
  await page.waitForFunction(() => document.querySelectorAll(".undo-entry").length === 3);
  const entries = () => page.evaluate(() => [...document.querySelectorAll(".undo-entry")].map(b => b.textContent));
  // The action can finish before Solid releases the held undo list.
  await page.waitForFunction(() => document.querySelectorAll(".undo-entry").length === 3);
  const before = await entries();
  await page.locator(".undo-entry").nth(1).click();
  await settle();
  await page.waitForFunction(() => document.querySelectorAll(".undo-entry").length === 2);
  check(`the undo list: ${JSON.stringify(before)}, then ${JSON.stringify(await entries())}`, before.length === 3 && (await entries()).length === 2);
  // (b) switch the shelf panel to a shelf that fails, then back: a new ShelfInfo instance each time
  await page.getByRole("button", { name: "shelf nope", exact: true }).click();
  await settle();
  const nopeShown = await page.evaluate(() => !!document.querySelector('[data-testid="shelf-error"]'));
  await page.getByRole("button", { name: "shelf other", exact: true }).click();
  await settle();
  await page.getByRole("button", { name: "unread", exact: true }).click();
  await settle();
  check("the shelf panel failed for nope, and is healthy again for other", nopeShown && (await page.evaluate(() => document.querySelector('[data-testid="shelf"]')?.textContent)) === "Shelf other (5)");

  const tl = await timeline();
  const dom = await page.evaluate(() => globalThis.__T.dom);
  const seen = tl.steps.map(s => s.seq).filter(n => dom[n] !== undefined);
  const live = await html();
  // The shelf panel is a component remounted per shelf id. A view that pins `shelfId` back remounts the panel, and the
  // new instance asks again (Solid's openView limit: state born in a branch the view remounts starts over), so its
  // DOM is reported, not asserted; the rest of the page must be exact.
  const panel = h => h.replace(/<section class="shelf-info[^"]*">[\s\S]*?<\/section>/, "<section>…</section>");
  const bad = [], panelOff = [], undoOff = [], inexactAt = new Map();
  for (const n of [...seen].reverse()) {
    const reply = await travelTo(n);
    const got = await html();
    const keep = h => unlessInexact(panel(h), reply);
    if (reply?.type !== "step" || keep(got) !== keep(dom[n])) bad.push({ n, reply: reply?.type, diff: reply?.type === "step" ? firstDiff(keep(dom[n]), keep(got)) : reply });
    else if (panel(got) !== panel(dom[n])) undoOff.push(n);
    else if (got !== dom[n]) panelOff.push(n);
    if (reply?.type === "step") inexactAt.set(n, reply.inexact ?? []);
  }
  check(`(a) travel shows the recorded DOM at every seq: ${seen.length} seqs back from #${tl.head}`, bad.length === 0, { bad: bad.map(b => b.n), first: bad.slice(0, 2) });
  // On new Solid the real DOM must be exact even just before the async guess.
  // Older builds still tell us which step's undo list they cannot reproduce.
  const unflagged = undoOff.filter(n => !inexactAt.get(n).includes(UNDO_KEYS[0]));
  if (await page.evaluate(() => globalThis.__RX__.travel?.guessedListsThroughPin === true)) {
    check("(a) the undo list rewinds across its async guess, without any inexact marks",
      undoOff.length === 0 && [...inexactAt.values()].every(keys => !keys.includes(UNDO_KEYS[0])),
      { undoOff, marked: [...inexactAt].filter(([, keys]) => keys.includes(UNDO_KEYS[0])).map(([n]) => n) });
  } else if (await listsThroughPin(page)) {
    // Solid with 980f5b4c5 rewinds a list rewritten wholesale; this one was also guessed over by undoOp (a guess held
    // across an await), which that fix doesn't cover: only seqs before the guess may be marked, and those that
    // differ must be
    const guessAt = Math.max(0, ...tl.steps.filter(st => st.changes.some(c => c.key === UNDO_KEYS[0] && c.name?.endsWith(".$guess"))).map(st => st.seq));
    const markedLate = [...inexactAt].filter(([n, ks]) => ks.length && n >= guessAt).map(([n]) => n);
    check(`(a) the undo list is marked inexact only before its guess at #${guessAt}, and wherever it differs (at ${undoOff.join(",") || "none"})`,
      guessAt > 0 && markedLate.length === 0 && unflagged.length === 0, { markedLate, unflagged });
  } else {
    check(`(a) every seq whose undo list can't be shown is marked inexact (older Solid; differs at ${undoOff.join(",") || "none"})`, unflagged.length === 0, unflagged);
  }
  check("(a) …and the newest seq is exact, not marked", (inexactAt.get(seen.at(-1)) ?? []).length === 0, inexactAt.get(seen.at(-1)));
  console.log(`info the remounted shelf panel (openView: a remounted branch starts over) differs at ${panelOff.join(",") || "none"}`);

  // (b) the map's values: replay the timeline and the steps as a view does, and compare with the app at each seq
  const infoKey = "src/components/ShelfInfo.rx|ShelfInfo|info";
  const nopeSeq = seen.filter(n => dom[n].includes('data-testid="shelf-error"')).at(-1);
  const otherSeq = seen.filter(n => dom[n].includes("Shelf other (5)")).at(-1);
  const replies = [];
  const stateAt = async n => {
    const r = await travelTo(n);
    replies.push(r && { type: r.type, from: r.from, to: r.to, reason: r.reason, info: r.changes?.filter(c => /ShelfInfo|shelfId/.test(c.key)) });
    return r?.changes?.find(c => c.key === infoKey);
  };
  await post(page, { type: "resume" });
  await settle();
  await drain(page);
  await stateAt(nopeSeq);
  const back = await stateAt(otherSeq);
  check(`(b) at #${otherSeq} (shelf other, after the failed nope instance was disposed) info shows the live instance's value`,
    back && back.error === undefined && back.preview?.includes("Shelf other"), replies);
  const toNope = await stateAt(nopeSeq);
  check(`(b) at #${nopeSeq} (the nope instance) info shows its error`, toNope?.error?.includes("NotFound"), toNope);
  await post(page, { type: "resume" });
  await settle();
  await drain(page);
  check("…and resume gives back the live DOM", (await html()) === live, firstDiff(live, await html()));

  // (c) travel asked for while an action runs waits for it and then goes
  await page.getByRole("button", { name: "all", exact: true }).click();
  await settle();
  await drain(page);
  await page.locator('li[data-testid="book"] input[type="checkbox"]').nth(0).click();
  const target = seen[2];
  await post(page, { type: "travel", to: target });
  await post(page, { type: "travel", to: seen[1] }); // a drag: the latest target wins
  const early = await drain(page);
  check("(c) travel while an action runs is not denied", !early.some(m => m.type === "travel-denied"), early.map(m => `${m.type}${m.reason ? ` ${m.reason}` : ""}`));
  await settle();
  await sleep(300);
  const later = (await drain(page)).filter(m => m.type === "step");
  check(`(c) …and once it has landed, the app shows the last target, #${seen[1]}`, later.length === 1 && later[0].to === seen[1]
    && unlessInexact(panel(await html()), later[0]) === unlessInexact(panel(dom[seen[1]]), later[0]), later.map(m => m.to));
  await post(page, { type: "resume" });
  await settle();
  // finding 9: a travel waits for a question in the air at most 3 s, then is denied with what it waits on
  await page.getByRole("button", { name: "shelf slow", exact: true }).click();
  await sleep(200);
  await drain(page);
  const t0 = Date.now();
  await post(page, { type: "travel", to: seen[1] });
  let denied;
  for (let i = 0; i < 100 && !denied; i++) {
    denied = (await drain(page)).find(m => m.type === "travel-denied" || m.type === "step");
    if (!denied) await sleep(50);
  }
  const waited = Date.now() - t0;
  check(`(finding 9) a travel waiting on a slow question is denied "pending" after ~3 s (${waited} ms), naming it`,
    denied?.type === "travel-denied" && denied.reason === "pending" && waited >= 2800 && waited < 4500
      && denied.keys?.includes("src/components/ShelfInfo.rx|ShelfInfo|info"), { denied, waited });
  await sleep(5200);
  await settle();

  // finding 12: the timeline holds no disposed engine nodes (the shelf panels remounted above)
  const kept = await page.evaluate(() => globalThis.__RX__.retained());
  check(`(finding 12) the timeline keeps no disposed component's nodes (${kept.nodes} nodes held)`, kept.nodes > 0 && kept.disposed === 0, kept);
  check("round 3: no page errors", page.errors.length === 0, page.errors.slice(0, 5));
  await page.close();
}
// The undo list is rewritten wholesale (`undo := u => [x, ...u]`): Solid records only its length, and under a view a
// list's items come from the store's backing, so the host marks it `inexact` before such a rewrite. Where it says so,
// the list is left out of the DOM comparison (and reported); everything else must match.
function unlessInexact(html, step) {
  return step?.inexact?.includes(UNDO_KEYS[0]) ? html.replace(/<div class="undo[^"]*">[\s\S]*?<\/div>/, '<div class="undo">…</div>') : html;
}

function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return { at: i, want: a.slice(Math.max(0, i - 40), i + 80), got: b.slice(Math.max(0, i - 40), i + 80) };
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
