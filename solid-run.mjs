// Solid store microbench driver. One command:
//   node /home/lucifer/work/solidjs/store-proto-bench/solid-run.mjs
//   node solid-run.mjs --variants=base-proxy,core-target
//   node solid-run.mjs --noise
//
// Rotates the selected variant list each round. Children pinned with taskset -c 2.
// Writes results/solid-<timestamp>.{jsonl,md}
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fmt, fmtRatio, jsonLines, parseArgs, runChild, summarize, waitForFiles } from "./sample.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = "/home/lucifer/work/solidjs";
const args = parseArgs(process.argv);
const noise = args.noise === true;
const rounds = Number(args.rounds || process.env.ROUNDS || (noise ? 3 : 9));
const memRuns = noise ? 0 : Number(args["mem-runs"] || 3);
const only = args.only ? String(args.only) : "";

const CATALOG = {
  "base-proxy": { name: "base-proxy", dir: "store-proto-base", mode: "proxy" },
  "core-proxy": { name: "core-proxy", dir: "store-proto-core", mode: "proxy" },
  "core-target": { name: "core-target", dir: "store-proto-core", mode: "target" },
  "plain-default": { name: "plain-default", dir: "store-proto-plain", mode: "proxy" },
  "plain-data": { name: "plain-data", dir: "store-proto-plain", mode: "plainData" },
  "both-target": { name: "both-target", dir: "store-proto-both", mode: "targetPlain" },
  "features-pruned": { name: "features-pruned", dir: "store-proto-features", mode: "targetPruned", pruned: true, bundle: "features-pruned" },
  "writes-target": { name: "writes-target", dir: "store-proto-writes", mode: "targetWrite" },
  "sitecache-target": { name: "sitecache-target", dir: "store-proto-sitecache", mode: "targetSite" },
  "slots-target": { name: "slots-target", dir: "store-proto-slots", mode: "targetShape" },
  // controls for the bundling confound: the same esbuild single-file bundle, nothing pruned
  "base-proxy-bundled": { name: "base-proxy-bundled", dir: "store-proto-base", mode: "proxy", pruned: true, bundle: "base-bundled", from: "prod", on: true },
  "core-target-bundled": { name: "core-target-bundled", dir: "store-proto-core", mode: "target", pruned: true, bundle: "core-bundled", from: "prod", on: true },
  "features-on-bundled": { name: "features-on-bundled", dir: "store-proto-features", mode: "target", pruned: true, bundle: "features-on", on: true },
  "combined-on-bundled": { name: "combined-on-bundled", dir: "store-proto-combined", mode: "targetAll", pruned: true, bundle: "combined-on", on: true },
  "combined-all": { name: "combined-all", dir: "store-proto-combined", mode: "targetAll", pruned: true, bundle: "combined-all" }
};
const DEFAULT = ["base-proxy", "core-proxy", "core-target", "features-pruned", "writes-target", "sitecache-target", "slots-target", "combined-all"];
const NOISE = [
  { name: "base-a", dir: "store-proto-base", mode: "proxy" },
  { name: "base-b", dir: "store-proto-base", mode: "proxy" }
];

function pick() {
  if (noise) return NOISE;
  const spec = args.variants || process.env.VARIANTS;
  const names = spec ? String(spec).split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT;
  return names.map((n) => {
    const v = CATALOG[n];
    if (!v) throw new Error("unknown variant " + n + " (have " + Object.keys(CATALOG).join(", ") + ")");
    return v;
  });
}
const VARIANTS = pick();
const BASE = "base-proxy";
const VS = "core-target";

const WORKLOADS = [
  "read-tracked", "read-untracked", "read-deep", "create-rows", "mount-rows-10k",
  "write-leaf", "write-leaf-x100", "write-10pct", "push-row", "swap-rows"
];
const MEM_METRICS = ["heap10k", "heap100k"];

