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
const UNDO_KEYS = ["src/App.rx|App|undo"];
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
    for (const n of seen) { const { reply } = await shownAt(n); if (reply?.inexact && !reply.inexact.includes(UNDO_KEYS[0])) other.push({ n, inexact: reply.inexact }); }
    check("…and nothing but the undo list (rewritten wholesale, Solid's list-items gap) and its readers is marked inexact", other.length === 0, other);
    console.log(`info the undo list, marked inexact, differs at ${[...undoOff].join(",") || "none"}`);
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
} finally {
  await browser.close();
  vite.kill();
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
  const toggle = async i => { await page.locator('li[data-testid="book"] input[type="checkbox"]').nth(i).click(); await settle(); };
  // (a) three successful toggles prepend three undo entries; undoing the middle one filters it out
  await toggle(1);
  await toggle(2);
  await toggle(3);
  const entries = () => page.evaluate(() => [...document.querySelectorAll(".undo-entry")].map(b => b.textContent));
  const before = await entries();
  await page.locator(".undo-entry").nth(1).click();
  await settle();
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
  // (a) the undo list can't be rewound (Solid: a list rewritten wholesale records only its length, and its items come
  // from the backing under a view): every seq whose undo list differs must say so
  const unflagged = undoOff.filter(n => !inexactAt.get(n).includes(UNDO_KEYS[0]));
  check(`(a) every seq whose undo list can't be shown is marked inexact (differs at ${undoOff.join(",") || "none"})`, unflagged.length === 0, unflagged);
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
