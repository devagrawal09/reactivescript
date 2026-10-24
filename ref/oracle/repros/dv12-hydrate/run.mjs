// DV-12: node repros/dv12-hydrate/run.mjs      (from ref/oracle; needs playwright and esbuild)
// A boundary the server rendered in its error state; the client hydrates it, then the input changes and the new answer
// lands. Expected (as when the client renders the same page itself): "pear". Observed after hydrating: the failure stays —
// the boundary was hydrated by throwing the server's error, so it tracks nothing and never runs its content again.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";
import { generateHydrationScript } from "@solidjs/web";
import { render } from "./app-server.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const here = new URL(".", import.meta.url).pathname;
const client = buildSync({ entryPoints: [here + "app-client.mjs"], bundle: true, write: false, format: "esm", platform: "browser", conditions: ["browser"] }).outputFiles[0].text;
const wait = ms => new Promise(r => setTimeout(r, ms));
const http = createServer((req, res) => {
  if (req.url === "/client.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(client); return; }
  res.writeHead(200, { "content-type": "text/html" });
  if (req.url === "/empty") { res.end(`<!doctype html><body><div id="app"></div>`); return; }
  res.write(`<!doctype html><head>${generateHydrationScript()}</head><body><div id="app">`);
  render(() => Promise.resolve(null), c => res.write(c), () => res.end("</div>"));
});
await new Promise(r => http.listen(0, r));
const browser = await chromium.launch();
for (const [mode, path] of [["hydrate", "/"], ["render", "/empty"]]) {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${http.address().port}${path}`); await wait(50);
  await page.addScriptTag({ url: "/client.js", type: "module" });
  await page.evaluate(m => window.repro.start(m), mode); await wait(30);
  if (mode === "render") { await page.evaluate(() => window.repro.land("i:4", null)); await wait(30); }
  const before = await page.evaluate(() => window.repro.text());
  await page.evaluate(() => window.repro.setSel(3)); await wait(30);
  const asked = await page.evaluate(() => window.repro.land("i:3", "pear")); await wait(60);
  console.log(mode.padEnd(8), `shows "${before}"`, `· i:3 asked: ${asked}`, `· after it lands: "${await page.evaluate(() => window.repro.text())}"`, `(expected "pear")`);
  await page.close();
}
await browser.close(); http.close();