const need = [];
for (const v of VARIANTS) {
  if (v.pruned) need.push(`${ROOT}/${v.dir}/packages/signals/dist/${v.from ?? "select"}/index.js`);
  else need.push(`${ROOT}/${v.dir}/packages/signals/dist/prod/index.js`);
  need.push(`${ROOT}/${v.dir}/packages/universal/dist/universal.js`);
}
await waitForFiles(need);

const PRUNE = {
  __SOLID_STORE_ACCESSORS__: "false",
  __SOLID_STORE_GUARDS__: "false",
  __SOLID_STORE_SHALLOW__: "false",
  __SOLID_STORE_FAMILIES__: "false",
  __SOLID_STORE_OPTIMISTIC__: "false",
  __SOLID_STORE_DELETE__: "false"
};
const buildsDir = resolve(here, "builds");
mkdirSync(buildsDir, { recursive: true });
const esbuild = createRequire("/home/lucifer/work/solidjs/rx-store-proto-base/ref/package.json")("esbuild");
for (const v of VARIANTS.filter((x) => x.pruned)) {
  const outfile = resolve(buildsDir, v.bundle + ".mjs");
  esbuild.buildSync({
    entryPoints: [`${ROOT}/${v.dir}/packages/signals/dist/${v.from ?? "select"}/index.js`],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    define: v.on ? Object.fromEntries(Object.keys(PRUNE).map((k) => [k, "true"])) : PRUNE,
    logLevel: "warning"
  });
  console.error("bundled " + outfile);
}

