// Visible tests of the row actions change (the chain's step 4). The chain's visible file adds the earlier steps'.
import { CLOSED, OPEN_ROWS, loaded, rowAssign, rowClose, rowsWithout } from "./fixtures.mjs";

export default [
  { name: "rows: each row has an assign and a close button, and its text is unchanged", async run(app) {
    await loaded(app);
    await app.rows("issue", OPEN_ROWS);
    await app.rows("row-assign", ["assign to guest", "assign to guest", "assign to guest"]);
    await app.rows("row-close", ["close", "close", "close"]);
    await app.type("user", "ann");
    await app.rows("row-assign", ["assign to ann", "assign to ann", "assign to ann"]);
  } },
  { name: "rows: a row assign shows the assignee at once and keeps it, without selecting the issue", async run(app) {
    await loaded(app);
    await app.type("user", "ann");
    await rowAssign(app, 1);
    await app.inAir("assign:3,ann");
    await app.see("list", "#3 Crash on save (ann)");
    await app.see("detail", "select an issue");
    await app.notAsked("fetchIssue:3");
    await app.land("assign:3,ann", { id: 3, assignee: "ann" });
    await app.see("list", "#3 Crash on save (ann)");
  } },
  { name: "rows: a row close removes the row at once and keeps it out", async run(app) {
    await loaded(app);
    await rowClose(app, 1);
    await app.inAir("closeIssue:3");
    await app.rows("issue", rowsWithout(3));
    await app.eq("tab-issues", "Issues (2)");
    await app.land("closeIssue:3", { id: 3 });
    await app.rows("issue", rowsWithout(3));
    await app.eq("tab-issues", "Issues (2)");
  } },
  { name: "rows: closed issues have no row close button", async run(app) {
    await loaded(app);
    await app.click("filter-closed");
    await app.land("fetchIssues:closed", CLOSED);
    await app.rows("row-assign", ["assign to guest"]);
    await app.rows("row-close", []);
  } },
];
