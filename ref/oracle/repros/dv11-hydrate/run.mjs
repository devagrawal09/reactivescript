// DV-11: node repros/dv11-hydrate/run.mjs      (from ref/oracle; needs playwright and esbuild)
// The client takes over while the server's answer to `details` (d:0) is still out. The input changes; the client asks
// d:1 and it lands. Expected (as when the client renders the page itself): "1". Observed after hydrating: the boundary
// stays on its fallback — it waits for the server's fragment for the old question, which is not coming.
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
  render(() => new Promise(() => {}), c => res.write(c), () => res.end("</div>"));   // the server's answer never arrives
});
await new Promise(r => http.listen(0, r));
const browser = await chromium.launch();
for (const [mode, path] of [["hydrate", "/"], ["render", "/empty"]]) {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${http.address().port}${path}`, { waitUntil: "commit" }); await wait(100);
  await page.addScriptTag({ url: "/client.js", type: "module" });
  await page.evaluate(m => window.repro.start(m), mode); await wait(30);
  const before = await page.evaluate(() => window.repro.text());
  await page.evaluate(() => window.repro.setId(1)); await wait(30);
  const asked = await page.evaluate(() => window.repro.land("d:1", 1)); await wait(60);
  console.log(mode.padEnd(8), `shows "${before}"`, `· d:1 asked: ${asked}`, `· after it lands: "${await page.evaluate(() => window.repro.text())}"`, `(expected "1")`);
  await page.close();
}
await browser.close(); http.close();
