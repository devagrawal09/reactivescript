#!/usr/bin/env node
// Builds the map page from its .rx program (app/): compiles app/main.rx with this repository's compiler (Node-API
// `app()`), bundles it with its own copy of Solid 2 and @reactivescript/runtime (esbuild, a dev-only dependency) and
// the CSS into one self-contained HTML page, and writes it as a string in page.mjs, which exports
// `pageHTML(graph, opts)`. page.mjs is generated and committed: the package ships it and has no runtime dependencies.
//
//   node build.mjs            # write page.mjs
//   node build.mjs --check    # fail if page.mjs is not what the sources give
//   node build.mjs --html <graph.json> <out.html> [--live] [--fake <seed>] [--coverage <file>] [--trace <file>]
//
// Where things come from: the compiler's binding (compiler/index.js), esbuild and Solid from ref/node_modules (Solid's
// built dists, pinned below: the packages' own exports would pull Solid's TypeScript sources in), the runtime from
// runtime/dist. `RX_SOLID` overrides the Solid packages dir (a checkout's `packages`).
import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));   // the package
const src = path.join(here, "app");                          // the program
const repo = path.resolve(here, "../..");
const refReq = createRequire(path.join(repo, "ref/package.json"));
const esbuild = refReq("esbuild");
const { app } = createRequire(path.join(repo, "compiler/package.json"))("./index.js");
const solidPkgs = process.env.RX_SOLID ?? path.dirname(realpathSync(path.join(repo, "ref/node_modules/solid-js")));
const PIN = {
  "solid-js": "solid/dist/solid.js",
  "solid-js/internal": "solid/dist/internal.js",
  "@solidjs/web": "web/dist/web.js",
  "@solidjs/signals": "signals/dist/prod/index.js",
};
for (const f of Object.values(PIN)) if (!existsSync(path.join(solidPkgs, f))) throw new Error(`no Solid build at ${path.join(solidPkgs, f)} (set RX_SOLID to a Solid checkout's packages dir)`);

const entry = path.join(src, "main.rx");
const out = JSON.parse(app(entry, "dom", null, true, false));
if (out.diagnostics) {
  for (const d of out.diagnostics) console.error(`${d.file}:${d.range ? `${d.range.start.line}:${d.range.start.column + 1}` : d.line}: ${d.severity ?? "error"} ${d.code} [${d.rule}] ${d.msg}`);
  process.exit(1);
}
if (out.error) { console.error(out.error); process.exit(1); }
const mods = Object.fromEntries(Object.entries(out.modules).map(([p, m]) => [path.resolve(p), m]));

// fake.mjs (the fake host, without its Node-only CLI) and hmr.mjs, as one module the page imports
const fakeSrc = (() => {
  const s = readFileSync(path.join(here, "fake.mjs"), "utf8");
  const cli = s.indexOf("\nfunction isCli()");
  if (cli < 0) throw new Error("fake.mjs: cannot find where its CLI starts (function isCli)");
  return s.slice(0, cli);
})();

const res = await esbuild.build({
  stdin: { contents: readFileSync(path.join(src, "boot.js"), "utf8"), resolveDir: src, sourcefile: "boot.js", loader: "js" },
  bundle: true, write: false, format: "iife", platform: "browser", target: "es2022",
  minify: !process.argv.includes("--no-minify"), legalComments: "none", charset: "utf8",
  // coverage.mjs also exports an unused Node helper; its dynamic imports are tree-shaken with it.
  external: ["node:fs/promises", "node:path", "node:module"],
  alias: { "@reactivescript/runtime": path.join(repo, "runtime/dist/web.js") },
  logLevel: "error",
  plugins: [{
    name: "rx-map",
    setup(b) {
      b.onResolve({ filter: /^(solid-js|solid-js\/internal|@solidjs\/web|@solidjs\/signals)$/ }, a => ({ path: path.join(solidPkgs, PIN[a.path]) }));
      b.onResolve({ filter: /\.rx$/ }, a => ({ path: path.resolve(a.resolveDir, a.path), namespace: "rx" }));
      b.onLoad({ filter: /.*/, namespace: "rx" }, a => {
        const m = mods[a.path];
        if (!m) throw new Error(`${a.path}: not in the compiled program`);
        return { contents: m.code, loader: "js", resolveDir: path.dirname(a.path) };
      });
      b.onResolve({ filter: /^rx-map:fake$/ }, () => ({ path: path.join(here, "fake.mjs"), namespace: "fake" }));
      b.onLoad({ filter: /.*/, namespace: "fake" }, () => ({ contents: fakeSrc, loader: "js", resolveDir: here }));
    },
  }],
});
const js = res.outputFiles[0].text;
const css = readFileSync(path.join(src, "map.css"), "utf8") + Object.values(mods).map(m => m.css ?? "").join("\n");
if (/<\/script/i.test(js)) throw new Error("the bundle contains </script");
if (/<\/style/i.test(css)) throw new Error("the CSS contains </style");

