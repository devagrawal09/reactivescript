// Bundle sizes for the RX apps, plus store-size.mjs on the Solid worktrees.
//   node /home/lucifer/work/solidjs/store-proto-bench/sizes.mjs
// One child at a time. Writes results/sizes-<timestamp>.md
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = "/home/lucifer/work/solidjs";
const apps = ["counter.rx", "rows.rx", "optimistic.rx", "keyed.rx"];
const configs = [
  { name: "base", wt: "rx-store-proto-base", mode: "plain" },
  { name: "core", wt: "rx-store-proto-core", mode: "plain" },
  { name: "features-select", wt: "rx-store-proto-features", mode: "select" },
  { name: "features-manifest", wt: "rx-store-proto-features", mode: "manifest" },
  { name: "writes", wt: "rx-store-proto-writes", mode: "plain" },
  { name: "sitecache", wt: "rx-store-proto-sitecache", mode: "plain" },
  { name: "slots", wt: "rx-store-proto-slots", mode: "plain" },
  { name: "combined-select", wt: "rx-store-proto-combined", mode: "select" },
  { name: "combined-manifest", wt: "rx-store-proto-combined", mode: "manifest" }
];

function runBundle(cfg, app) {
  const res = spawnSync(process.execPath, [
    "--experimental-strip-types",
    resolve(here, "rx-bundle.ts"),
    `${ROOT}/${cfg.wt}`,
    resolve(here, app),
    cfg.mode
  ], { encoding: "utf8" });
  if (res.status !== 0) {
    return { error: (res.stderr || res.stdout || "exit " + res.status).slice(-800) };
  }
  const line = res.stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop();
  if (!line) return { error: "no JSON: " + res.stdout.slice(-400) };
  return JSON.parse(line);
}

const cells = {};
const kept = {};
for (const cfg of configs) {
  for (const app of apps) {
    console.error(`bundle ${cfg.name} ${app}`);
    const row = runBundle(cfg, app);
    cells[app + "|" + cfg.name] = row;
    if (row.kept && cfg.mode === "manifest") kept[app + "|" + cfg.name] = row.kept;
    if (row.error) console.error(row.error);
  }
}

function pct(n, base) {
  if (!Number.isFinite(n) || !Number.isFinite(base) || !base) return "n/a";
  const d = ((n - base) / base) * 100;
  return (d >= 0 ? "+" : "") + d.toFixed(1) + "%";
}

let md = `# RX bundle sizes\n\n`;
md += `gzip bytes, and delta vs base. manifest columns also list kept features below.\n\n`;
md += `| app |` + configs.map((c) => ` ${c.name} |`).join("") + `\n`;
md += `|---|` + configs.map(() => `---:|`).join("") + `\n`;
for (const app of apps) {
  const base = cells[app + "|base"]?.gzip;
  md += `| ${app} |`;
  for (const cfg of configs) {
    const g = cells[app + "|" + cfg.name]?.gzip;
    if (g == null) md += ` ERR |`;
    else if (cfg.name === "base") md += ` ${g} |`;
    else md += ` ${g} (${pct(g, base)}) |`;
  }
  md += `\n`;
}
md += `\n## manifest kept\n\n`;
for (const app of apps) {
  for (const cfg of configs.filter((c) => c.mode === "manifest")) {
    md += `- ${app} ${cfg.name}: ${kept[app + "|" + cfg.name] || cells[app + "|" + cfg.name]?.error || "(none)"}\n`;
  }
}
const failed = Object.entries(cells).filter(([, v]) => v.error);
if (failed.length) {
  md += `\n## bundle errors\n\n`;
  for (const [k, v] of failed) md += `### ${k}\n\n\`\`\`\n${v.error}\n\`\`\`\n\n`;
}

const storeRuns = [
  { name: "base", dir: "store-proto-base" },
  { name: "core", dir: "store-proto-core" },
  { name: "features", dir: "store-proto-features" },
  { name: "writes", dir: "store-proto-writes" },
  { name: "sitecache", dir: "store-proto-sitecache" },
  { name: "slots", dir: "store-proto-slots" },
  { name: "combined", dir: "store-proto-combined" },
  { name: "features-off", dir: "store-proto-features", off: "accessors,guards,shallow,families,delete" },
  { name: "combined-off", dir: "store-proto-combined", off: "accessors,guards,shallow,families,delete" }
];

function parseStoreSize(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = /^(store entry \(createStore \+ reconcile\)|optimistic store entry)\s+(\d+)\s+(\d+)\s+(\d+)/.exec(line);
    if (m) out[m[1].startsWith("store entry") ? "store" : "optimistic"] = { min: Number(m[3]), gzip: Number(m[4]) };
  }
  return out;
}

md += `\n## store-size.mjs (min / gzip)\n\n`;
md += `\`node scripts/store-size.mjs\` in packages/signals. Reads source only. features-off and combined-off set SOLID_STORE_OFF=accessors,guards,shallow,families,delete.\n\n`;
md += `| worktree | store min | store gzip | optimistic min | optimistic gzip |\n`;
md += `|---|---:|---:|---:|---:|\n`;
for (const run of storeRuns) {
  console.error(`store-size ${run.name}`);
  const res = spawnSync(process.execPath, ["scripts/store-size.mjs"], {
    cwd: `${ROOT}/${run.dir}/packages/signals`,
    encoding: "utf8",
    env: { ...process.env, SOLID_STORE_OFF: run.off || "" }
  });
  if (res.status !== 0) {
    md += `| ${run.name} | ERR | | | |\n`;
    md += `\n\`\`\`\n${(res.stderr || res.stdout || "").slice(-600)}\n\`\`\`\n`;
    continue;
  }
  const p = parseStoreSize(res.stdout);
  md += `| ${run.name} | ${p.store?.min ?? "?"} | ${p.store?.gzip ?? "?"} | ${p.optimistic?.min ?? "?"} | ${p.optimistic?.gzip ?? "?"} |\n`;
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = resolve(here, "results", `sizes-${stamp}.md`);
mkdirSync(resolve(here, "results"), { recursive: true });
writeFileSync(out, md);
console.error("wrote " + out);
console.log(out);
