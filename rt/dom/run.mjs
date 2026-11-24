// Differential browser-bundle driver under jsdom.
//
// Click rule (one rule, every app, every variant):
//   { click: i }  → bubbling MouseEvent "click" on the i-th element, in document order, of
//                   button, [role=button], a, input[type=checkbox]
//   { input: i, value } → set .value on the i-th input/textarea in document order
//                   (input excluding type=checkbox|button|submit|reset|radio|hidden|file, plus textarea),
//                   then dispatch bubbling "input" and "change".
//   { resolve: true } → shift the oldest {resolve,reject,value} off the bundled api `pending` array
//                   and call resolve(value).
//
// Why not the wider selector that also names li, td, th: every corpus drive.mjs indexes buttons,
// not rows or cells. todos documents Done/Remove as buttons 4/5, 6/7, … and each pair sits in an
// <li>; search's result buttons sit in <li>; kanban and dashboard render <li> that are not controls;
// table's drive says indexes must not move when the filter does, which is only true if <td> is not
// a click target. role=button, anchors and checkbox inputs are included so a control that is not a
// <button> still counts; none of these 14 apps render one, so the indexes match the drive comments.
//
// Logs: window console (log/error/warn/info) plus __app.log, which is where `log()` actually writes
// (the runtime does not call console.log). Uncaught errors and unhandled rejections are separate.
//
// Settle, after mount and after every step: two window queueMicrotask turns, then two window
// setTimeout(0). Normalization: strip <!--…-->, attributes whose names start with data-hk / _hk /
// data-sm, drop inter-tag whitespace, collapse remaining whitespace runs to one space.
//
// Variants: repeatable --variant LABEL=WORKTREE:MODE. The variant labeled R is the reference
// (else the first). --sabotage also runs a second pass where, after mount, every 3rd click on a
// non-reference variant is dispatched at index+1.
//
// One node child at a time. Builds go through rt/dom/bundle-dom.ts. Eval is this file with --eval.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";

const BENCH = "/home/lucifer/work/solidjs/store-proto-bench";
const HERE = join(BENCH, "rt/dom");
const LOGS = join(HERE, "logs");
const JSDOM_PKG = "/home/lucifer/work/solidjs/store-proto-base/node_modules/.pnpm/jsdom@25.0.1/node_modules/jsdom/package.json";
const CLICK_SEL = "button, [role=button], a, input[type=checkbox]";
const INPUT_SEL = 'input:not([type="checkbox"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="radio"]):not([type="hidden"]):not([type="file"]), textarea';

const DEFAULT_VARIANTS = [
  ["R", "/home/lucifer/work/solidjs/rx-store-proto-base", "plain"],
  ["A", "/home/lucifer/work/solidjs/rx-rt-proto-tiers", "manifest"],
  ["B", "/home/lucifer/work/solidjs/rx-rt-proto-tiers", "csr"],
  ["C", "/home/lucifer/work/solidjs/rx-rt-proto-tiers", "csr-all"],
];

// Single-file apps have no drive.mjs. Fixed order, a few clicks each.
// optimistic/keyed use the pending stub (save / loadRows), so the drive resolves.
const FILE_DRIVES = {
  counter: [{ click: 0 }, { click: 0 }, { click: 0 }, { click: 0 }, { click: 0 }, { click: 0 }],
  rows: [
    { click: 0 }, { click: 2 }, { click: 2 }, { click: 2 },
    { click: 3 }, { click: 3 }, { click: 3 },
    { click: 4 }, { click: 4 },
    { click: 6 }, { click: 6 }, { click: 6 },
    { click: 5 },
    { click: 1 }, { click: 2 }, { click: 3 }, { click: 4 }, { click: 6 }, { click: 5 },
    { click: 1 }, { click: 4 }, { click: 5 },
    { click: 0 }, { click: 3 }, { click: 6 }, { click: 5 },
  ],
  optimistic: [
    { click: 0 }, { resolve: true },
    { click: 0 }, { resolve: true },
    { click: 0 }, { click: 0 }, { resolve: true }, { resolve: true },
    { click: 0 }, { resolve: true },
    { click: 0 }, { resolve: true },
  ],
  keyed: [
    { resolve: true },
    { click: 0 }, { resolve: true },
    { click: 0 }, { resolve: true },
    { click: 0 }, { resolve: true },
    { click: 0 }, { resolve: true },
    { click: 0 }, { resolve: true },
  ],
};