let html = readFileSync(path.join(src, "shell.html"), "utf8").replace("/*__CSS__*/", () => css).replace("/*__JS__*/", () => js);
for (const p of ["/*__GRAPH__*/null", "/*__LIVE__*/false", "/*__FAKE__*/null", "/*__COVERAGE__*/null", "/*__TRACE__*/null", "<!--__TITLE__-->"])
  if (!html.includes(p)) throw new Error(`shell.html lost its ${p} placeholder`);

// what the page was built from: a change to any of these makes page.mjs stale (`--check` fails), so rebuild
const version = p => JSON.parse(readFileSync(p, "utf8")).version;
const inputs = [
  `@reactivescript/compiler ${version(path.join(repo, "compiler/package.json"))} (Node-API binding)`,
  `@reactivescript/runtime ${version(path.join(repo, "runtime/package.json"))} (runtime/dist)`,
  `solid-js ${version(path.join(solidPkgs, "solid/package.json"))}, @solidjs/web ${version(path.join(solidPkgs, "web/package.json"))}, @solidjs/signals ${version(path.join(solidPkgs, "signals/package.json"))} (dists)`,
  `esbuild ${version(refReq.resolve("esbuild/package.json"))}`,
].join("; ");
const page = `// Generated from app/ (main.rx and its modules) by build.mjs (npm run build). Edit the sources, not this file.
// Built with: ${inputs}.
const HTML = ${JSON.stringify(html)};

const esc = s => String(s).replace(/[<&]/g, c => (c === "<" ? "&lt;" : "&amp;"));
const json = data => JSON.stringify(data).replace(/</g, "\\\\u003c");

/**
 * The map page for \`graph\` (from \`buildGraph\`, or \`diffGraphs\` for a diff), one self-contained HTML document.
 * \`live: true\` makes it listen for the messages \`@reactivescript/map/live\` posts (\`source: "rx-map"\`).
 * \`fake: seed\` runs the fake host (\`@reactivescript/map/fake\`) inside the page, with a dev HUD to drive it.
 * \`coverage: CoverageFile\` adds a Coverage layer. The \`?coverage=live\` URL flag instead observes the live stream.
 * \`trace: TraceFile\` runs a read-only replay host instead of connecting to an app.
 */
export function pageHTML(graph, { live = false, fake = null, coverage = null, trace = null } = {}) {
  graph = trace?.graph ?? graph;
  const title = graph.title ?? (graph.modules ?? []).map(m => m.split("/").pop()).join(", ");
  const inserts = {
    "/*__GRAPH__*/null": () => json(graph),
    "/*__LIVE__*/false": () => String(!!live || fake != null || trace != null),
    "/*__FAKE__*/null": () => fake == null ? "null" : String(Number(fake) || 1),
    "/*__COVERAGE__*/null": () => json(coverage),
    "/*__TRACE__*/null": () => json(trace && { rxTrace: trace.rxTrace, test: trace.test, error: trace.error, messages: trace.messages }),
    "<!--__TITLE__-->": () => esc(title),
  };
  // Replace in one pass: text in a recording or graph is never read as a template placeholder.
  return HTML.replace(/\\/\\*__(?:GRAPH|LIVE|FAKE|COVERAGE|TRACE)__\\*\\/(?:null|false)|<!--__TITLE__-->/g, p => inserts[p]());
}
`;
const target = path.join(here, "page.mjs");
const args = process.argv.slice(2);
if (args.includes("--check")) {
  let now = "";
  try { now = readFileSync(target, "utf8"); } catch {}
  if (now !== page) { console.error("page.mjs is stale: run `npm run build` in tooling/rx-map"); process.exit(1); }
  console.log("page.mjs is up to date");
} else {
  writeFileSync(target, page);
  console.log(`page.mjs: ${html.length} chars (${js.length} js, ${css.length} css)`);
}
const h = args.indexOf("--html");
if (h >= 0) {
  const { pageHTML } = await import(`${target}?t=${Date.now()}`);
  const graph = JSON.parse(readFileSync(args[h + 1], "utf8"));
  const f = args.indexOf("--fake");
  const jsonOpt = flag => args.includes(flag) ? JSON.parse(readFileSync(args[args.indexOf(flag) + 1], "utf8")) : null;
  writeFileSync(args[h + 2], pageHTML(graph, {
    live: args.includes("--live"), fake: f >= 0 ? args[f + 1] : null,
    coverage: jsonOpt("--coverage"), trace: jsonOpt("--trace"),
  }));
  console.log(`wrote ${args[h + 2]}`);
}
