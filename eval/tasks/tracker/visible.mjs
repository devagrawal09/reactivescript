// Visible tests: the agent sees and runs these.
import { CLOSED, D3, OPEN_ROWS, loaded, selected } from "./fixtures.mjs";

export default [
  { name: "on load: the open issues load", async run(app) {
    await app.see("list", "loading open issues");
    await app.see("detail", "select an issue");
    await loaded(app);
    await app.rows("issue", OPEN_ROWS);
  } },
  { name: "switching the filter loads the closed issues", async run(app) {
    await loaded(app);
    await app.click("filter-closed");
    await app.see("list", "loading closed issues");
    await app.land("fetchIssues:closed", CLOSED);
    await app.rows("issue", ["#2 Old bug (eve)"]);
  } },
  { name: "selecting an issue loads its detail", async run(app) {
    await loaded(app);
    await app.clickText("issue", "#3 ");
    await app.see("detail", "loading #3");
    await app.land("fetchIssue:3", D3);
    await app.see("detail", "#3 Crash on save", "stack trace attached");
  } },
  { name: "assigning shows the new assignee at once", async run(app) {
    await selected(app);
    await app.type("user", "ann");
    await app.see("assign", "assign to ann");
    await app.click("assign");
    await app.inAir("assign:3,ann");
    await app.see("list", "#3 Crash on save (ann)");
    await app.land("assign:3,ann", { id: 3, assignee: "ann" });
    await app.see("list", "#3 Crash on save (ann)");
  } },
];
