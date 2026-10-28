// Classifies a pinned or canary run against the reviewed baseline. Never edits the baseline: --candidate writes a
// proposal file elsewhere for a human to review and copy. Exit status is non-zero when anything differs from the
// baseline (new failures, newly passing known failures, or upstream summaries that changed).
//
// Usage: node --experimental-strip-types scripts/report.ts --out DIR [--baseline baselines/known-failures.json]
//          [--candidate FILE]   (reads DIR/*.jsonl and DIR/upstream-*.log, writes DIR/REPORT.md)
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";

type Result = { status: string; file?: string; line?: number; column?: number; name: string; nesting: number; error?: string };
type Known = { category: string; reason: string };
const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const out = arg("--out");
if (!out) throw new Error("--out DIR is required");
const baselinePath = arg("--baseline") ?? new URL("../baselines/known-failures.json", import.meta.url).pathname;
const baseline: Record<string, Known> = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")).failures : {};
const pins = JSON.parse(readFileSync(new URL("../pins.json", import.meta.url), "utf8"));

const results: Result[] = readdirSync(out).filter(f => f.endsWith(".jsonl")).flatMap(f =>
  readFileSync(out + "/" + f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as Result));
// Stable identity: file:line:column name, plus an occurrence index for tests generated in a loop at one site.
const seen = new Map<string, number>();
const keyed = results.map(r => {
  const base = (r.file ?? "?") + ":" + (r.line ?? 0) + ":" + (r.column ?? 0) + " " + r.name;
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return { ...r, key: n ? base + " #" + n : base };
});
const UPSTREAM_CODES = ["TOP_LEVEL_MARKUP", "HELD_WRITE", "STALE_OWN_READ", "UNCAUGHT_ACTION_FAILURE", "IO_IN_REACTIVE", "UNHANDLED_FAILURE", "SF-1"];
/** A first-pass category from the failure text; the reviewed baseline records the decided category and reason. */
function category(r: Result): string {
  const e = r.error ?? "";
  if (/SyntaxError|ReferenceError|does not provide an export|ERR_MODULE_NOT_FOUND|is not a function|Cannot find module/.test(e)) return "adapter/type/API breakage";
  if (/^(native|.*\bnative\b.*expect|prove (the )?native|verify the native)/im.test(e) || /^native/.test(r.name)) return "native behavior change";
  if (UPSTREAM_CODES.some(c => e.includes(c))) return "upstream rule/diagnostic";
  return "paired behavior mismatch";
}
const leafFailures = keyed.filter(r => r.status === "fail");
const passing = new Set(keyed.filter(r => r.status === "pass").map(r => r.key));
const fresh = leafFailures.filter(r => !baseline[r.key]);
const known = leafFailures.filter(r => baseline[r.key]);
const fixed = Object.keys(baseline).filter(k => passing.has(k));
const missing = Object.keys(baseline).filter(k => !passing.has(k) && !leafFailures.some(r => r.key === k));

const summaries = readdirSync(out).filter(f => f.startsWith("upstream-") && f.endsWith(".log")).map(f => {
  const text = readFileSync(out + "/" + f, "utf8");
  const name = f.slice("upstream-".length, -".log".length);
  const line = text.split("\n").reverse().find(l => /\d+ pass, \d+ fail/.test(l) || /programs/.test(l)) ?? "(no summary line; see " + f + ")";
  const summary = (line.match(/\d+ pass, \d+ fail(, \d+ skip)?/) ?? [line.trim()])[0];
  const expected = pins.upstreamBaseline?.[name];
  return { name, summary, expected, changed: expected !== undefined && expected !== summary };
});

const count = (s: string) => keyed.filter(r => r.status === s).length;
const byCategory = (rs: Result[]) => rs.reduce<Record<string, number>>((a, r) => ({ ...a, [category(r)]: (a[category(r)] ?? 0) + 1 }), {});
const lines = [
  "# Verification report",
  "",
  "Results: " + keyed.length + " entries, " + count("pass") + " pass, " + count("fail") + " fail, " + count("skip") + " skip, " + count("todo") + " todo",
  "",
  "## Upstream baseline (unmodified upstream runners)",
  ...summaries.map(s => "- " + s.name + ": " + s.summary + (s.expected ? (s.changed ? "  **CHANGED** (pinned: " + s.expected + ")" : "  (matches pin)") : "")),
  "",
  "## New failures (not in the reviewed baseline): " + fresh.length,
  "First-pass categories: " + JSON.stringify(byCategory(fresh)),
  ...fresh.map(r => "- [" + category(r) + "] " + r.key + "\n  " + (r.error ?? "").split("\n")[0].slice(0, 240)),
  "",
  "## Known failures still failing: " + known.length,
  ...Object.entries(known.reduce<Record<string, number>>((a, r) => ({ ...a, [baseline[r.key].category]: (a[baseline[r.key].category] ?? 0) + 1 }), {})).map(([c, n]) => "- " + c + ": " + n),
  "",
  "## Known failures now passing (review and remove from the baseline): " + fixed.length,
  ...fixed.map(k => "- " + k),
  "",
  "## Known failures that did not run: " + missing.length,
  ...missing.map(k => "- " + k),
];
writeFileSync(out + "/REPORT.md", lines.join("\n") + "\n");
console.log(lines.join("\n"));
const candidate = arg("--candidate");
if (candidate) {
  const proposal = Object.fromEntries(leafFailures.map(r => [r.key, baseline[r.key] ?? { category: category(r), reason: "UNREVIEWED: " + (r.error ?? "").split("\n")[0].slice(0, 200) }]));
  writeFileSync(candidate, JSON.stringify({ note: "Candidate only. Review every entry before copying to baselines/known-failures.json.", failures: proposal }, null, 2) + "\n");
  console.log("candidate baseline written to " + candidate + " (not applied)");
}
process.exitCode = fresh.length || fixed.length || missing.length || summaries.some(s => s.changed) ? 1 : 0;
