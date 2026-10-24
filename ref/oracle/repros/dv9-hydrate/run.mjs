// DV-9 after hydration: node repros/dv9-hydrate/run.mjs      (from ref/oracle; needs playwright and esbuild)
// The server's read fails after the shell (a safe error, so the client may see it); the stream sends an empty fragment
// (DV-9) and the error. Then the client hydrates. Expected: "failed: no user", with the server's answer used, not asked again.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";
import { generateHydrationScript } from "@solidjs/web";
import { render, markSafeError } from "./app-server.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const here = new URL(".", import.meta.url).pathname;
const client = buildSync({ entryPoints: [here + "app-client.mjs"], bundle: true, write: false, format: "esm", platform: "browser", conditions: ["browser"] }).outputFiles[0].text;
const wait = ms => new Promise(r => setTimeout(r, ms));
let reject;
const http = createServer((req, res) => {
  if (req.url === "/client.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(client); return; }
  res.writeHead(200, { "content-type": "text/html" });
  res.write(`<!doctype html><head>${generateHydrationScript()}</head><body><div id="app">`);
  render(() => new Promise((_, j) => { reject = j; }), c => res.write(c), () => res.end("</div>"));
});
await new Promise(r => http.listen(0, r));
const browser = await chromium.launch(); const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${http.address().port}/`, { waitUntil: "commit" }); await wait(100);
const show = async label => console.log(label.padEnd(26), JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("#app p")].map(p => p.textContent).join(" | "))));
await show("shell");
reject(markSafeError(new Error("no user"))); await wait(100);
await show("the read fails (streamed)");
await page.addScriptTag({ url: "/client.js", type: "module" });
await page.evaluate(() => window.repro.start()); await wait(100);
await show("hydrated");
console.log("asked on the client:".padEnd(26), JSON.stringify(await page.evaluate(() => window.repro.asked())), "(the trace under subFetch also asks; expected: the server's error, no new question)");
await browser.close(); http.close();
