// Hidden tests of the row actions change (the chain's step 4): its own behaviour. The chain's hidden file adds the
// earlier steps' hidden tests as regressions. Never shown to the agent.
import { OPEN_ROWS, loaded, rowAssign, rowClose, rowsWithout, selected } from "./fixtures.mjs";

export default [
  { name: "rows: a declined row assign reverts the row and shows the row error", async run(app) {
    await loaded(app);
    await rowAssign(app, 1);
    await app.see("list", "#3 Crash on save (guest)");
    await app.fail("assign:3,guest", "declined");
    await app.rows("issue", OPEN_ROWS);
    await app.eq("row-error", "row error: declined");
  } },
  { name: "rows: a declined row close brings the row back in place, the count back, and shows the row error", async run(app) {
    await loaded(app);
    await rowClose(app, 1);
    await app.rows("issue", rowsWithout(3));
    await app.fail("closeIssue:3", "declined");
    await app.rows("issue", OPEN_ROWS);
    await app.eq("tab-issues", "Issues (3)");
    await app.eq("row-error", "row error: declined");
  } },
  { name: "rows: the next row action clears the row error at once", async run(app) {
    await loaded(app);
    await rowClose(app, 1);
    await app.fail("closeIssue:3", "declined");
    await app.see("row-error", "row error: declined");
    await rowAssign(app, 0);
    await app.inAir("assign:1,guest");
    await app.notSee("row-error", "row error");
  } },
  { name: "rows: a row close on the selected issue leaves its detail", async run(app) {
    await selected(app);
    await rowClose(app, 1);
    await app.rows("issue", rowsWithout(3));
    await app.see("detail", "#3 Crash on save", "stack trace attached");
    await app.land("closeIssue:3", { id: 3 });
    await app.see("detail", "#3 Crash on save");
  } },
  { name: "rows: row errors and detail errors leave each other alone", async run(app) {
    await selected(app);
    await app.click("assign");
    await app.fail("assign:3,guest", "no rights");
    await app.see("detail", "no rights");
    await rowClose(app, 0);
    await app.fail("closeIssue:1", "declined");
    await app.eq("row-error", "row error: declined");
    await app.see("detail", "no rights");
    await app.notSee("detail", "close error");
    await app.click("rename"); // nothing typed: no rename starts
    await app.type("title-input", "Crash at boot");
    await app.click("rename");
    await app.eq("row-error", "row error: declined");
  } },
  { name: "rows: a row button does not select, even after another issue was selected", async run(app) {
    await selected(app);
    await rowAssign(app, 0);
    await app.see("detail", "#3 Crash on save");
    await app.notAsked("fetchIssue:1");
    await app.land("assign:1,guest", { id: 1, assignee: "guest" });
    await app.see("list", "#1 Login fails (guest)");
    await app.see("detail", "#3 Crash on save");
  } },
  { name: "rows: an accepted row close survives switching filters and back", async run(app) {
    await loaded(app);
    await rowClose(app, 0);
    await app.land("closeIssue:1", { id: 1 });
    await app.click("filter-closed");
    await app.land("fetchIssues:closed", [{ id: 1, title: "Login fails", assignee: null }, { id: 2, title: "Old bug", assignee: "eve" }]);
    await app.click("filter-open");
    await app.land("fetchIssues:open", [{ id: 3, title: "Crash on save", assignee: null }, { id: 4, title: "Typo in footer", assignee: "dana" }]);
    await app.rows("issue", rowsWithout(1));
    await app.eq("tab-issues", "Issues (2)");
  } },
];
