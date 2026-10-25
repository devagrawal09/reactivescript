// SV-7d: node repros/sv7d-table/run.mjs      (from ref/oracle)
// Why a <tr> from another template must be applied in a <tbody>: served, `<table><tr>…` is parsed with a <tbody> the
// client never builds; hydrated, the page keeps the server's tree, and a row added later goes where the client's tree
// says — compared with the same app rendered by the client alone.
import { harness, wait } from "../_hydrate.mjs";
const h = await harness(new URL(".", import.meta.url).pathname, () => Promise.resolve());
for (const mode of ["hydrate", "render"]) {
  const page = await h.open(mode);
  await page.evaluate(m => window.repro.start(m), mode); await wait(30);
  await page.evaluate(() => window.repro.call("add", "Cy")); await wait(30);
  console.log(mode.padEnd(8), await page.evaluate(() => document.querySelector("#app table").outerHTML.replace(/ _hk="[^"]*"/g, "").replace(/<!--[^>]*-->/g, "")));
}
await h.close();
