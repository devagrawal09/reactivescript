// RX bench driver. One command:
//   node /home/lucifer/work/solidjs/store-proto-bench/rx-run.mjs
//   node rx-run.mjs --variants=base,core,features
//   ROUNDS=1 node rx-run.mjs --only create1k
//
// Rotates the selected list each round, pins children to CPU 2 when taskset exists.
// Writes results/rx-<timestamp>.jsonl and results/rx-<timestamp>.md
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fmt, fmtRatio, jsonLines, parseArgs, runChild, summarize, waitForFiles } from "./sample.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = "/home/lucifer/work/solidjs";
const args = parseArgs(process.argv);
const rounds = Number(args.rounds || process.env.ROUNDS || 9);
const memRuns = Number(args["mem-runs"] || 3);
const only = args.only ? String(args.only) : "";

const CATALOG = {
  base: { name: "base", wt: ROOT + "/rx-store-proto-base", solid: ROOT + "/store-proto-base" },
  core: { name: "core", wt: ROOT + "/rx-store-proto-core", solid: ROOT + "/store-proto-core" },
  plain: { name: "plain", wt: ROOT + "/rx-store-proto-plain", solid: ROOT + "/store-proto-plain" },
  both: { name: "both", wt: ROOT + "/rx-store-proto-both", solid: ROOT + "/store-proto-both" },
  features: { name: "features", wt: ROOT + "/rx-store-proto-features", solid: ROOT + "/store-proto-features", select: true },
  writes: { name: "writes", wt: ROOT + "/rx-store-proto-writes", solid: ROOT + "/store-proto-writes" },
  sitecache: { name: "sitecache", wt: ROOT + "/rx-store-proto-sitecache", solid: ROOT + "/store-proto-sitecache" },
  slots: { name: "slots", wt: ROOT + "/rx-store-proto-slots", solid: ROOT + "/store-proto-slots" },
  combined: { name: "combined", wt: ROOT + "/rx-store-proto-combined", solid: ROOT + "/store-proto-combined", select: true }
};
const DEFAULT = ["base", "core", "features", "writes", "sitecache", "slots", "combined"];

function pick() {
  const spec = args.variants || process.env.VARIANTS;
  const names = spec ? String(spec).split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT;
  return names.map((n) => {
    const v = CATALOG[n];
    if (!v) throw new Error("unknown variant " + n + " (have " + Object.keys(CATALOG).join(", ") + ")");
    return v;
  });
}
const VARIANTS = pick();

const WORKLOADS = [
  "create1k", "replace1k", "update", "select1k", "select10k", "swap",
  "bump-sum", "clear1k", "create10k", "deep-write", "optimistic"
];
const MEM_METRICS = ["heap10k", "heap1k", "heapDeep1k"];
const ALLOC_OPS = ["update", "select1k", "bump-sum", "deep-write", "create1k"];

