// Hidden tests: adversarial timing. Never shown to the agent.
import { ANN, loaded, saving } from "./fixtures.mjs";

const BEA = { name: "Bea", theme: "dark", density: "compact" };
export default [
  { name: "a failed save reverts the saved line, shows the error and keeps the draft", async run(app) {
    await saving(app, "Bea", "dark");
    await app.failOnly("saveSettings", "quota exceeded");
    await app.eq("saved", "Saved: Ann · light · compact");
    await app.see("save-error", "Save failed: quota exceeded");
    await app.hasValue("name", "Bea");
    await app.eq("preview", "Preview: dark / compact");
  } },
  { name: "saving an invalid name asks nothing", async run(app) {
    await loaded(app);
    await app.type("name", "");
    await app.click("save");
    await app.noneInAir("saveSettings");
    await app.eq("saved", "Saved: Ann · light · compact");
  } },
  { name: "a new save hides the previous error at once", async run(app) {
    await saving(app, "Bea", "dark");
    await app.failOnly("saveSettings", "quota exceeded");
    await app.click("density-toggle");
    await app.click("save");
    await app.notSee("save-error", "Save failed");
    await app.eq("saved", "Saved: Bea · dark · comfortable (saving…)");
  } },
  { name: "edits made while a save is in flight survive its success", async run(app) {
    await saving(app, "Bea", "dark");
    await app.type("name", "Beatrice");
    await app.click("theme-light");
    await app.landOnly("saveSettings", BEA);
    await app.eq("saved", "Saved: Bea · dark · compact");
    await app.hasValue("name", "Beatrice");
    await app.eq("preview", "Preview: light / compact");
  } },
  { name: "edits made while a save is in flight survive its failure", async run(app) {
    await saving(app, "Bea", "dark");
    await app.type("name", "Beatrice");
    await app.failOnly("saveSettings", "quota exceeded");
    await app.hasValue("name", "Beatrice");
    await app.eq("saved", "Saved: Ann · light · compact");
  } },
  { name: "a failed save after a successful one reverts to the last save", async run(app) {
    await saving(app, "Bea", "dark");
    await app.landOnly("saveSettings", BEA);
    await app.type("name", "Cy");
    await app.click("save");
    await app.eq("saved", "Saved: Cy · dark · compact (saving…)");
    await app.failOnly("saveSettings", "quota exceeded");
    await app.eq("saved", "Saved: Bea · dark · compact");
  } },
  { name: "retrying a failed load shows the settings", async run(app) {
    await app.fail("loadSettings:", "network down");
    await app.click("retry-load");
    await app.inAir("loadSettings:");
    await app.land("loadSettings:", ANN);
    await app.eq("saved", "Saved: Ann · light · compact");
    await app.notSee("load", "Could not load");
    await app.hasValue("name", "Ann");
  } },
  { name: "draft changes do not touch the saved line until a save", async run(app) {
    await loaded(app);
    await app.click("theme-dark"); await app.click("density-toggle"); await app.type("name", "Dee");
    await app.eq("preview", "Preview: dark / comfortable");
    await app.eq("saved", "Saved: Ann · light · compact");
  } },
];