const CORPUS = ["chat", "counter-tabs", "dashboard", "form", "kanban", "search", "settings", "table", "todos", "wizard"];
const FILES = ["counter", "rows", "optimistic", "keyed"];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
function opt(name) {
  const i = args.indexOf(name);
  return i < 0 ? null : args[i + 1];
}
function opts(name) {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === name) out.push(args[i + 1]);
  return out;
}

if (flag("--eval")) {
  evalMain().then(
    () => process.exit(0),
    (e) => { console.error(e && e.stack || e); process.exit(1); },
  );
} else {
  orchestrate().then(
    (code) => process.exit(code),
    (e) => { console.error(e && e.stack || e); process.exit(1); },
  );
}

function parseVariant(s) {
  const eq = s.indexOf("=");
  if (eq < 1) throw new Error("variant must be LABEL=WORKTREE:MODE, got " + s);
  const label = s.slice(0, eq);
  const rest = s.slice(eq + 1);
  const colon = rest.lastIndexOf(":");
  if (colon < 1) throw new Error("variant must be LABEL=WORKTREE:MODE, got " + s);
  return { label, wt: resolve(rest.slice(0, colon)), mode: rest.slice(colon + 1) };
}

function variantsFromArgs() {
  const given = opts("--variant");
  const rows = given.length ? given.map(parseVariant) : DEFAULT_VARIANTS.map(([label, wt, mode]) => ({ label, wt, mode }));
  const ref = rows.find((v) => v.label === "R") || rows[0];
  return { rows, ref };
}

function appList() {
  const given = opt("--apps");
  if (!given) return [...CORPUS, ...FILES];
  return given.split(",").map((s) => s.trim()).filter(Boolean);
}

function targetOf(name) {
  const file = join(BENCH, name + ".rx");
  if (existsSync(file)) return file;
  const dir = join(BENCH, "corpus", name);
  if (existsSync(join(dir, "main.rx"))) return dir;
  throw new Error("unknown app " + name);
}

async function loadSteps(name) {
  if (FILE_DRIVES[name]) return FILE_DRIVES[name];
  const mod = await import(pathToFileURL(join(BENCH, "corpus", name, "drive.mjs")).href);
  if (!Array.isArray(mod.steps)) throw new Error(name + " drive.mjs has no steps array");
  return mod.steps;
}

function bundlePath(wt, name, mode) {
  return join(wt, "ref/compile/.out", `rtbundle-${name}-${mode}`, "app.js");
}

function bundleOk(appJs) {
  if (!existsSync(appJs)) return false;
  // rt/bundle.ts bundles have no __app. Reusing one makes every step a harness miss.
  return readFileSync(appJs, "utf8").includes("__app");
}

function runChild(cmd, argv, { input, timeout = 180000 } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, argv, { stdio: ["pipe", "pipe", "pipe"], signal: AbortSignal.timeout(timeout) });
    let out = "", err = "", settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolvePromise(v); } };
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => finish({ code: -1, signal: e.name || "error", out, err: err + (e.stack || String(e)) }));
    child.on("close", (code, signal) => finish({ code, signal, out, err }));
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

function lastJson(text) {
  const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("{")) {
      try { return JSON.parse(lines[i]); } catch { /* keep looking */ }
    }
  }
  return null;
}

async function buildOne(app, v, reuse) {
  const target = targetOf(app);
  const appJs = bundlePath(v.wt, app, v.mode);
  if (reuse && bundleOk(appJs)) {
    console.error(`reuse ${app} ${v.label} ${appJs}`);
    return { appJs, size: null, reused: true };
  }
  console.error(`build ${app} ${v.label} ${basename(v.wt)}:${v.mode}`);
  const r = await runChild(process.execPath, ["--max-old-space-size=1536", "--experimental-strip-types", join(HERE, "bundle-dom.ts"), v.wt, target, v.mode], { timeout: 180000 });
  const size = lastJson(r.out);
  if (r.code !== 0 || !size) {
    const msg = (r.err || r.out || "build failed").slice(0, 4000);
    return { appJs, size: null, error: `build exit ${r.code} signal ${r.signal || ""}\n${msg}` };
  }
  writeFileSync(join(LOGS, `build-${app}-${v.label}.json`), JSON.stringify(size));
  console.error(`built ${app} ${v.label} gzip ${size.gzip} min ${size.min}`);
  return { appJs, size, error: null };
}

