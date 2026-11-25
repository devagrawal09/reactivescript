#!/usr/bin/env node
// `rx-tsc`: TypeScript's own `tsc`, with `.rx` modules in the program (spec/13 TY-1a), for CI and the command line. It
// is Volar's tsc runner (the one `vue-tsc` uses) with the language server's `.rx` plugin, so the editor and the command
// line check the same projection. It takes tsc's arguments (`rx-tsc --noEmit`, `-p`, `--watch`) and reads the
// tsconfig.json's `include`, which must name the `.rx` files. Type errors are placed on the `.rx`.
//
// The crate's own diagnostics (parse errors, else the checker's, with their rules) are reported after TypeScript's, for
// every `.rx` module in the program: a module that does not parse has no projection, so TypeScript alone would pass it.
// So are the declaration generator's (09 MO-11c, a misplaced helper), in the `.ts` modules those `.rx` import.
const path = require("node:path");
const { runTsc } = require("@volar/typescript/lib/quickstart/runTsc");
const { rxLanguagePlugin, analyses, declarationDiagnostics, guideUrl } = require("../src/index.js");

const tsc = require.resolve("typescript/lib/tsc");

process.on("exit", code => {
  const watching = process.argv.includes("--watch") || process.argv.includes("-w");
  if (watching) return;
  let errors = 0, warnings = 0;
  const codes = new Set();
  for (const { file, result } of analyses()) {
    for (const d of result.diagnostics ?? []) {
      // a warning (09 MO-11e's IMPORT_ROW_DEPRECATED) is printed and never fails the run
      const severity = d.severity === "warning" ? "warning" : "error";
      if (severity === "warning") warnings++; else errors++;
      codes.add(d.code);
      const where = d.range ? `${d.range.start.line}:${d.range.start.column + 1}` : "1:1";
      process.stdout.write(`${path.relative(process.cwd(), file)}:${where} - ${severity} ${d.code}: ${d.message} (${d.rule})\n`);
    }
  }
  // the declarations generated from TS modules (09 MO-11): a misplaced helper is reported in the `.ts`, at the call
  for (const e of declarationDiagnostics()) {
    errors++;
    codes.add(e.code);
    process.stdout.write(`${path.relative(process.cwd(), e.file)}:${e.line}:${e.column + 1} - error ${e.code}: ${e.message} (${e.rule})\n`);
  }
  if (errors || warnings) {
    const count = (n, what) => `${n} ReactiveScript ${what}${n === 1 ? "" : "s"}`;
    process.stdout.write(`\nFound ${[errors && count(errors, "error"), warnings && count(warnings, "warning")].filter(Boolean).join(" and ")}.\n`);
    for (const c of codes) process.stdout.write(`${c}: why, and the fix — ${guideUrl(c)}\n`);
    if (errors && !code) process.exitCode = 1;
  }
});

runTsc(tsc, [".rx"], ts => [rxLanguagePlugin(ts)]);
