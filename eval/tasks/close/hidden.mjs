// Round 4 hidden tests: the change's own behaviour, and the base app's hidden tests as regressions. Never shown to
// the agent.
import base from "../tracker/hidden.mjs";
import { CLOSED, OPEN_ROWS, selected, openWithout, rowsWithout } from "./fixtures.mjs";

export default [
  ...base.map(t => ({ ...t, name: `base: ${t.name}` })),
  { name: "a declined close brings the row back in place and shows the message", async run(app) {
    await selected(app);
    await app.click("close");
    await app.fail("closeIssue:3", "declined");
    await app.rows("issue", OPEN_ROWS);
    await app.see("detail", "close error: declined");
  } },
  { name: "a new close clears the previous error at once", async run(app) {
    await selected(app);
    await app.click("close");
    await app.fail("closeIssue:3", "declined");
    await app.click("close");
    await app.notSee("detail", "close error");
    await app.rows("issue", rowsWithout(3));
  } },
  { name: "selecting another issue clears the close error", async run(app) {
    await selected(app);
    await app.click("close");
    await app.fail("closeIssue:3", "declined");
    await app.clickText("issue", "#1 ");
    await app.notSee("detail", "close error");
  } },
  { name: "an accepted close survives switching filters and back", async run(app) {
    await selected(app);
    await app.click("close");
    await app.land("closeIssue:3", { id: 3 });
    await app.landIfAsked("fetchIssues:open", openWithout(3));
    await app.click("filter-closed");
    await app.landIfAsked("fetchIssues:closed", [...CLOSED, { id: 3, title: "Crash on save", assignee: null }]);
    await app.click("filter-open");
    await app.landIfAsked("fetchIssues:open", openWithout(3));
    await app.rows("issue", rowsWithout(3));
  } },
];