async function evalOne(app, v, appJs, steps, sabotage) {
  const outFile = join(LOGS, `eval-${app}-${v.label}${sabotage ? "-sab" : ""}.json`);
  const payload = JSON.stringify({ appJs, wt: v.wt, steps, sabotage, outFile, app, label: v.label });
  console.error(`eval ${app} ${v.label}${sabotage ? " sabotage" : ""}`);
  const r = await runChild(process.execPath, ["--max-old-space-size=1536", join(HERE, "run.mjs"), "--eval"], { input: payload, timeout: 180000 });
  if (r.err.trim()) writeFileSync(join(LOGS, `eval-${app}-${v.label}${sabotage ? "-sab" : ""}.err`), r.err);
  if (!existsSync(outFile)) {
    return { threw: { step: "harness", stack: `eval child exit ${r.code} signal ${r.signal || ""}\n${(r.err || r.out).slice(0, 4000)}` }, snapshots: [], diag: {} };
  }
  return JSON.parse(readFileSync(outFile, "utf8"));
}

function snapOf(s) {
  return { html: s.html, inputs: s.inputs, logs: s.logs, errors: s.errors };
}

function windowAround(a, b) {
  const as = typeof a === "string" ? a : JSON.stringify(a);
  const bs = typeof b === "string" ? b : JSON.stringify(b);
  let i = 0;
  const n = Math.min(as.length, bs.length);
  while (i < n && as[i] === bs[i]) i++;
  const start = Math.max(0, i - 300);
  const slice = (s) => s.slice(start, start + 600);
  return { at: i, lenR: as.length, lenV: bs.length, R: slice(as), V: slice(bs) };
}

function stepLabel(snap, threw) {
  if (threw && (snap == null)) return String(threw.step);
  if (!snap) return "?";
  if (snap.step === "mount") return "mount";
  return `step ${snap.step} ${JSON.stringify(snap.action)}`;
}

function firstDiff(ref, variant) {
  const n = Math.max(ref.snapshots.length, variant.snapshots.length);
  for (let i = 0; i < n; i++) {
    const a = ref.snapshots[i], b = variant.snapshots[i];
    if (!a || !b) {
      return { kind: "length", step: stepLabel(a || b, variant.threw), window: windowAround(a ? snapOf(a) : null, b ? snapOf(b) : null), stack: variant.threw && variant.threw.stack };
    }
    if (JSON.stringify(snapOf(a)) !== JSON.stringify(snapOf(b))) {
      return { kind: "snapshot", step: stepLabel(a), action: a.action, window: windowAround(snapOf(a), snapOf(b)) };
    }
  }
  if (variant.threw) return { kind: "throw", step: String(variant.threw.step), stack: variant.threw.stack || variant.threw.message || "" };
  return null;
}

function refThrew(ref) {
  // An uncaught error during a step halts the runtime. A later harness throw
  // (empty pending, missing node) is a consequence; report the first error.
  for (const s of ref.snapshots || []) if (s.errors && s.errors.length) return { step: s.step, stack: s.errors.join("\n") };
  if (ref.threw) return ref.threw;
  return null;
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); }

function formatDiff(app, label, diff) {
  const lines = [];
  lines.push(`### ${app} × ${label}  DIFFER ${diff.step}  (${diff.kind})`);
  if (diff.stack) {
    lines.push("stack:");
    lines.push(diff.stack.split("\n").slice(0, 40).join("\n"));
  }
  if (diff.window) {
    lines.push(`first difference at char ${diff.window.at} (R len ${diff.window.lenR}, variant len ${diff.window.lenV})`);
    lines.push("--- R ---");
    lines.push(diff.window.R);
    lines.push(`--- ${label} ---`);
    lines.push(diff.window.V);
  }
  return lines.join("\n");
}

function formatTable(title, apps, labels, cells) {
  const wApp = Math.max(12, ...apps.map((a) => a.length));
  const cols = labels.map((l) => Math.max(l.length, 12));
  const head = pad("app", wApp) + "  " + labels.map((l, i) => pad(l, cols[i])).join("  ");
  const body = apps.map((a) => pad(a, wApp) + "  " + labels.map((l, i) => pad((cells[a] && cells[a][l]) ?? "", cols[i])).join("  "));
  return [title, head, ...body].join("\n");
}

