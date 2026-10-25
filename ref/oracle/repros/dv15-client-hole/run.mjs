// DV-15: node repros/dv15-client-hole/run.mjs      (from ref/oracle)
// A client question (a memo with ssrSource "client") read under <Loading>: the server sends the fallback and marks the
// boundary "$$f" ("the client hydrates the fallback DOM and renders the content itself"). Hydrating, the client drops the
// server's <p>measuring</p> and builds its own — the same text, a new element (focus, selection, a running animation in a
// fallback are lost). Expected: the served fallback is adopted and stays until the content can show.
import { harness, wait } from "../_hydrate.mjs";
const h = await harness(new URL(".", import.meta.url).pathname, () => new Promise(() => {}));
const page = await h.open("hydrate");
const before = await page.evaluate(() => { window.__els = [...document.querySelectorAll("#app *")]; return document.getElementById("app").textContent; });
await page.evaluate(m => window.repro.start(m), "hydrate"); await wait(60);
const after = await page.evaluate(() => ({ text: document.getElementById("app").textContent, dropped: window.__els.filter(n => !n.isConnected).map(n => n.outerHTML), built: [...document.querySelectorAll("#app *")].filter(n => !window.__els.includes(n)).map(n => n.outerHTML) }));
console.log(`served "${before}" · hydrated "${after.text}" · dropped ${JSON.stringify(after.dropped)} · built ${JSON.stringify(after.built)} · asked: ${await page.evaluate(() => window.repro.asked())}`);
await h.close();
