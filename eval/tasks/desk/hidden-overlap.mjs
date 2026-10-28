// Hidden overlap tests: the six tasks' overlap tests, each on its page, and a write that answers after its page
// was left. Never shown to the agent.
import tracker from "../tracker/hidden-overlap.mjs";
import rename from "../rename/hidden-overlap.mjs";
import close from "../close/hidden-overlap.mjs";
import comments from "../comments/hidden-overlap.mjs";
import search from "../search/hidden-overlap.mjs";
import settings from "../settings/hidden-overlap.mjs";
import { onPage, own } from "./pages.mjs";
import { ANN, OPEN, open, saving, selected } from "./fixtures.mjs";

export default [
  ...tracker, ...own(rename), ...own(close), ...own(comments),
  ...onPage("help", search).map(t => ({ ...t, name: `help: ${t.name}` })),
  ...onPage("settings", settings).map(t => ({ ...t, name: `settings: ${t.name}` })),
  { name: "tabs: an assignment that answers after the page was left changes nothing on its return", async run(app) {
    await selected(app);
    await app.type("user", "ann");
    await app.click("assign");
    await open(app, "help");
    await open(app, "issues");
    await app.fail("assign:3,ann", "declined");
    await app.see("list", "loading open issues");
    await app.land("fetchIssues:open", OPEN);
    await app.see("list", "#3 Crash on save (unassigned)");
    await app.see("detail", "select an issue");
  } },
  { name: "tabs: a save that answers after the page was left shows the reloaded settings", async run(app) {
    await open(app, "settings");
    await saving(app, "Bea", "dark");
    await open(app, "issues");
    await open(app, "settings");
    await app.landOnly("saveSettings", { name: "Bea", theme: "dark", density: "compact" });
    await app.see("load", "Loading settings…");
    await app.land("loadSettings:", { ...ANN, name: "Bea", theme: "dark" });
    await app.eq("saved", "Saved: Bea · dark · compact");
    await app.notSee("saved", "saving");
  } },
];
