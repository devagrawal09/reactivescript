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

/** The gate's plan v2.1 fuzz runs (scripts/plan-fuzz.ts --async and scripts/eval-fuzz.ts --async; PLAN-V2.md "Plan fuzz
 *  v2.1", docs/EVAL.md "Async data") against baselines/plan-fuzz-async.json and baselines/eval-fuzz-async.json: the
 *  fixed seeds all ran as v2.1; no leg diverged, no oracle run was invalid and no program was a generator bug; the
 *  agreeing, rust-unsupported and refused counts are the baseline's (a Rust consumer of v2.1 turns rust-unsupported
 *  programs into agreeing or divergent ones, and the baseline is updated with it); every refusal is a listed
 *  diagnostic; and every class is a listed one. */
export function checkAsyncFuzz(what: string, run: any, baseline: any): string[] {
  const problems: string[] = [];
  if (run.schema !== "2.1" || run.start !== baseline.start || run.seeds !== baseline.seeds || run.total !== baseline.seeds)
    problems.push(what + " run is incomplete");
  for (const k of ["divergent", "invalid", "generator-bug"])
    if (run[k] !== 0) problems.push(what + " " + k + ": " + run[k]);
  for (const k of ["agree", "rust-unsupported", "refused"])
    if (run[k] !== baseline[k]) problems.push(what + " " + k + " " + run[k] + ", baseline " + baseline[k]);
  if ((run.upstream ?? 0) !== 0) problems.push(what + " upstream: " + run.upstream);
  for (const k of Object.keys(run.refusals ?? {}))
    if (!baseline.refusals.includes(k)) problems.push("unlisted " + what + " refusal: " + k);
  for (const k of Object.keys(run.classes ?? {}))
    if (!baseline.classes.includes(k)) problems.push(what + " class is not listed: " + k);
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

/** The gate's SSR fuzz v2.1 run (scripts/ssr-fuzz.ts --async, docs/RESULTS.md "Slice 5: async data") against
 *  baselines/ssr-fuzz-async.json: the fixed seeds all ran as v2.1 with the dev-build hydration too; no stream or HTML
 *  differs, no hydration failed, the Rust renderer refused nothing, no oracle run was invalid and no program was a
 *  generator bug; the agreeing and refused counts are the baseline's; and every refusal is a listed diagnostic. */
export function checkSsrFuzzAsync(run: any, baseline: any): string[] {
  const problems: string[] = [];
  if (run.schema !== "2.1" || run.start !== baseline.start || run.seeds !== baseline.seeds || run.total !== baseline.seeds || run.dev !== true)
    problems.push("ssr fuzz v2.1 run is incomplete");
  for (const k of ["stream", "html", "hydration", "ssr-refused", "invalid", "generator-bug"])
    if (run[k] !== 0) problems.push("ssr fuzz v2.1 " + k + ": " + run[k]);
  if (run.agree !== baseline.agree) problems.push("ssr fuzz v2.1 agree " + run.agree + ", baseline " + baseline.agree);
  if (run.refused !== baseline.refused) problems.push("ssr fuzz v2.1 refused " + run.refused + ", baseline " + baseline.refused);
  for (const k of Object.keys(run.refusals ?? {}))
    if (!baseline.refusals.includes(k)) problems.push("unlisted ssr fuzz v2.1 refusal: " + k);
  return problems;
}

/** The gate's placement fuzz run (scripts/frames-fuzz.ts, docs/RESULTS.md "Slice 6", "Placement fuzz") against
 *  baselines/frames-fuzz.json: the fixed seeds all ran with the Rust leg; no T run was invalid and no program was a
 *  generator bug; the agreeing, client-only and refused counts are the baseline's; every refusal is a listed code; and
 *  the divergent seeds are exactly the baseline's listed ones (each a suspected Solid issue with its own repro), with
 *  listed classes. */
export function checkFramesFuzz(run: any, baseline: any): string[] {
  const problems: string[] = [];
  if (run.start !== baseline.start || run.seeds !== baseline.seeds || run.total !== baseline.seeds || run.rust !== true)
    problems.push("placement fuzz run is incomplete");
  for (const k of ["invalid", "generator-bug"])
    if (run[k] !== 0) problems.push("placement fuzz " + k + ": " + run[k]);
  for (const k of ["agree", "client-only", "refused"])
    if (run[k] !== baseline[k]) problems.push("placement fuzz " + k + " " + run[k] + ", baseline " + baseline[k]);
  for (const k of Object.keys(run.refusals ?? {}))
    if (!baseline.refusals.includes(k)) problems.push("unlisted placement fuzz refusal: " + k);
  const known = Object.keys(baseline.divergent ?? {}).map(Number);
  for (const seed of run.divergentSeeds ?? []) if (!known.includes(seed)) problems.push("unlisted placement fuzz divergence: seed " + seed);
  for (const seed of known) if (!(run.divergentSeeds ?? []).includes(seed)) problems.push("listed placement fuzz divergence did not reproduce: seed " + seed);
  const classes = Object.values(baseline.divergent ?? {}).flatMap((d: any) => d.classes);
  for (const k of Object.keys(run.classes ?? {}))
    if (!classes.includes(k)) problems.push("placement fuzz class is not listed: " + k);
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
  problems.push(...checkSsrFuzzAsync(json(out + "/ssr-fuzz-async.json"), json(new URL("../baselines/ssr-fuzz-async.json", import.meta.url).pathname)));
  problems.push(...checkFramesFuzz(json(out + "/frames-fuzz.json"), json(new URL("../baselines/frames-fuzz.json", import.meta.url).pathname)));
  problems.push(...checkAsyncFuzz("plan fuzz v2.1", json(out + "/plan-fuzz-async.json"), json(new URL("../baselines/plan-fuzz-async.json", import.meta.url).pathname)));
  problems.push(...checkAsyncFuzz("eval fuzz v2.1", json(out + "/eval-fuzz-async.json"), json(new URL("../baselines/eval-fuzz-async.json", import.meta.url).pathname)));
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
    "ssr-fuzz-async",
    "plan-fuzz-async",
    "eval-fuzz-async",
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
    "SSR fuzz v2.1: " + (() => { const p = json(out + "/ssr-fuzz-async.json"); return JSON.stringify({ total: p.total, agree: p.agree, refused: p.refused, stream: p.stream, html: p.html, hydration: p.hydration, "ssr-refused": p["ssr-refused"], invalid: p.invalid, "generator-bug": p["generator-bug"] }); })(),
    "Plan fuzz v2.1: " + (() => { const p = json(out + "/plan-fuzz-async.json"); return JSON.stringify({ total: p.total, agree: p.agree, "rust-unsupported": p["rust-unsupported"], refused: p.refused, divergent: p.divergent, invalid: p.invalid, "generator-bug": p["generator-bug"] }); })(),
    "Eval fuzz v2.1: " + (() => { const p = json(out + "/eval-fuzz-async.json"); return JSON.stringify({ total: p.total, agree: p.agree, "rust-unsupported": p["rust-unsupported"], refused: p.refused, divergent: p.divergent, invalid: p.invalid, "generator-bug": p["generator-bug"] }); })(),
    "Placement fuzz: " + (() => { const p = json(out + "/frames-fuzz.json"); return JSON.stringify({ total: p.total, agree: p.agree, "client-only": p["client-only"], refused: p.refused, divergent: p.divergent, divergentSeeds: p.divergentSeeds, invalid: p.invalid, "generator-bug": p["generator-bug"], rustEqual: p.rustEqual }); })(),
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
