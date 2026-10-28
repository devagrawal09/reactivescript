// Round 4 hidden tests: the change's writes overlapping the base app's, and the base app's overlap tests as
// regressions. Never shown to the agent.
import base from "../tracker/hidden-overlap.mjs";
import { D3, OPEN, selected, rename } from "./fixtures.mjs";

export default [
  ...base.map(t => ({ ...t, name: `base: ${t.name}` })),
  { name: "a declined assignment keeps a rename in flight on the same issue", async run(app) {
    await selected(app);
    await app.type("user", "ann");
    await app.click("assign");
    await rename(app, "Crash at boot");
    await app.fail("assign:3,ann", "declined");
    await app.see("list", "#3 Crash at boot (unassigned)");
    await app.land("renameIssue:3,Crash at boot", { id: 3, title: "Crash at boot" });
    await app.landIfAsked("fetchIssues:open", OPEN.map(i => i.id === 3 ? { ...i, title: "Crash at boot" } : i));
    await app.see("list", "#3 Crash at boot (unassigned)");
  } },
  { name: "a declined rename keeps an assignment in flight on the same issue", async run(app) {
    await selected(app);
    await app.type("user", "ann");
    await app.click("assign");
    await rename(app, "Crash at boot");
    await app.fail("renameIssue:3,Crash at boot", "declined");
    await app.see("list", "#3 Crash on save (ann)");
    await app.see("detail", "rename error: declined");
    await app.land("assign:3,ann", { id: 3, assignee: "ann" });
    await app.landIfAsked("fetchIssues:open", OPEN.map(i => i.id === 3 ? { ...i, assignee: "ann" } : i));
    await app.see("list", "#3 Crash on save (ann)");
  } },
  { name: "a list that loads while a rename is out keeps the new title", async run(app) {
    await selected(app);
    await rename(app, "Crash at boot");
    await app.click("filter-closed");
    await app.click("filter-open");
    await app.landIfAsked("fetchIssues:closed", []);
    await app.landIfAsked("fetchIssues:open", OPEN);
    await app.see("list", "#3 Crash at boot (unassigned)");
    await app.land("renameIssue:3,Crash at boot", { id: 3, title: "Crash at boot" });
    await app.see("list", "#3 Crash at boot (unassigned)");
  } },
  { name: "a detail that loads while a rename is out keeps the new title", async run(app) {
    await selected(app);
    await rename(app, "Crash at boot");
    await app.click("retry");
    await app.land("fetchIssue:3", D3);
    await app.see("detail", "#3 Crash at boot");
    await app.land("renameIssue:3,Crash at boot", { id: 3, title: "Crash at boot" });
    await app.see("detail", "#3 Crash at boot");
  } },
  { name: "an earlier rename declined after a later one was accepted keeps the later title", async run(app) {
    await selected(app);
    await rename(app, "Crash at boot");
    await rename(app, "Crash on load");
    await app.land("renameIssue:3,Crash on load", { id: 3, title: "Crash on load" });
    await app.landIfAsked("fetchIssues:open", OPEN.map(i => i.id === 3 ? { ...i, title: "Crash on load" } : i));
    await app.fail("renameIssue:3,Crash at boot", "declined");
    await app.see("list", "#3 Crash on load (unassigned)");
    await app.see("detail", "#3 Crash on load");
  } },
];
