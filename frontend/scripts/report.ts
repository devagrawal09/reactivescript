// Fail closed: the exact kept tests must finish once, pass, and not be skipped.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export type Row = {
  file: string;
  name: string;
  status: string;
  error?: string;
};
export const id = (row: Row) =>
  row.file.replaceAll("\\", "/").replace(/^.*\/(tsx|yield|slices|plan|eval|ssr)\//, "$1/") +
  " :: " +
  row.name;
export function checkTests(
  rows: Row[],
  expected: string[],
  summary: string,
): string[] {
  const problems: string[] = [];
  for (const key of expected) {
    const matches = rows.filter((row) => id(row) === key);
    if (matches.length !== 1)
      problems.push(key + ": ran " + matches.length + " times");
  }
  for (const row of rows) {
    if (!expected.includes(id(row))) problems.push("unlisted test: " + id(row));
    if (row.status !== "pass") problems.push(row.status + ": " + id(row));
  }
  const total = summary.match(/ℹ tests (\d+)/);
  if (!total || Number(total[1]) !== rows.length)
    problems.push("missing or incomplete test summary");
  for (const kind of ["fail", "cancelled", "skipped", "todo"]) {
    const match = summary.match(new RegExp("ℹ " + kind + " (\\d+)"));
    if (!match || Number(match[1]) !== 0)
      problems.push("test summary " + kind + " is not zero");
  }
  return problems;
}
export function checkFuzz(run: any, known: number[]): string[] {
  const problems: string[] = [];
  if (
    run.start !== 0 ||
    run.seeds !== 200 ||
    Object.values(run.tally ?? {}).reduce(
      (a: number, b) => a + Number(b),
      0,
    ) !== 200
  )
    problems.push("fixed fuzz run is incomplete");
  for (const finding of run.findings ?? []) {
    if (
      finding.status !== "divergent" ||
      finding.classes?.length !== 1 ||
      finding.classes[0] !== "upstream: interpreter vs compiled"
    )
      problems.push(
        "fuzz seed " +
          finding.seed +
          ": " +
          (finding.classes?.join(", ") ?? finding.status),
      );
    else if (!known.includes(finding.seed))
      problems.push("unlisted upstream fuzz difference: " + finding.seed);
  }
  return problems;
}

/** The gate's plan fuzz run (scripts/plan-fuzz.ts, docs/PLAN-V2.md "Plan fuzz") against baselines/plan-fuzz.json:
 *  the fixed seeds all ran; no leg diverged, no oracle run was invalid and no program was a generator bug; the counts
 *  of agreeing and refused programs are the baseline's; every refusal is a listed diagnostic; and every upstream
 *  (RX-only, probe-classified) difference is a listed seed of a listed class. */
export function checkPlanFuzz(run: any, baseline: any): string[] {
  const problems: string[] = [];
  if (run.start !== baseline.start || run.seeds !== baseline.seeds || run.total !== baseline.seeds)
    problems.push("plan fuzz run is incomplete");
  for (const k of ["divergent", "invalid", "generator-bug"])
    if (run[k] !== 0) problems.push("plan fuzz " + k + ": " + run[k]);
  if (run.agree !== baseline.agree) problems.push("plan fuzz agree " + run.agree + ", baseline " + baseline.agree);
  if (run.refused !== baseline.refused) problems.push("plan fuzz refused " + run.refused + ", baseline " + baseline.refused);
  for (const k of Object.keys(run.refusals ?? {}))
    if (!baseline.refusals.includes(k)) problems.push("unlisted plan fuzz refusal: " + k);
  const upstream = Object.entries(run.classes ?? {}) as [string, { count: number; seeds: number[] }][];
  for (const [k, v] of upstream) {
    if (!baseline.upstream.classes.includes(k)) problems.push("plan fuzz class is not a listed upstream class: " + k);
    for (const seed of v.seeds) if (!baseline.upstream.seeds.includes(seed)) problems.push("unlisted upstream plan fuzz difference: " + seed);
  }
  if (run.upstream !== baseline.upstream.seeds.length) problems.push("plan fuzz upstream " + run.upstream + ", baseline " + baseline.upstream.seeds.length);
  return problems;
}

/** The gate's eval fuzz run (scripts/eval-fuzz.ts, docs/EVAL.md "Eval fuzz") against baselines/eval-fuzz.json: the
 *  fixed seeds all ran; no leg diverged, no static-twin recording was invalid and no program was a generator bug; the
 *  counts of agreeing and refused programs are the baseline's; and every refusal is a listed diagnostic. */
export function checkEvalFuzz(run: any, baseline: any): string[] {
  const problems: string[] = [];
  if (run.start !== baseline.start || run.seeds !== baseline.seeds || run.total !== baseline.seeds)
    problems.push("eval fuzz run is incomplete");
  for (const k of ["divergent", "invalid", "generator-bug"])
    if (run[k] !== 0) problems.push("eval fuzz " + k + ": " + run[k]);
  if (run.agree !== baseline.agree) problems.push("eval fuzz agree " + run.agree + ", baseline " + baseline.agree);
  if (run.refused !== baseline.refused) problems.push("eval fuzz refused " + run.refused + ", baseline " + baseline.refused);
  for (const k of Object.keys(run.refusals ?? {}))
    if (!baseline.refusals.includes(k)) problems.push("unlisted eval fuzz refusal: " + k);
  if (Object.keys(run.classes ?? {}).length) problems.push("eval fuzz classes: " + Object.keys(run.classes).join(", "));
  return problems;
}

/** The gate's SSR fuzz run (scripts/ssr-fuzz.ts, docs/RESULTS.md "Slice 5") against baselines/ssr-fuzz.json: the fixed
 *  seeds all ran with the dev-build hydration too; no HTML differs, no hydration failed, the Rust renderer refused
 *  nothing, no oracle run was invalid and no program was a generator bug; the agreeing and refused counts are the
 *  baseline's; and every refusal is a listed diagnostic. */
export function checkSsrFuzz(run: any, baseline: any): string[] {
  const problems: string[] = [];
  if (run.start !== baseline.start || run.seeds !== baseline.seeds || run.total !== baseline.seeds || run.dev !== true)
    problems.push("ssr fuzz run is incomplete");
  for (const k of ["html", "hydration", "ssr-refused", "invalid", "generator-bug"])
    if (run[k] !== 0) problems.push("ssr fuzz " + k + ": " + run[k]);
  if (run.agree !== baseline.agree) problems.push("ssr fuzz agree " + run.agree + ", baseline " + baseline.agree);
  if (run.refused !== baseline.refused) problems.push("ssr fuzz refused " + run.refused + ", baseline " + baseline.refused);
  for (const k of Object.keys(run.refusals ?? {}))
    if (!baseline.refusals.includes(k)) problems.push("unlisted ssr fuzz refusal: " + k);
  return problems;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const out = resolve(process.argv[process.argv.indexOf("--out") + 1]);
  const subset = process.argv.includes("--subset");
  const canary = process.argv.includes("--canary");
  const rust = process.argv.includes("--rust");
  const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  const pins = json(new URL("../pins.json", import.meta.url).pathname);
  const expected = json(
    new URL("../baselines/subset-tests.json", import.meta.url).pathname,
  );
  const known = json(
    new URL("../baselines/fuzz-upstream.json", import.meta.url).pathname,
  ).seeds;
  const rows: Row[] = readFileSync(out + "/suite.jsonl", "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const problems = checkTests(
    rows,
    expected,
    readFileSync(out + "/suite.spec.txt", "utf8"),
  );
  problems.push(...checkFuzz(json(out + "/fuzz.json"), known));
  problems.push(...checkPlanFuzz(json(out + "/plan-fuzz.json"), json(new URL("../baselines/plan-fuzz.json", import.meta.url).pathname)));
  problems.push(...checkEvalFuzz(json(out + "/eval-fuzz.json"), json(new URL("../baselines/eval-fuzz.json", import.meta.url).pathname)));
  problems.push(...checkSsrFuzz(json(out + "/ssr-fuzz.json"), json(new URL("../baselines/ssr-fuzz.json", import.meta.url).pathname)));
  const exits = new Map(
    readFileSync(out + "/exits.txt", "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const [name, code] = line.split(" ");
        return [name, Number(code)] as const;
      }),
  );
  const required = [
    "pins",
    "rust-solid-build",
    "types",
    "suite",
    "fuzz",
    "plan-fuzz",
    "eval-fuzz",
    "ssr-fuzz",
    ...(!subset
      ? [
          "upstream-test",
          "upstream-oracle",
          "upstream-compiled",
          "upstream-types",
          "upstream-ssr",
        ]
      : []),
    ...(rust ? ["rust-check", "rust-lower", "rust-project", "rust-test"] : []),
  ];
  for (const step of required)
    if (exits.get(step) !== 0)
      problems.push(step + " exit " + (exits.get(step) ?? "missing"));
  const runners: string[] = [];
  if (!subset)
    for (const name of ["test", "oracle", "compiled", "types", "ssr"]) {
      const log = readFileSync(out + "/upstream-" + name + ".log", "utf8");
      const summary =
        name === "test"
          ? (log.match(/^PASS /gm)?.length ?? 0) +
            " pass, " +
            (log.match(/^FAIL /gm)?.length ?? 0) +
            " fail"
          : log.match(/\d+ pass, \d+ fail(?:, \d+ skip)?/g)?.at(-1);
      runners.push(name + ": " + summary);
      if (!summary || (!canary && summary !== pins.upstreamBaseline[name]))
        problems.push("upstream " + name + " summary differs from pin");
    }
  const fuzz = json(out + "/fuzz.json");
  const text = [
    "# " + (subset ? "Frontend subset" : "Full pinned check"),
    "",
    "Result: " + (problems.length ? "FAIL" : "PASS"),
    "Tests: " +
      rows.length +
      ", pass " +
      rows.filter((r) => r.status === "pass").length +
      ", fail " +
      rows.filter((r) => r.status === "fail").length,
    "Fuzz: " + JSON.stringify(fuzz.tally),
    "Plan fuzz: " + (() => { const p = json(out + "/plan-fuzz.json"); return JSON.stringify({ total: p.total, agree: p.agree, upstream: p.upstream, refused: p.refused, divergent: p.divergent, invalid: p.invalid, "generator-bug": p["generator-bug"] }); })(),
    "Eval fuzz: " + (() => { const p = json(out + "/eval-fuzz.json"); return JSON.stringify({ total: p.total, agree: p.agree, refused: p.refused, divergent: p.divergent, invalid: p.invalid, "generator-bug": p["generator-bug"] }); })(),
    "SSR fuzz: " + (() => { const p = json(out + "/ssr-fuzz.json"); return JSON.stringify({ total: p.total, agree: p.agree, refused: p.refused, html: p.html, hydration: p.hydration, "ssr-refused": p["ssr-refused"], invalid: p.invalid, "generator-bug": p["generator-bug"] }); })(),
    ...runners,
    "",
    ...problems.map((p) => "- " + p),
    "",
    "Upstream failures are not waived. S-store-8 is documented in docs/UPSTREAM-ISSUES.md.",
    "",
  ].join("\n");
  writeFileSync(out + "/REPORT.md", text);
  console.log(text);
  process.exitCode = problems.length ? 1 : 0;
}
