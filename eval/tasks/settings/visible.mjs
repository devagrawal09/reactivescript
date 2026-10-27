// Visible tests: the agent sees and runs these.
import { loaded, saving } from "./fixtures.mjs";

export default [
  { name: "loads, then shows the saved line and the form", async run(app) {
    await app.see("load", "Loading settings…");
    await loaded(app);
    await app.eq("saved", "Saved: Ann · light · compact");
    await app.hasValue("name", "Ann");
    await app.eq("name-count", "3/20");
    await app.eq("preview", "Preview: light / compact");
  } },
  { name: "validates the name", async run(app) {
    await loaded(app);
    await app.type("name", "");
    await app.see("name-error", "Display name is required");
    await app.type("name", "Bartholomew the Magnificent");
    await app.see("name-error", "Display name must be at most 20 characters, not 27");
    await app.eq("name-count", "27/20");
    await app.type("name", "Bea");
    await app.notSee("name-error", "Display name");
  } },
  { name: "a save shows at once, then lands", async run(app) {
    await saving(app, "Bea", "dark");
    await app.eq("saved", "Saved: Bea · dark · compact (saving…)");
    await app.landOnly("saveSettings", { name: "Bea", theme: "dark", density: "compact" });
    await app.eq("saved", "Saved: Bea · dark · compact");
  } },
  { name: "a failed load says so", async run(app) {
    await app.fail("loadSettings:", "network down");
    await app.see("load", "Could not load settings: network down");
  } },
];
