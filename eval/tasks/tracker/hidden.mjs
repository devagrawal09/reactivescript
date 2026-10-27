// Hidden tests: adversarial timing. Never shown to the agent.
import { CLOSED, D1, D3, OPEN, OPEN_ROWS, loaded, selected } from "./fixtures.mjs";

export default [
  { name: "a declined assignment reverts the row and shows the message", async run(app) {
    await selected(app);
    await app.type("user", "ann");
    await app.click("assign");
    await app.fail("assign:3,ann", "declined");
    await app.see("list", "#3 Crash on save (unassigned)");
    await app.see("detail", "declined");
  } },
  { name: "a new assignment clears the previous error at once", async run(app) {
    await selected(app);
    await app.type("user", "ann");
    await app.click("assign");
    await app.fail("assign:3,ann", "declined");
    await app.type("user", "bo");
    await app.click("assign");
    await app.notSee("detail", "declined");
    await app.see("list", "#3 Crash on save (bo)");
  } },
  { name: "selecting another issue clears the assignment error", async run(app) {
    await selected(app);
    await app.type("user", "ann");
    await app.click("assign");
    await app.fail("assign:3,ann", "declined");
    await app.clickText("issue", "#1 ");
    await app.notSee("detail", "declined");
  } },
  { name: "a filter answer landing late does not replace the current filter's list", async run(app) {
    await loaded(app);
    await app.click("filter-closed");
    await app.click("filter-open");
    await app.landIfAsked("fetchIssues:open", OPEN);
    await app.land("fetchIssues:closed", CLOSED);
    await app.rows("issue", OPEN_ROWS);
    await app.notSee("list", "Old bug");
  } },
  { name: "a filter failing late shows no error", async run(app) {
    await loaded(app);
    await app.click("filter-closed");
    await app.click("filter-open");
    await app.landIfAsked("fetchIssues:open", OPEN);
    await app.fail("fetchIssues:closed", "timeout");
    await app.notSee("list", "list error");
    await app.rows("issue", OPEN_ROWS);
  } },
  { name: "details landing out of order show the selected issue", async run(app) {
    await loaded(app);
    await app.clickText("issue", "#3 "); await app.clickText("issue", "#1 ");
    await app.land("fetchIssue:1", D1);
    await app.land("fetchIssue:3", D3);
    await app.see("detail", "#1 Login fails", "on Safari only");
    await app.notSee("detail", "stack trace");
  } },
  { name: "selecting after not found shows loading, not the old message", async run(app) {
    await loaded(app);
    await app.clickText("issue", "#3 ");
    await app.land("fetchIssue:3", null);
    await app.see("detail", "detail error: issue #3 not found");
    await app.clickText("issue", "#1 ");
    await app.see("detail", "loading #1");
    await app.notSee("detail", "not found");
  } },
  { name: "retry after not found shows the issue", async run(app) {
    await loaded(app);
    await app.clickText("issue", "#3 ");
    await app.land("fetchIssue:3", null);
    await app.click("retry");
    await app.inAir("fetchIssue:3");
    await app.land("fetchIssue:3", D3);
    await app.see("detail", "stack trace attached");
    await app.notSee("detail", "not found");
  } },
  { name: "a failing list leaves the detail alone", async run(app) {
    await selected(app);
    await app.click("filter-closed");
    await app.fail("fetchIssues:closed", "timeout");
    await app.see("list", "list error: timeout");
    await app.see("detail", "#3 Crash on save", "stack trace attached");
  } },
  { name: "a failing detail leaves the list alone", async run(app) {
    await loaded(app);
    await app.clickText("issue", "#3 ");
    await app.fail("fetchIssue:3", "timeout");
    await app.see("detail", "detail error: timeout");
    await app.rows("issue", OPEN_ROWS);
  } },
  { name: "an accepted assignment survives switching filters and back", async run(app) {
    await selected(app);
    await app.type("user", "ann");
    await app.click("assign");
    await app.land("assign:3,ann", { id: 3, assignee: "ann" });
    await app.click("filter-closed");
    await app.land("fetchIssues:closed", CLOSED);
    await app.click("filter-open");
    await app.landIfAsked("fetchIssues:open", OPEN.map(i => i.id === 3 ? { ...i, assignee: "ann" } : i));
    await app.see("list", "#3 Crash on save (ann)");
  } },
];
