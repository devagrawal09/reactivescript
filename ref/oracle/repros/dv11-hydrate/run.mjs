// DV-11: node repros/dv11-hydrate/run.mjs      (from ref/oracle)
// The client takes over while the server's answer to `details` (d:0) is still out. The input changes; the client asks
// d:1 and it lands. Expected (as when the client renders the page itself): "1". Observed after hydrating: the boundary
// stays on its fallback — it waits for the server's fragment for the old question, which is not coming.
import { harness, wait } from "../_hydrate.mjs";
const h = await harness(new URL(".", import.meta.url).pathname, () => new Promise(() => {}));   // the server's answer never arrives
for (const mode of ["hydrate", "render"]) {
  const page = await h.open(mode);
  await page.evaluate(m => window.repro.start(m), mode); await wait(30);
  const before = await page.evaluate(() => window.repro.text());
  await page.evaluate(() => window.repro.call("setId", 1)); await wait(30);
  const asked = await page.evaluate(() => window.repro.land("d:1", 1)); await wait(60);
  console.log(mode.padEnd(8), `shows "${before}"`, `· d:1 asked: ${asked}`, `· after it lands: "${await page.evaluate(() => window.repro.text())}"`, `(expected "1")`);
}
await h.close();
