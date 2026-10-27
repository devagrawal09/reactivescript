// Round 4 hidden tests: the change's writes overlapping the base app's, and the base app's overlap tests as
// regressions. Never shown to the agent.
import base from "../tracker/hidden-overlap.mjs";
import { D1, OPEN, OPEN_ROWS, selected, openWithout, rowsWithout } from "./fixtures.mjs";

export default [
  ...base.map(t => ({ ...t, name: `base: ${t.name}` })),
  { name: "a declined close keeps an assignment in flight on another issue", async run(app) {
    await selected(app);
    await app.type("user", "ann");
    await app.click("close");
    await app.clickText("issue", "#1 "); await app.land("fetchIssue:1", D1);
    await app.click("assign");
    await app.fail("closeIssue:3", "declined");
    await app.rows("issue", ["#1 Login fails (ann)", "#3 Crash on save (unassigned)", "#4 Typo in footer (dana)"]);
    await app.land("assign:1,ann", { id: 1, assignee: "ann" });
    await app.landIfAsked("fetchIssues:open", OPEN.map(i => i.id === 1 ? { ...i, assignee: "ann" } : i));
    await app.rows("issue", ["#1 Login fails (ann)", "#3 Crash on save (unassigned)", "#4 Typo in footer (dana)"]);
  } },
  { name: "a declined assignment keeps a close in flight on another issue", async run(app) {
    await selected(app);
    await app.type("user", "ann");
    await app.click("assign");
    await app.clickText("issue", "#1 "); await app.land("fetchIssue:1", D1);
    await app.click("close");
    await app.fail("assign:3,ann", "declined");
    await app.rows("issue", ["#3 Crash on save (unassigned)", "#4 Typo in footer (dana)"]);
    await app.land("closeIssue:1", { id: 1 });
    await app.landIfAsked("fetchIssues:open", openWithout(1));
    await app.rows("issue", ["#3 Crash on save (unassigned)", "#4 Typo in footer (dana)"]);
  } },
  { name: "a list that loads while a close is out keeps the row out", async run(app) {
    await selected(app);
    await app.click("close");
    await app.click("filter-closed");
    await app.click("filter-open");
    await app.landIfAsked("fetchIssues:closed", []);
    await app.landIfAsked("fetchIssues:open", OPEN);
    await app.rows("issue", rowsWithout(3));
    await app.land("closeIssue:3", { id: 3 });
    await app.landIfAsked("fetchIssues:open", openWithout(3));
    await app.rows("issue", rowsWithout(3));
  } },
  { name: "two closes at once: declining one brings back only that row", async run(app) {
    await selected(app);
    await app.click("close");
    await app.clickText("issue", "#1 "); await app.land("fetchIssue:1", D1);
    await app.click("close");
    await app.fail("closeIssue:3", "declined");
    await app.rows("issue", ["#3 Crash on save (unassigned)", "#4 Typo in footer (dana)"]);
    await app.land("closeIssue:1", { id: 1 });
    await app.landIfAsked("fetchIssues:open", openWithout(1));
    await app.rows("issue", ["#3 Crash on save (unassigned)", "#4 Typo in footer (dana)"]);
  } },
];
