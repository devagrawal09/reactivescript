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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph } from "./graph.mjs";
import { diffGraphs } from "./diff.mjs";
import { pageHTML } from "./page.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

function usage(code = 1) {
  console.error("usage: rx-map <entry.rx>... [-o out.html] [--json] [--diff <git-ref | before.json>]");
  process.exit(code);
}

const args = process.argv.slice(2);
if (!args.length || args.includes("-h") || args.includes("--help")) usage(args.length ? 0 : 1);
let out = null, json = false, diff = null;
const entries = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "-o") out = args[++i];
  else if (args[i] === "--json") json = true;
  else if (args[i] === "--diff") diff = args[++i] ?? usage();
  else entries.push(args[i]);
}
if (!entries.length) usage();

const rxc = (process.env.RXC && (/[\\/]/.test(process.env.RXC) ? resolve(process.env.RXC) : process.env.RXC))
  ?? [resolve(repo, "compiler/target/release/rxc"), resolve(repo, "compiler/target/debug/rxc")].find(existsSync)
  ?? "rxc";

/** The graph of `files` (relative to `cwd`), with module paths relative to `cwd` so two checkouts key alike. */
function graphOf(files, cwd) {
  const model = JSON.parse(execFileSync(rxc, ["model", ...files], { cwd, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] }));
  return buildGraph(model, { root: cwd });
}
function fail(e) { process.stderr.write(e.stderr || e.stdout || `${e.message}\n`); process.exit(1); }
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] });

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
  if (out) writeFileSync(out, text); else process.stdout.write(text + "\n");
  process.exit(0);
}
out ??= entries[0].replace(/\.rx$/, "") + (diff ? ".diff" : "") + ".map.html";
writeFileSync(out, pageHTML(graph));
const s = graph.diff ? ` · ${graph.diff.summary.length} notable changes` : "";
console.log(`${out}: ${graph.modules.length} module(s), ${graph.nodes.length} nodes, ${graph.edges.length} edges${s}`);
