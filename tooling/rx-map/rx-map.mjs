#!/usr/bin/env node
// rx-map: draw a .rx program as a static map, straight from the checker's resolved model (`rxc model`, spec/11 CP-6).
// No runtime, no build: where every source, equation, action and view site lives, and how they read, write and call
// each other and the world outside the program.
//
//   node tooling/rx-map/rx-map.mjs examples/notes/main.rx -o notes-map.html
//   node tooling/rx-map/rx-map.mjs examples/notes/main.rx --diff main        # what changed since `main`
//   node tooling/rx-map/rx-map.mjs examples/notes/main.rx --diff before.json # against a saved --json graph
//
// `rxc` is found as $RXC, then compiler/target/{release,debug}/rxc in this repo, then `rxc` on PATH.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph } from "./graph.mjs";
import { diffGraphs } from "./diff.mjs";
import { pageHTML } from "./page.mjs";
import { merge, rebase, report, summary } from "./coverage.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

function usage(code = 1) {
  console.error("usage: rx-map <entry.rx>... [-o out.html] [--json] [--diff <git-ref | before.json>] [--coverage file]");
  console.error("       rx-map mcp [--root <dir>] [--entry <file.rx>...] [--dev <url>]");
  console.error("       rx-map coverage report [files...|dir] [--entry e] [--module m] [--kind k] [--json] [--min pct]");
  console.error("       rx-map coverage merge <files...> -o out.json");
  console.error("       rx-map trace <file> [-o out.html] [--open]");
  process.exit(code);
}

const args = process.argv.slice(2);
const rxc = (process.env.RXC && (/[\\/]/.test(process.env.RXC) ? resolve(process.env.RXC) : process.env.RXC))
  ?? [resolve(repo, "compiler/target/release/rxc"), resolve(repo, "compiler/target/debug/rxc")].find(existsSync)
  ?? "rxc";
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] });
if (!args.length || args.includes("-h") || args.includes("--help")) usage(args.length ? 0 : 1);
if (args[0] === "mcp") {
  const options = { entries: [] };
  for (let i = 1; i < args.length; i++) {
    const flag = args[i], value = args[++i];
    if (!value || value.startsWith("--")) usage();
    if (flag === "--entry") options.entries.push(value);
    else if (flag === "--root") options.root = value;
    else if (flag === "--dev") options.dev = value;
    else usage();
  }
  const { serveMcp } = await import("./mcp.mjs");
  await serveMcp(options);
} else {
  try {
    if (args[0] === "coverage") runCoverage();
    else if (args[0] === "trace") runTrace();
    else runMap();
  } catch (e) { fail(e); }
}

/** The graph of `files` (relative to `cwd`), with module paths relative to `cwd` so two checkouts key alike. */
function graphOf(files, cwd) {
  const model = JSON.parse(execFileSync(rxc, ["model", ...files], { cwd, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] }));
  return buildGraph(model, { root: cwd });
}
function fail(e) { process.stderr.write(e.stderr || e.stdout || `${e.message}\n`); process.exit(1); }

function readRecord(path, marker) {
  const file = JSON.parse(readFileSync(path, "utf8"));
  if (file?.[marker] !== 1) throw new Error(`${path}: expected ${marker}: 1`);
  return file;
}

function runCoverage() {
  const mode = args[1], files = [], entries = [];
  let out, module, kind, json = false, min;
  if (mode !== "report" && mode !== "merge") usage();
  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    const value = () => args[i + 1] && !args[i + 1].startsWith("-") ? args[++i] : usage();
    if (mode === "merge" && arg === "-o") out = value();
    else if (mode === "report" && arg === "--entry") entries.push(value());
    else if (mode === "report" && arg === "--module") module = value();
    else if (mode === "report" && arg === "--kind") kind = value();
    else if (mode === "report" && arg === "--min") min = Number(value());
    else if (mode === "report" && arg === "--json") json = true;
    else if (!arg.startsWith("-")) files.push(arg);
    else usage();
  }
  if (mode === "merge" && (!out || !files.length)) usage();
  if (min !== undefined && (!Number.isFinite(min) || min < 0 || min > 100)) throw new Error("--min must be between 0 and 100");
  if (kind && !["node", "edge", "loading", "errored", "guess", "action"].includes(kind)) throw new Error(`unknown coverage kind: ${kind}`);
  const defaultDir = process.env.RX_COVERAGE_DIR || ".rx-coverage";
  const paths = (files.length ? files : entries.length && !existsSync(defaultDir) ? [] : [defaultDir]).flatMap(path => {
    if (!statSync(path).isDirectory()) return [path];
    const records = readdirSync(path, { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith(".json")).map(e => e.name).sort();
    // Prefer raw runs to the aggregate usually written alongside them for MCP.
    const runs = records.filter(name => /^run-.*\.json$/.test(name));
    return (runs.length ? runs : records).map(name => join(path, name));
  });
  let file = merge(...paths.map(path => readRecord(path, "rxCoverage")));
  if (mode === "merge") return writeFileSync(out, JSON.stringify(file, null, 2) + "\n");
  if (entries.length) file = rebase(file, graphOf(entries.map(e => resolve(e)), process.cwd()));
  writeFileSync(1, report(file, { module, kind, json }) + "\n");
  const { covered, total } = summary(file).all;
  if (min !== undefined && (total ? covered / total * 100 : 100) < min) process.exitCode = 1;
}

