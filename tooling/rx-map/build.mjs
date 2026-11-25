#!/usr/bin/env node
// Writes page.mjs: map.html as a string in a module, so the page can be made in Node (the CLI, a Vite plugin) and in
// the browser (./live). map.html is the source; page.mjs is generated and committed.
//
//   node build.mjs           # write page.mjs
//   node build.mjs --check   # fail if page.mjs is not what map.html gives
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const here = new URL(".", import.meta.url);
let html = readFileSync(new URL("map.html", here), "utf8");
for (const p of ["/*__GRAPH__*/null", "/*__LIVE__*/false", "/*__FAKE__*/null", "/*__FAKELIB__*/null", "/*__LAYOUTLIB__*/null", "<!--__TITLE__-->"])
  if (!html.includes(p)) throw new Error(`map.html lost its ${p} placeholder`);

// The fake host (fake.mjs and the planner it uses, hmr.mjs) goes into the page as one closure, so a page can run it
// itself (`?fake=<seed>`, or `pageHTML(graph, { fake })`): imports and exports dropped, the Node-only CLI cut off.
const strip = src => src.replace(/^import\b[^;]*;[ \t]*$/gm, "").replace(/^export (?=(?:async )?function|const|let|class)/gm, "");
const hmrSrc = readFileSync(createRequire(import.meta.url).resolve("@reactivescript/compiler/hmr"), "utf8");
let fakeSrc = readFileSync(new URL("fake.mjs", here), "utf8");
const cli = fakeSrc.indexOf("\nfunction isCli()");
if (cli < 0) throw new Error("fake.mjs: cannot find where its CLI starts (function isCli)");
fakeSrc = fakeSrc.slice(0, cli);
const lib = `(() => {\n// ---- hmr.mjs\n${strip(hmrSrc)}\n// ---- fake.mjs\n${strip(fakeSrc)}\nreturn { createFakeHost, planHmr, preview };\n})()`;
if (/<\/script|<!--|<script/i.test(lib)) throw new Error("fake.mjs / hmr.mjs contain text that would end the page's script");
html = html.replace("/*__FAKELIB__*/null", () => lib);
// The layout (layout.mjs) the same way: the page and the RX map share one module
const layoutSrc = readFileSync(new URL("layout.mjs", here), "utf8");
const layoutLib = `(() => {\n// ---- layout.mjs\n${strip(layoutSrc)}\nreturn { analyze, layoutWorld, planTrunks, channels, orderBands, tokenSize, levelFor, levelThresholds, LEVELS, METRICS, kindOf, CTL, ORDER, SHAPE };\n})()`;
if (/<\/script|<!--|<script/i.test(layoutLib)) throw new Error("layout.mjs contains text that would end the page's script");
html = html.replace("/*__LAYOUTLIB__*/null", () => layoutLib);

const out = `// Generated from map.html by build.mjs (\`npm run build\`). Edit map.html, not this file.
const HTML = ${JSON.stringify(html)};

const esc = s => String(s).replace(/[<&]/g, c => (c === "<" ? "&lt;" : "&amp;"));

/**
 * The map page for \`graph\` (from \`buildGraph\`, or \`diffGraphs\` for a diff), one self-contained HTML document.
 * \`live: true\` makes it listen for the messages \`@reactivescript/map/live\` posts (\`source: "rx-map"\`).
 * \`fake: seed\` runs the fake host (\`@reactivescript/map/fake\`) inside the page, with a dev HUD to drive it.
 */
export function pageHTML(graph, { live = false, fake = null } = {}) {
  const title = graph.title ?? (graph.modules ?? []).map(m => m.split("/").pop()).join(", ");
  return HTML
    .replace("/*__LIVE__*/false", () => String(!!live || fake != null))
    .replace("/*__FAKE__*/null", () => (fake == null ? "null" : String(Number(fake) || 1)))
    .replaceAll("<!--__TITLE__-->", () => esc(title))
    .replace("/*__GRAPH__*/null", () => JSON.stringify(graph).replace(/</g, "\\\\u003c"));
}
`;

const target = new URL("page.mjs", here);
if (process.argv.includes("--check")) {
  let now = "";
  try { now = readFileSync(target, "utf8"); } catch {}
  if (now !== out) { console.error("page.mjs is stale: run `npm run build` in tooling/rx-map"); process.exit(1); }
  console.log("page.mjs is up to date");
} else {
  writeFileSync(target, out);
  console.log(`page.mjs: ${html.length} chars (map.html with the fake host)`);
}