async function orchestrate() {
  mkdirSync(LOGS, { recursive: true });
  const { rows, ref } = variantsFromArgs();
  const apps = appList();
  const sabotage = flag("--sabotage");
  const reuse = flag("--reuse");
  const sizes = {};
  const real = {};
  const sab = {};
  const details = [];
  const sabDetails = [];
  const excluded = [];
  const sizeLines = [];

  console.error(`apps ${apps.join(",")}  variants ${rows.map((v) => v.label + "=" + basename(v.wt) + ":" + v.mode).join(" ")}  ref ${ref.label}${sabotage ? "  +sabotage" : ""}`);

  for (const app of apps) {
    const steps = await loadSteps(app);
    const built = {};
    let buildFailed = null;
    for (const v of rows) {
      const b = await buildOne(app, v, reuse);
      built[v.label] = b;
      if (b.size) { sizes[app] = sizes[app] || {}; sizes[app][v.label] = b.size.gzip; sizeLines.push(JSON.stringify(b.size)); }
      else if (b.reused) { /* size filled below if we have the file */ }
      if (b.error && v.label === ref.label) buildFailed = b.error;
    }
    if (reuse) {
      for (const v of rows) {
        const p = join(LOGS, `build-${app}-${v.label}.json`);
        if (sizes[app] && sizes[app][v.label] != null) continue;
        if (existsSync(p)) {
          const size = JSON.parse(readFileSync(p, "utf8"));
          sizes[app] = sizes[app] || {};
          sizes[app][v.label] = size.gzip;
          sizeLines.push(JSON.stringify(size));
        }
      }
    }
    real[app] = { steps: steps.length };
    if (buildFailed) {
      excluded.push({ app, reason: "reference build failed", detail: buildFailed });
      for (const v of rows) if (v !== ref) real[app][v.label] = "excluded";
      console.error(`EXCLUDE ${app} reference build failed`);
      continue;
    }
    const refBuilt = built[ref.label];
    if (refBuilt.error) {
      excluded.push({ app, reason: "reference build failed", detail: refBuilt.error });
      continue;
    }
    const refRes = await evalOne(app, ref, refBuilt.appJs, steps, false);
    const refErr = refThrew(refRes);
    if (refErr) {
      excluded.push({ app, reason: `reference threw at ${refErr.step}`, detail: refErr.stack || refErr.message || "" });
      for (const v of rows) if (v !== ref) real[app][v.label] = "excluded";
      writeFileSync(join(LOGS, `exclude-${app}.txt`), (refErr.stack || "") + "\n");
      console.error(`EXCLUDE ${app} reference threw at ${refErr.step}`);
      continue;
    }
    for (const v of rows) {
      if (v === ref) continue;
      const b = built[v.label];
      if (b.error) {
        real[app][v.label] = "build-fail";
        details.push(`### ${app} × ${v.label}  DIFFER build\n${b.error}`);
        console.error(`DIFF ${app} ${v.label} build-fail`);
        continue;
      }
      const res = await evalOne(app, v, b.appJs, steps, false);
      const diff = firstDiff(refRes, res);
      if (!diff) {
        real[app][v.label] = "identical";
        console.error(`OK ${app} ${v.label} identical (${steps.length} steps)`);
      } else {
        real[app][v.label] = diff.step;
        details.push(formatDiff(app, v.label, diff));
        writeFileSync(join(LOGS, `diff-${app}-${v.label}.json`), JSON.stringify({ app, label: v.label, diff, refThrew: refRes.threw, varThrew: res.threw }, null, 2));
        console.error(`DIFF ${app} ${v.label} ${diff.step}`);
      }
      if (sabotage) {
        const sres = await evalOne(app, v, b.appJs, steps, true);
        const sdiff = firstDiff(refRes, sres);
        sab[app] = sab[app] || {};
        if (!sdiff) {
          sab[app][v.label] = "identical";
          console.error(`SAB ${app} ${v.label} identical (harness did not see a difference)`);
        } else {
          sab[app][v.label] = sdiff.step;
          sabDetails.push(formatDiff(app, v.label + " sabotage", sdiff));
          console.error(`SAB ${app} ${v.label} ${sdiff.step}`);
        }
      }
    }
  }

  const labels = rows.filter((v) => v !== ref).map((v) => v.label);
  const lines = [];
  lines.push("DOM differential");
  lines.push(`click: document.querySelectorAll(${JSON.stringify(CLICK_SEL)})[i], bubbling MouseEvent click`);
  lines.push(`input: document.querySelectorAll(${JSON.stringify(INPUT_SEL)})[i], set .value, dispatch input+change`);
  lines.push("resolve: shift oldest api.pending and call resolve(value)");
  lines.push("li/td/th are not clickable: drive.mjs comments index buttons (todos Done/Remove are buttons 4/5 inside <li>; search result buttons sit in <li>; table indexes must not move with the rows).");
  lines.push("normalize: strip <!--…-->, attributes starting data-hk/_hk/data-sm, drop inter-tag whitespace, collapse remaining whitespace");
  lines.push("logs: window console log/error/warn/info, plus __app.log (where log() writes)");
  lines.push("");
  lines.push("commands:");
  lines.push(`  node --experimental-strip-types ${join(HERE, "bundle-dom.ts")} <worktree> <app> <mode>`);
  lines.push(`  node ${join(HERE, "run.mjs")}${sabotage ? " --sabotage" : ""}`);
  lines.push("");
  if (excluded.length) {
    lines.push("excluded (reference threw or failed to build):");
    for (const e of excluded) {
      lines.push(`  ${e.app}: ${e.reason}`);
      lines.push(e.detail.split("\n").slice(0, 30).map((l) => "    " + l).join("\n"));
    }
    lines.push("");
  }
  const live = apps.filter((a) => !excluded.some((e) => e.app === a));
  lines.push(formatTable("results (vs R)", apps, ["steps", ...labels], real));
  lines.push("");
  if (sabotage) {
    lines.push(formatTable("sabotage (every 3rd click → index+1, non-reference only)", apps, labels, sab));
    lines.push("");
  }
  const sizeLabels = rows.map((v) => v.label);
  const sizeCells = {};
  for (const a of apps) {
    sizeCells[a] = {};
    for (const v of rows) sizeCells[a][v.label] = sizes[a] && sizes[a][v.label] != null ? String(sizes[a][v.label]) : "";
  }
  lines.push(formatTable("gzip bytes", apps, sizeLabels, sizeCells));
  lines.push("");
  if (details.length) {
    lines.push("differences");
    lines.push(details.join("\n\n"));
    lines.push("");
  } else {
    lines.push("differences: none");
    lines.push("");
  }
  if (sabotage) {
    lines.push("sabotage differences");
    lines.push(sabDetails.length ? sabDetails.join("\n\n") : "(none)");
    lines.push("");
  }
  lines.push("build JSON lines:");
  lines.push(sizeLines.join("\n") || "(reused; see logs/build-*.json)");
  lines.push("");
  const text = lines.join("\n");
  writeFileSync(join(LOGS, "report.txt"), text);
  if (sabotage) writeFileSync(join(LOGS, "report-sabotage.txt"), text);
  writeFileSync(join(LOGS, "sizes.jsonl"), sizeLines.join("\n") + "\n");
  process.stdout.write(text);
  const anyDiff = details.length > 0 || excluded.length > 0;
  return anyDiff ? 1 : 0;
}