const need = [];
for (const v of VARIANTS) {
  const signals = v.select ? "/packages/signals/dist/select/index.js" : "/packages/signals/dist/prod/index.js";
  need.push(v.solid + signals);
  need.push(v.solid + "/packages/universal/dist/universal.js");
  need.push(v.solid + "/packages/solid/dist/solid.js");
  need.push(v.solid + "/packages/web/dist/web.js");
}
await waitForFiles(need);

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const resultsDir = resolve(here, "results");
mkdirSync(resultsDir, { recursive: true });
const jsonlPath = resolve(resultsDir, `rx-${stamp}.jsonl`);
const mdPath = resolve(resultsDir, `rx-${stamp}.md`);
const lines = [];
function record(obj) {
  lines.push(obj);
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function childFlags(kind, v) {
  const flags = ["--experimental-strip-types"];
  if (v.select) flags.push("--conditions=store-select", "--conditions=browser");
  else flags.push("--conditions=browser");
  if (kind === "mem") flags.unshift("--expose-gc");
  if (kind === "alloc") flags.unshift("--max-semi-space-size=256");
  return flags;
}

async function runVariant(v, kind, round) {
  const script = resolve(here, "rx-bench.ts");
  const argv = ["--variant", v.name, "--wt", v.wt];
  if (v.select) argv.push("--select");
  if (kind === "mem") argv.push("--mem");
  if (kind === "alloc") argv.push("--alloc");
  if (only) argv.push("--only", only);
  const t0 = Date.now();
  console.error(`rx ${kind} round ${round + 1} ${v.name} ...`);
  const res = await runChild(childFlags(kind, v), [script, ...argv]);
  console.error(`rx ${kind} round ${round + 1} ${v.name} exit=${res.code} ${Date.now() - t0}ms`);
  if (res.err) process.stderr.write(res.err);
  const rows = jsonLines(res.out);
  if (!rows.length) {
    record({
      kind: "error", variant: v.name, workload: kind, round,
      error: `child produced no JSON (exit ${res.code} ${res.signal || ""})`,
      stack: res.err.slice(-4000)
    });
  }
  for (const row of rows) record({ ...row, round });
  return res.code;
}

function rotate(list, r) {
  return list.map((_, i) => list[(i + r) % list.length]);
}

const wall0 = Date.now();
for (let r = 0; r < rounds; r++) {
  for (const v of rotate(VARIANTS, r)) await runVariant(v, "time", r);
}
for (let r = 0; r < memRuns; r++) {
  for (const v of rotate(VARIANTS, r)) await runVariant(v, "mem", r);
}
for (let r = 0; r < memRuns; r++) {
  for (const v of rotate(VARIANTS, r)) await runVariant(v, "alloc", r);
}
const wall = Date.now() - wall0;

const times = lines.filter((l) => l.kind === "time");
const errors = lines.filter((l) => l.kind === "error");
const mems = lines.filter((l) => l.kind === "mem");
const allocs = lines.filter((l) => l.kind === "alloc");
const notes = lines.filter((l) => l.kind === "note");
const feats = lines.filter((l) => l.kind === "features");
const names = VARIANTS.map((v) => v.name);
const workloads = only ? WORKLOADS.filter((w) => only.split(",").includes(w)) : WORKLOADS;

function samplesOf(variant, workload) {
  return times.filter((l) => l.variant === variant && l.workload === workload).flatMap((l) => l.samples || []);
}

let md = "";
md += `# RX store bench\n\n`;
md += `Command: \`node ${resolve(here, "rx-run.mjs")}\`\n\n`;
md += `Variants: ${names.join(", ")}.\n\n`;
md += `Rounds: ${rounds}. Mem/alloc runs: ${memRuns}. Wall: ${(wall / 1000).toFixed(1)}s. Node ${process.version}.\n\n`;
md += `Warmup stops at 30 ops or 300 ms, whichever first. A sample is a batch aimed at >= 20 ms. `;
md += `update is µs per click (100 clicks per timed call). `;
md += `Clear, re-run, and the create1k/create10k clear-after are outside the timer. `;
md += `frameHash is sha1(app.frame() + class props). `;
md += `features and combined run with --conditions=store-select --conditions=browser, and setGlobals(compiled.features) before the runtime import and before each mount. `;
md += `Ratios are median / base and median / core.\n\n`;
md += `The test renderer’s createElement ignores static props, so the harness wraps it and applies them with setProp before mount. That cost is not inside the timed click.\n\n`;
md += `Order rotates the selected list each round. Children pinned with taskset -c 2. plain and both stay selectable via --variants.\n\n`;

if (feats.length) {
  md += `## features kept\n\n`;
  const seen = new Set();
  for (const f of feats) {
    const k = f.variant + " " + f.program;
    if (seen.has(k)) continue;
    seen.add(k);
    md += `- ${f.variant} ${f.program}: ${f.kept}\n`;
  }
  md += `\n`;
}

md += `## timing (µs/op)\n\n`;
md += `| workload | variant | median | min | IQR | vs base | vs core | n |\n`;
md += `|---|---|---:|---:|---:|---:|---:|---:|\n`;
for (const w of workloads) {
  const baseMed = summarize(samplesOf("base", w)).median;
  const coreMed = summarize(samplesOf("core", w)).median;
  for (const name of names) {
    const st = summarize(samplesOf(name, w));
    md += `| ${w} | ${name} | ${fmt(st.median)} | ${fmt(st.min)} | ${fmt(st.iqr)} | ${fmtRatio(name === "base" ? 1 : st.median / baseMed)} | ${fmtRatio(name === "core" ? 1 : st.median / coreMed)} | ${st.n} |\n`;
  }
}

md += `\n## frameHash\n\n`;
let anyMismatch = false;
for (const w of workloads) {
  const by = new Map();
  for (const name of names) {
    const hashes = [...new Set(times.filter((l) => l.variant === name && l.workload === w).map((l) => l.frameHash).filter(Boolean))];
    by.set(name, hashes);
  }
  const uniq = [...new Set([...by.values()].flat())];
  const missing = names.filter((n) => !by.get(n).length);
  if (missing.length || uniq.length !== 1) {
    anyMismatch = true;
    md += `**MISMATCH ${w}**\n\n`;
    for (const name of names) {
      const hashes = by.get(name);
      const head = times.find((l) => l.variant === name && l.workload === w)?.frameHead || "";
      const cc = times.find((l) => l.variant === name && l.workload === w)?.classCount;
      md += `- ${name}: ${hashes.length ? hashes.join(", ") : "(none)"} classCount=${cc ?? "?"} head=\`${head.slice(0, 120)}\`\n`;
    }
    md += `\n`;
  } else {
    md += `- ${w}: agree ${uniq[0]}\n`;
  }
}
if (!anyMismatch) md += `\nAll workloads agreed across ${names.join(", ")}.\n`;

md += `\n## memory (bytes, median of ${memRuns})\n\n`;
md += `heap* is heapUsed after two global.gc() calls, minus heapUsed before mount. The graph is kept alive across the second gc.\n\n`;
const allocNote = notes[0]?.note || allocs.find((a) => a.note)?.note || "";
if (allocNote) md += allocNote + `\n\n`;
md += `create1k alloc includes the untimed clear that empties the list, because each measured op has to be a create-on-empty and heapUsed cannot split the two.\n\n`;
md += `| metric | variant | median | min | vs base | vs core |\n`;
md += `|---|---|---:|---:|---:|---:|\n`;
function memValues(variant, metric) {
  return mems.filter((l) => l.variant === variant && l.metric === metric).map((l) => l.value);
}
for (const metric of MEM_METRICS) {
  const baseMed = summarize(memValues("base", metric)).median;
  const coreMed = summarize(memValues("core", metric)).median;
  for (const name of names) {
    const st = summarize(memValues(name, metric));
    md += `| ${metric} | ${name} | ${fmt(st.median, 0)} | ${fmt(st.min, 0)} | ${fmtRatio(name === "base" ? 1 : st.median / baseMed)} | ${fmtRatio(name === "core" ? 1 : st.median / coreMed)} |\n`;
  }
}
function allocValues(variant, workload) {
  return allocs.filter((l) => l.variant === variant && l.workload === workload).map((l) => l.bytesPerOp);
}
for (const w of ALLOC_OPS) {
  const baseMed = summarize(allocValues("base", w)).median;
  const coreMed = summarize(allocValues("core", w)).median;
  for (const name of names) {
    const st = summarize(allocValues(name, w));
    const method = allocs.find((l) => l.variant === name && l.workload === w)?.method || "";
    md += `| alloc:${w} (${method || "?"}) | ${name} | ${fmt(st.median, 1)} | ${fmt(st.min, 1)} | ${fmtRatio(name === "base" ? 1 : st.median / baseMed)} | ${fmtRatio(name === "core" ? 1 : st.median / coreMed)} |\n`;
  }
}

if (errors.length) {
  md += `\n## failures\n\n`;
  for (const e of errors) {
    md += `### ${e.variant} ${e.workload} round ${e.round}\n\n`;
    md += "```\n" + (e.stack || e.error) + "\n```\n\n";
  }
} else {
  md += `\nNo workload failed.\n`;
}

writeFileSync(jsonlPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
writeFileSync(mdPath, md);
console.error(`wrote ${mdPath}`);
console.error(`wrote ${jsonlPath}`);
