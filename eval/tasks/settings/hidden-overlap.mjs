// Round 3 hidden tests: overlapping saves. Never shown to the agent.
import { saving } from "./fixtures.mjs";

/** the key of the save of `name` in flight (the app may order the object's fields its own way) */
const saveOf = async (app, name) => {
  const k = (await app.pending()).find(k => k.startsWith("saveSettings:") && k.includes(`"name":"${name}"`));
  if (!k) throw new Error(`expected a save of ${name} in flight; in flight: ${JSON.stringify(await app.pending())}`);
  return k;
};
const BEA = { name: "Bea", theme: "dark", density: "compact" };
const CY = { name: "Cy", theme: "dark", density: "compact" };

export default [
  { name: "an earlier save failing after a later one succeeded leaves the later one", async run(app) {
    await saving(app, "Bea", "dark");
    await app.type("name", "Cy"); await app.click("save");
    await app.land(await saveOf(app, "Cy"), CY);
    await app.fail(await saveOf(app, "Bea"), "quota exceeded");
    await app.eq("saved", "Saved: Cy · dark · compact");
  } },
  { name: "a later save failing while an earlier one is out shows its error and then the earlier result", async run(app) {
    await saving(app, "Bea", "dark");
    await app.type("name", "Cy"); await app.click("save");
    await app.fail(await saveOf(app, "Cy"), "quota exceeded");
    await app.land(await saveOf(app, "Bea"), BEA);
    await app.eq("saved", "Saved: Bea · dark · compact");
    await app.see("save-error", "Save failed: quota exceeded");
  } },
  { name: "an earlier save landing while a later one is out keeps showing the later one", async run(app) {
    await saving(app, "Bea", "dark");
    await app.type("name", "Cy"); await app.click("save");
    await app.land(await saveOf(app, "Bea"), BEA);
    await app.eq("saved", "Saved: Cy · dark · compact (saving…)");
    await app.land(await saveOf(app, "Cy"), CY);
    await app.eq("saved", "Saved: Cy · dark · compact");
  } },
];
