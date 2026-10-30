// Hidden overlap tests of the row actions change (the chain's step 4): row actions overlapping the detail's and the
// list's requests. The chain's overlap file adds the earlier steps' overlap tests as regressions. Never shown to the
// agent.
import { OPEN, OPEN_ROWS, loaded, open, openWithout, rename, rowAssign, rowClose, rowsWithout, selected } from "./fixtures.mjs";

export default [
  { name: "rows: a detail assign and a newer row assign on one issue: the newer shows while the older answers", async run(app) {
    await selected(app);
    await app.type("user", "ann");
    await app.click("assign");
    await app.type("user", "bob");
    await rowAssign(app, 1);
    await app.see("list", "#3 Crash on save (bob)");
    await app.land("assign:3,ann", { id: 3, assignee: "ann" });
    await app.see("list", "#3 Crash on save (bob)");
    await app.land("assign:3,bob", { id: 3, assignee: "bob" });
    await app.see("list", "#3 Crash on save (bob)");
  } },
  { name: "rows: a row assign and a newer detail assign on one issue: a declined older one leaves the newer", async run(app) {
    await selected(app);
    await app.type("user", "ann");
    await rowAssign(app, 1);
    await app.type("user", "bob");
    await app.click("assign");
    await app.see("list", "#3 Crash on save (bob)");
    await app.fail("assign:3,ann", "declined");
    await app.see("list", "#3 Crash on save (bob)");
    await app.land("assign:3,bob", { id: 3, assignee: "bob" });
    // the row error may wait until the newer assignment settles (one change, H-11)
    await app.landIfAsked("fetchIssues:open", OPEN.map(i => (i.id === 3 ? { ...i, assignee: "bob" } : i)));
    await app.see("list", "#3 Crash on save (bob)");
    await app.eq("row-error", "row error: declined");
    await app.notSee("detail", "declined");
  } },
  { name: "rows: a declined row close leaves a rename out on another issue", async run(app) {
    await selected(app);
    await rename(app, "Crash at boot");
    await rowClose(app, 0);
    await app.rows("issue", ["#3 Crash at boot (unassigned)", "#4 Typo in footer (dana)"]);
    await app.fail("closeIssue:1", "declined");
    await app.rows("issue", ["#1 Login fails (unassigned)", "#3 Crash at boot (unassigned)", "#4 Typo in footer (dana)"]);
    await app.land("renameIssue:3,Crash at boot", { id: 3, title: "Crash at boot" });
    await app.rows("issue", ["#1 Login fails (unassigned)", "#3 Crash at boot (unassigned)", "#4 Typo in footer (dana)"]);
  } },
  { name: "rows: a row close and a detail close at once: a declined one leaves the other out and off the count", async run(app) {
    await selected(app);
    await app.click("close");
    await rowClose(app, 0);
    await app.rows("issue", ["#4 Typo in footer (dana)"]);
    await app.eq("tab-issues", "Issues (1)");
    await app.fail("closeIssue:1", "declined");
    // the declined close may stay until the other settles (one change, H-11); the other close must not undo
    await app.notSee("list", "#3 Crash on save");
    await app.land("closeIssue:3", { id: 3 });
    await app.landIfAsked("fetchIssues:open", openWithout(3));
    await app.rows("issue", ["#1 Login fails (unassigned)", "#4 Typo in footer (dana)"]);
    await app.eq("tab-issues", "Issues (2)");
    await app.eq("row-error", "row error: declined");
    await app.notSee("detail", "close error");
  } },
  { name: "rows: open issues that load while a row close is out keep the row out", async run(app) {
    await loaded(app);
    await rowClose(app, 1);
    await app.click("filter-closed");
    await app.landOnly("fetchIssues", []);
    await app.click("filter-open");
    await app.land("fetchIssues:open", OPEN);
    await app.rows("issue", rowsWithout(3));
    await app.eq("tab-issues", "Issues (2)");
    await app.land("closeIssue:3", { id: 3 });
    await app.rows("issue", rowsWithout(3));
  } },
  { name: "rows: a row action that answers after the issues page was left changes nothing on its return", async run(app) {
    await loaded(app);
    await rowAssign(app, 1);
    await open(app, "help");
    await app.fail("assign:3,guest", "declined");
    await open(app, "issues");
    await app.land("fetchIssues:open", OPEN);
    await app.rows("issue", OPEN_ROWS);
    await app.notSee("row-error", "row error");
  } },
];
