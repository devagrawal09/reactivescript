// Builds an app and runs a test file against it, one fresh page per test.
// Usage: node harness/test.mjs <dir> <tests.mjs> [--json]
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "./build.mjs";
import { launch, runTest, serve } from "./driver.mjs";

export async function runFile(dir, file) {
  const b = await build(dir);
  const tests = (await import(pathToFileURL(path.resolve(file)).href + `?t=${Date.now()}`)).default;
  if (!b.ok) return { build: b, results: tests.map(t => ({ name: t.name, ok: false, error: `build failed (${b.stage})` })) };
  const server = await serve(b.dist); const browser = await launch();
  const results = [];
  try { for (const t of tests) results.push({ name: t.name, ...(await runTest(browser, server.url, t)) }); }
  finally { await browser.close(); server.close(); }
  return { build: b, results };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, file] = process.argv.slice(2);
  const { build: b, results } = await runFile(dir, file);
  if (process.argv.includes("--json")) { console.log(JSON.stringify({ build: b.ok, results })); process.exit(0); }
  if (!b.ok) console.log(`build failed (${b.stage}):\n${b.output}\n`);
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.ok ? "" : `\n    ${r.error}`}`);
  const pass = results.filter(r => r.ok).length;
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
