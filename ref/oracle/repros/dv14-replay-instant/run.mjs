// DV-14: node repros/dv14-replay-instant/run.mjs      (from ref/oracle)
// Two clicks on a served button before the client has taken over, then hydration. Each click's handler runs an action
// that writes n = n + 1. Live, the two clicks are two tasks and the counter reads 2. Replayed, Solid runs the recorded
// queue in one microtask with no flush between, so both actions read n = 0 and the counter reads 1.
import { harness, wait } from "../_hydrate.mjs";
const h = await harness(new URL(".", import.meta.url).pathname, () => Promise.resolve());
for (const mode of ["hydrate", "render"]) {
  const page = await h.open(mode);
  if (mode === "render") { await page.evaluate(m => window.repro.start(m), mode); await wait(30); }
  await page.click("button"); await page.click("button"); await wait(30);
  const before = await page.evaluate(() => window.repro.text());
  if (mode === "hydrate") { await page.evaluate(m => window.repro.start(m), mode); await wait(60); }
  console.log((mode === "hydrate" ? "clicked twice, then hydrated" : "rendered, then clicked twice").padEnd(30), `before "${before}"`, `· after "${await page.evaluate(() => window.repro.text())}"`, "(expected 2)");
}
await h.close();
