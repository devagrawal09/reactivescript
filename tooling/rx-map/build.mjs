#!/usr/bin/env node
// Writes page.mjs: map.html as a string in a module, so the page can be made in Node (the CLI, a Vite plugin) and in
// the browser (./live). map.html is the source; page.mjs is generated and committed.
//
//   node build.mjs           # write page.mjs
//   node build.mjs --check   # fail if page.mjs is not what map.html gives
import { readFileSync, writeFileSync } from "node:fs";

const here = new URL(".", import.meta.url);
const html = readFileSync(new URL("map.html", here), "utf8");
for (const p of ["/*__GRAPH__*/null", "/*__LIVE__*/false", "<!--__TITLE__-->"])
  if (!html.includes(p)) throw new Error(`map.html lost its ${p} placeholder`);

const out = `// Generated from map.html by build.mjs (\`npm run build\`). Edit map.html, not this file.
const HTML = ${JSON.stringify(html)};

const esc = s => String(s).replace(/[<&]/g, c => (c === "<" ? "&lt;" : "&amp;"));

/**
 * The map page for \`graph\` (from \`buildGraph\`, or \`diffGraphs\` for a diff), one self-contained HTML document.
 * \`live: true\` makes it listen for the messages \`@reactivescript/map/live\` posts (\`source: "rx-map"\`).
 */
export function pageHTML(graph, { live = false } = {}) {
  const title = graph.title ?? (graph.modules ?? []).map(m => m.split("/").pop()).join(", ");
  return HTML
    .replace("/*__LIVE__*/false", () => String(!!live))
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
  console.log(`page.mjs: ${html.length} chars of map.html`);
}
