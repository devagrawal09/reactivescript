// Round 4 hidden tests: the change's own behaviour, and the base app's hidden tests as regressions. Never shown to
// the agent.
import base from "../tracker/hidden.mjs";
import { D1, D3, OPEN, CLOSED, loaded, selected, rename } from "./fixtures.mjs";

export default [
  ...base.map(t => ({ ...t, name: `base: ${t.name}` })),
  { name: "a declined rename reverts the row and the heading and shows the message", async run(app) {
    await selected(app);
    await rename(app, "Crash at boot");
    await app.fail("renameIssue:3,Crash at boot", "declined");
    await app.see("list", "#3 Crash on save (unassigned)");
    await app.see("detail", "#3 Crash on save", "rename error: declined");
    await app.notSee("detail", "Crash at boot");
  } },
  { name: "a new rename clears the previous error at once", async run(app) {
    await selected(app);
    await rename(app, "Crash at boot");
    await app.fail("renameIssue:3,Crash at boot", "declined");
    await rename(app, "Crash on load");
    await app.notSee("detail", "rename error");
    await app.see("list", "#3 Crash on load (unassigned)");
  } },
  { name: "selecting another issue clears the rename error", async run(app) {
    await selected(app);
    await rename(app, "Crash at boot");
    await app.fail("renameIssue:3,Crash at boot", "declined");
    await app.clickText("issue", "#1 ");
    await app.notSee("detail", "rename error");
  } },
  { name: "the title input is empty when another issue is selected", async run(app) {
    await selected(app);
    await app.type("title-input", "half typed");
    await app.clickText("issue", "#1 "); await app.land("fetchIssue:1", D1);
    await app.hasValue("title-input", "");
  } },
  { name: "an accepted rename survives switching filters and back", async run(app) {
    await selected(app);
    await rename(app, "Crash at boot");
    await app.land("renameIssue:3,Crash at boot", { id: 3, title: "Crash at boot" });
    await app.landIfAsked("fetchIssues:open", OPEN.map(i => i.id === 3 ? { ...i, title: "Crash at boot" } : i));
    await app.click("filter-closed");
    await app.land("fetchIssues:closed", CLOSED);
    await app.click("filter-open");
    await app.landIfAsked("fetchIssues:open", OPEN.map(i => i.id === 3 ? { ...i, title: "Crash at boot" } : i));
    await app.see("list", "#3 Crash at boot (unassigned)");
  } },
];
