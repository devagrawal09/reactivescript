// Round 3 hidden tests: overlapping requests and writes. Never shown to the agent.
import { D1, OPEN, selected } from "./fixtures.mjs";

export default [
  { name: "two issues assigned at once: declining one reverts only that row", async run(app) {
    await selected(app);
    await app.type("user", "ann");
    await app.click("assign");
    await app.clickText("issue", "#1 "); await app.land("fetchIssue:1", D1);
    await app.click("assign");
    await app.fail("assign:3,ann", "declined");
    await app.see("list", "#3 Crash on save (unassigned)", "#1 Login fails (ann)");
    await app.land("assign:1,ann", { id: 1, assignee: "ann" });
    await app.see("list", "#3 Crash on save (unassigned)", "#1 Login fails (ann)");
  } },
  { name: "a list that loads while an assignment is out keeps the new assignee", async run(app) {
    await selected(app);
    await app.type("user", "ann");
    await app.click("assign");
    await app.click("filter-closed");
    await app.click("filter-open");
    await app.landIfAsked("fetchIssues:closed", []);
    await app.landIfAsked("fetchIssues:open", OPEN);
    await app.see("list", "#3 Crash on save (ann)");
    await app.land("assign:3,ann", { id: 3, assignee: "ann" });
    await app.see("list", "#3 Crash on save (ann)");
  } },
];