function runTrace() {
  const input = args[1];
  if (!input || input.startsWith("-")) usage();
  let out, open = false;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === "-o" && args[i + 1] && !args[i + 1].startsWith("-")) out = args[++i];
    else if (args[i] === "--open") open = true;
    else usage();
  }
  out ??= input.replace(/(?:\.rxtrace)?\.json$/, "") + ".html";
  const trace = readRecord(input, "rxTrace");
  writeFileSync(out, pageHTML(trace.graph, { trace }));
  console.log(out);
  if (open) execFileSync(process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open", [resolve(out)]);
}

function runMap() {
let out = null, json = false, diff = null, coverageFile;
const entries = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "-o") out = args[++i] ?? usage();
  else if (args[i] === "--json") json = true;
  else if (args[i] === "--diff") diff = args[++i] ?? usage();
  else if (args[i] === "--coverage") coverageFile = args[++i] ?? usage();
  else entries.push(args[i]);
}
if (!entries.length) usage();
let graph;
if (!diff) {
  try { graph = graphOf(entries.map(e => resolve(e)), process.cwd()); } catch (e) { fail(e); }
  graph.title = entries.map(e => basename(e)).join(", ");
} else {
  // the after side is the working tree; the before side is a git ref, extracted to a scratch dir, or a saved graph
  let top;
  try { top = git(dirname(resolve(entries[0])), "rev-parse", "--show-toplevel").trim(); } catch { top = process.cwd(); }
  const rel = entries.map(e => relative(top, resolve(e)));
  let before, after;
  try { after = graphOf(rel, top); } catch (e) { fail(e); }
  after.label = "working tree";
  if (diff.endsWith(".json") && existsSync(diff)) {
    before = JSON.parse(readFileSync(diff, "utf8"));
    before.label = basename(diff);
  } else {
    const scratch = mkdtempSync(join(tmpdir(), "rx-map-"));
    try {
      const sha = git(top, "rev-parse", "--short", diff).trim();
      // the entries' top-level folders first (fast); the whole tree if an import reaches outside them
      const roots = [...new Set(rel.map(r => r.split(/[\\/]/)[0]))];
      const extract = paths => execFileSync("sh", ["-c", `git archive "$0" -- "$@" | tar -x -C "${scratch}"`, sha, ...paths], { cwd: top, stdio: ["ignore", "ignore", "pipe"] });
      extract(roots);
      try { before = graphOf(rel, scratch); }
      catch { extract(["."]); before = graphOf(rel, scratch); }
      before.label = `${diff} (${sha})`;
      before.absModules = null;
    } catch (e) { rmSync(scratch, { recursive: true, force: true }); fail(e); }
    rmSync(scratch, { recursive: true, force: true });
  }
  graph = diffGraphs(before, after);
  graph.title = `${entries.map(e => basename(e)).join(", ")} · ${before.label} → ${after.label}`;
}

if (json) {
  const text = JSON.stringify(graph, null, 2);
  // writeFileSync on fd 1, not process.stdout.write: exiting right after an async write to a pipe cuts it at 64 KB
  writeFileSync(out ?? 1, out ? text : text + "\n");
  process.exit(0);
}
out ??= entries[0].replace(/\.rx$/, "") + (diff ? ".diff" : "") + ".map.html";
const coverage = coverageFile ? rebase(readRecord(coverageFile, "rxCoverage"), graph) : undefined;
writeFileSync(out, pageHTML(graph, { coverage }));
const s = graph.diff ? ` · ${graph.diff.summary.length} notable changes` : "";
console.log(`${out}: ${graph.modules.length} module(s), ${graph.nodes.length} nodes, ${graph.edges.length} edges${s}`);
}
