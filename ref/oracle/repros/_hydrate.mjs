// The hydration repros' harness. Each repro is one app.jsx, compiled by Solid's own compiler (@solidjs/compiler) twice —
// generate "ssr" for the server and "dom" for the browser, both hydratable — served over HTTP to Chromium, where the
// browser half either hydrates the page or renders it on an empty one (the control).
// app.jsx exports App(props): props.ask(key) is the app's async source; props.expose({ name: fn }) hands the runner
// the setters it drives.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { transform } from "@solidjs/compiler";
import { buildSync } from "esbuild";
const { chromium } = createRequire(import.meta.url)("playwright");
export const wait = ms => new Promise(r => setTimeout(r, ms));

export async function harness(dir, serverAsk) {
  const out = `${dir}/.build/`; mkdirSync(out, { recursive: true });
  const src = readFileSync(`${dir}/app.jsx`, "utf8");
  for (const generate of ["ssr", "dom"]) writeFileSync(`${out}app.${generate}.mjs`, transform(src, { filename: "app.jsx", generate, hydratable: true }).code);
  writeFileSync(`${out}client.mjs`, `import { App } from "./app.dom.mjs";
import { hydrate, render } from "@solidjs/web";
import { createComponent, flush } from "solid-js";
const flights = new Map(), asked = [], api = {};
const ask = key => { asked.push(key); if (!flights.has(key)) { let resolve, reject; const p = new Promise((r, j) => { resolve = r; reject = j; }); flights.set(key, { p, resolve, reject }); } return flights.get(key).p; };
window.repro = {
  start(mode) { (mode === "hydrate" ? hydrate : render)(() => createComponent(App, { ask, expose: o => Object.assign(api, o) }), document.getElementById("app")); flush(); },
  call(name, ...a) { api[name](...a); flush(); },
  land(key, v) { const f = flights.get(key); if (!f) return false; f.resolve(v); return true; },
  text: () => [...document.querySelectorAll("#app p")].map(p => p.textContent).join(" | "),
  asked: () => asked.join(","),
};
`);
  const client = buildSync({ entryPoints: [`${out}client.mjs`], bundle: true, write: false, format: "esm", platform: "browser", conditions: ["browser"], tsconfigRaw: "{}", logLevel: "silent" }).outputFiles[0].text;
  const { App } = await import(`${out}app.ssr.mjs`);
  const { renderToStream, generateHydrationScript } = await import("@solidjs/web");
  const { createComponent } = await import("solid-js");
  const http = createServer((req, res) => {
    if (req.url === "/client.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(client); return; }
    res.writeHead(200, { "content-type": "text/html" });
    if (req.url === "/empty") { res.end(`<!doctype html><body><div id="app"></div>`); return; }
    res.write(`<!doctype html><head>${generateHydrationScript()}</head><body><div id="app">`);
    renderToStream(() => createComponent(App, { ask: serverAsk, expose() {} })).pipe({ write: c => res.write(c), end: () => res.end("</div>") });
  });
  await new Promise(r => http.listen(0, r));
  const browser = await chromium.launch();
  const url = `http://127.0.0.1:${http.address().port}`;
  return {
    /** A page from the server ("hydrate") or an empty one ("render"); the browser half loaded, not yet started. */
    async open(mode) { const page = await browser.newPage(); await page.goto(url + (mode === "hydrate" ? "/" : "/empty"), { waitUntil: "commit" }); await wait(100); await page.addScriptTag({ url: "/client.js", type: "module" }); return page; },
    close: async () => { await browser.close(); http.close(); },
  };
}