// --- eval child: one bundle, one jsdom window, then exit ---

function normalizeHtml(html) {
  let s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/\s+(?:data-hk|_hk|data-sm)[^\s=/>]*(?:=(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/gi, "");
  s = s.replace(/>\s+</g, "><");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function fmtArg(a) {
  if (a == null) return String(a);
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.stack || a.message;
  try { return JSON.stringify(a); } catch { return String(a); }
}

async function settle(window) {
  await new Promise((r) => window.queueMicrotask(r));
  await new Promise((r) => window.queueMicrotask(r));
  await new Promise((r) => window.setTimeout(r, 0));
  await new Promise((r) => window.setTimeout(r, 0));
}

async function evalMain() {
  const raw = await new Promise((res, rej) => {
    let s = "";
    process.stdin.on("data", (d) => { s += d; });
    process.stdin.on("end", () => res(s));
    process.stdin.on("error", rej);
  });
  const job = JSON.parse(raw);
  const { JSDOM, VirtualConsole } = createRequire(JSDOM_PKG)("jsdom");
  const logs = [];
  const errors = [];
  const seen = new Set();
  const pushErr = (e) => {
    const s = e && e.stack ? e.stack : String(e && e.message || e);
    if (seen.has(s)) return;
    seen.add(s);
    errors.push(s);
  };
  process.on("unhandledRejection", pushErr);
  const vc = new VirtualConsole();
  for (const level of ["log", "error", "warn", "info"]) {
    vc.on(level, (...a) => logs.push(level + " " + a.map(fmtArg).join(" ")));
  }
  vc.on("jsdomError", (err) => logs.push("jsdom " + String(err && (err.message || err)).split("\n")[0]));
  const dom = new JSDOM(`<!doctype html><html><body><div id="app"></div></body></html>`, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "http://localhost/",
    virtualConsole: vc,
  });
  const window = dom.window;
  window.addEventListener("error", (ev) => pushErr(ev.error || ev.message));
  window.addEventListener("unhandledrejection", (ev) => pushErr(ev.reason));
  if (typeof window.queueMicrotask !== "function") window.queueMicrotask = queueMicrotask;
  if (typeof window.MessageChannel !== "function") window.MessageChannel = MessageChannel;
  if (typeof window.structuredClone !== "function") window.structuredClone = structuredClone;
  if (typeof window.setTimeout !== "function") window.setTimeout = setTimeout;
  if (typeof window.clearTimeout !== "function") window.clearTimeout = clearTimeout;
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(Date.now()), 0);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  if (typeof window.requestIdleCallback !== "function") window.requestIdleCallback = (cb) => window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 0);

  const { buildSync } = createRequire(join(job.wt, "ref/package.json"))("esbuild");
  const built = buildSync({
    entryPoints: [job.appJs],
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
    logLevel: "warning",
  });
  const code = built.outputFiles[0].text;

  const result = { threw: null, snapshots: [], diag: {} };
  const clickables = () => [...window.document.querySelectorAll(CLICK_SEL)];
  const fields = () => [...window.document.querySelectorAll(INPUT_SEL)];
  let clickN = 0;

  function takeSnap(step, action) {
    const appLog = window.__app && Array.isArray(window.__app.log) ? window.__app.log.map((l) => "app " + l) : [];
    const root = window.document.getElementById("app");
    result.snapshots.push({
      step,
      action,
      html: normalizeHtml(root ? root.innerHTML : ""),
      inputs: fields().map((el) => el.value),
      logs: logs.concat(appLog),
      errors: errors.slice(),
    });
  }

  function doClick(i) {
    clickN++;
    let idx = i;
    let note = "";
    if (job.sabotage && clickN % 3 === 0) {
      idx = i + 1;
      note = ` sabotage#${clickN} ${i}->${idx}`;
    }
    const els = clickables();
    const el = els[idx];
    if (!el) {
      const texts = els.map((e) => (e.textContent || "").trim().slice(0, 24)).join("|");
      throw new Error(`click ${i}${note}: index ${idx} missing, ${els.length} clickables [${texts}]`);
    }
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: window, button: 0 }));
  }

  function doInput(i, value) {
    const els = fields();
    const el = els[i];
    if (!el) throw new Error(`input ${i}: only ${els.length} fields`);
    el.value = value;
    el.dispatchEvent(new window.Event("input", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new window.Event("change", { bubbles: true, cancelable: true }));
  }

  function doResolve() {
    const pending = (window.__api && window.__api.pending) || window.__pending;
    if (!pending || typeof pending.shift !== "function") throw new Error("resolve: bundled api has no pending array");
    if (!pending.length) throw new Error("resolve: no pending api promise");
    const item = pending.shift();
    item.resolve(item.value);
  }

  try {
    window.eval(code);
  } catch (e) {
    result.threw = { step: "mount", stack: e.stack || String(e), message: e.message || String(e) };
    writeFileSync(job.outFile, JSON.stringify(result));
    window.close();
    return;
  }
  if (!window.__app) {
    result.threw = { step: "mount", stack: "harness: eval ran but globalThis.__app is missing", message: "no __app" };
    writeFileSync(job.outFile, JSON.stringify(result));
    window.close();
    return;
  }
  try {
    await settle(window);
    takeSnap("mount", null);
    result.diag = {
      pending: (window.__api && window.__api.pending && window.__api.pending.length) || 0,
      clickables: clickables().length,
      fields: fields().length,
      texts: clickables().map((e) => (e.textContent || "").trim().slice(0, 40)),
    };
    for (let i = 0; i < job.steps.length; i++) {
      const step = job.steps[i];
      try {
        if ("click" in step) doClick(step.click);
        else if ("input" in step) doInput(step.input, step.value);
        else if (step.resolve) doResolve();
        else throw new Error("unknown step " + JSON.stringify(step));
      } catch (e) {
        result.threw = { step: i, stack: e.stack || String(e), message: e.message || String(e) };
        break;
      }
      await settle(window);
      takeSnap(i, step);
      if (errors.length && result.snapshots[result.snapshots.length - 1].errors.length) {
        // recorded in the snapshot; keep driving unless the step itself threw
      }
    }
  } catch (e) {
    if (!result.threw) result.threw = { step: "harness", stack: e.stack || String(e), message: e.message || String(e) };
  }
  writeFileSync(job.outFile, JSON.stringify(result));
  window.close();
}