function signalsOf(v) {
  if (v.pruned) return resolve(buildsDir, v.bundle + ".mjs");
  return `${ROOT}/${v.dir}/packages/signals/dist/prod/index.js`;
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const tag = noise ? "solid-noise" : "solid";
const resultsDir = resolve(here, "results");
mkdirSync(resultsDir, { recursive: true });
const jsonlPath = resolve(resultsDir, `${tag}-${stamp}.jsonl`);
const mdPath = resolve(resultsDir, `${tag}-${stamp}.md`);
const lines = [];
function record(obj) {
  lines.push(obj);
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function runVariant(v, kind, round) {
  const script = resolve(here, "solid-bench.mjs");
  const argv = ["--variant", v.name, "--signals", signalsOf(v), "--mode", v.mode];
  if (kind === "mem") argv.push("--mem");
  if (only) argv.push("--only", only);
  const flags = kind === "mem" ? ["--expose-gc"] : [];
  const t0 = Date.now();
  console.error(`solid ${kind} round ${round + 1} ${v.name} ...`);
  const res = await runChild(flags, [script, ...argv]);
  console.error(`solid ${kind} round ${round + 1} ${v.name} exit=${res.code} ${Date.now() - t0}ms`);
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
const wall = Date.now() - wall0;

const times = lines.filter((l) => l.kind === "time");
const errors = lines.filter((l) => l.kind === "error");
const mems = lines.filter((l) => l.kind === "mem");
const names = VARIANTS.map((v) => v.name);
const workloads = only ? WORKLOADS.filter((w) => only.split(",").includes(w)) : WORKLOADS;

function samplesOf(variant, workload) {
  return times.filter((l) => l.variant === variant && l.workload === workload).flatMap((l) => l.samples || []);
}

let md = "";
md += noise ? `# Solid store bench — noise floor\n\n` : `# Solid store bench\n\n`;
md += `Command: \`node ${resolve(here, "solid-run.mjs")}${noise ? " --noise" : ""}\`\n\n`;
md += `Variants: ${names.join(", ")}.\n\n`;
md += `Rounds: ${rounds}. Mem runs: ${memRuns}. Wall: ${(wall / 1000).toFixed(1)}s. Node ${process.version}.\n\n`;
md += `Warmup stops at 30 ops or 300 ms, whichever first. A sample is a batch aimed at >= 20 ms. `;
md += `create-rows and mount-rows-10k dispose outside the timer. push-row resets every 200 ops, outside the timer. `;
md += `write-leaf-x100 is 100 single-leaf writes then one flush. `;
md += `Ratios are median / ${BASE} and median / ${VS}.\n\n`;
md += `features-pruned and combined-all load an esbuild bundle of dist/select/index.js with every store feature define false, rebuilt each run into builds/.\n\n`;
if (noise) {
  md += `base-a and base-b are the same base build, same proxy code, separate processes. `;
  md += `The ratio is the noise floor: how far two identical runs drift.\n\n`;
}
md += `Order rotates each round. Children pinned with taskset -c 2.\n\n`;

const left = noise ? "base-a" : BASE;
const right = noise ? null : VS;
md += `## timing (µs/op)\n\n`;
md += `| workload | variant | median | min | IQR | vs ${left} |${right ? ` vs ${right} |` : ""} n |\n`;
md += `|---|---|---:|---:|---:|---:|${right ? "---:|" : ""}---:|\n`;
for (const w of workloads) {
  const leftMed = summarize(samplesOf(left, w)).median;
  const rightMed = right ? summarize(samplesOf(right, w)).median : NaN;
  for (const name of names) {
    const st = summarize(samplesOf(name, w));
    const r1 = name === left ? 1 : st.median / leftMed;
    const r2 = right ? (name === right ? 1 : st.median / rightMed) : null;
    md += `| ${w} | ${name} | ${fmt(st.median)} | ${fmt(st.min)} | ${fmt(st.iqr)} | ${fmtRatio(r1)} |${r2 == null ? "" : ` ${fmtRatio(r2)} |`} ${st.n} |\n`;
  }
}

md += `\n## checksum\n\n`;
let anyMismatch = false;
for (const w of workloads) {
  const by = new Map();
  for (const name of names) {
    const rows = times.filter((l) => l.variant === name && l.workload === w);
    const sums = [...new Set(rows.map((l) => l.checksum).filter(Boolean))];
    by.set(name, { sums, raw: rows[0]?.checksumRaw || "" });
  }
  const uniq = [...new Set([...by.values()].flatMap((x) => x.sums))];
  const missing = names.filter((n) => !by.get(n).sums.length);
  if (missing.length || uniq.length !== 1) {
    anyMismatch = true;
    md += `**MISMATCH ${w}**\n\n`;
    for (const name of names) {
      const x = by.get(name);
      md += `- ${name}: ${x.sums.length ? x.sums.join(", ") : "(none)"} raw=\`${x.raw}\`\n`;
    }
    md += `\n`;
  } else {
    md += `- ${w}: agree ${uniq[0]}\n`;
  }
}
if (!anyMismatch) md += `\nAll workloads agreed across ${names.join(", ")}.\n`;

if (!noise) {
  md += `\n## memory (bytes, median of ${memRuns})\n\n`;
  md += `heapUsed after two global.gc() calls, minus heapUsed before create-rows. The graph is kept alive across the second gc, then disposed. bytes/row = delta / rows. targetSite and targetAll sites are allocated inside the row function, so they are in the delta.\n\n`;
  md += `| metric | variant | median | min | bytes/row | vs ${BASE} | vs ${VS} |\n`;
  md += `|---|---|---:|---:|---:|---:|---:|\n`;
  for (const metric of MEM_METRICS) {
    const rowsN = metric === "heap100k" ? 100000 : 10000;
    const baseMed = summarize(mems.filter((l) => l.variant === BASE && l.metric === metric).map((l) => l.value)).median;
    const coreMed = summarize(mems.filter((l) => l.variant === VS && l.metric === metric).map((l) => l.value)).median;
    for (const name of names) {
      const vals = mems.filter((l) => l.variant === name && l.metric === metric).map((l) => l.value);
      const st = summarize(vals);
      md += `| ${metric} | ${name} | ${fmt(st.median, 0)} | ${fmt(st.min, 0)} | ${fmt(st.median / rowsN, 1)} | ${fmtRatio(name === BASE ? 1 : st.median / baseMed)} | ${fmtRatio(name === VS ? 1 : st.median / coreMed)} |\n`;
    }
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
