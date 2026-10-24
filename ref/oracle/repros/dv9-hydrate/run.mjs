// DV-9 after hydration: node repros/dv9-hydrate/run.mjs      (from ref/oracle)
// The server's read fails after the shell (a safe error, so the client may see it); the stream sends an empty fragment
// (DV-9) and the error. Then the client hydrates. Expected: "failed: no user", the server's answer used, not asked again.
import { markSafeError } from "@solidjs/web";
import { harness, wait } from "../_hydrate.mjs";
let reject;
const h = await harness(new URL(".", import.meta.url).pathname, () => new Promise((_, j) => { reject = j; }));
const page = await h.open("hydrate");
const show = async label => console.log(label.padEnd(26), JSON.stringify(await page.evaluate(() => window.repro.text())));
await show("shell");
reject(markSafeError(new Error("no user"))); await wait(100);
await show("the read fails (streamed)");
await page.evaluate(() => window.repro.start("hydrate")); await wait(100);
await show("hydrated");
console.log("asked on the client:".padEnd(26), JSON.stringify(await page.evaluate(() => window.repro.asked())), "(one is the trace Solid runs under a mocked fetch; expected: the server's error, no new question)");
await h.close();
