// DV-12: node repros/dv12-hydrate/run.mjs      (from ref/oracle)
// A boundary the server rendered in its error state; the client hydrates it, then the input changes and the new answer
// lands. Expected (as when the client renders the same page itself): "pear". Observed after hydrating: the failure stays —
// the boundary was hydrated by throwing the server's error, so it tracks nothing and never runs its content again.
import { harness, wait } from "../_hydrate.mjs";
const h = await harness(new URL(".", import.meta.url).pathname, () => Promise.resolve(null));
for (const mode of ["hydrate", "render"]) {
  const page = await h.open(mode);
  await page.evaluate(m => window.repro.start(m), mode); await wait(30);
  if (mode === "render") { await page.evaluate(() => window.repro.land("i:4", null)); await wait(30); }
  const before = await page.evaluate(() => window.repro.text());
  await page.evaluate(() => window.repro.call("setSel", 3)); await wait(30);
  const asked = await page.evaluate(() => window.repro.land("i:3", "pear")); await wait(60);
  console.log(mode.padEnd(8), `shows "${before}"`, `· i:3 asked: ${asked}`, `· after it lands: "${await page.evaluate(() => window.repro.text())}"`, `(expected "pear")`);
}
await h.close();
