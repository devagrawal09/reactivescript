// Exploratory probes (round 3 candidates), NOT pre-registered: overlapping saves.
import { saving } from "../tasks/settings/fixtures.mjs";

const key = async (app, name) => { const k = (await app.pending()).find(k => k.startsWith("saveSettings:") && k.includes(`"name":"${name}"`)); if (!k) throw new Error(`no save of ${name} in flight: ${JSON.stringify(await app.pending())}`); return k; };

export default [
  { name: "an earlier save failing after a later one succeeded leaves the later one", async run(app) {
    await saving(app, "Bea", "dark");
    await app.type("name", "Cy"); await app.click("save");
    await app.land(await key(app, "Cy"), { name: "Cy", theme: "dark", density: "compact" });
    await app.fail(await key(app, "Bea"), "quota exceeded");
    await app.eq("saved", "Saved: Cy · dark · compact");
  } },
  { name: "a later save failing while an earlier one is still out shows the error, then the earlier result", async run(app) {
    await saving(app, "Bea", "dark");
    await app.type("name", "Cy"); await app.click("save");
    await app.fail(await key(app, "Cy"), "quota exceeded");
    await app.land(await key(app, "Bea"), { name: "Bea", theme: "dark", density: "compact" });
    await app.eq("saved", "Saved: Bea · dark · compact");
    await app.see("save-error", "Save failed: quota exceeded");
  } },
];
