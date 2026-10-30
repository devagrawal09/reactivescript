// Round 5 hidden tests: the change's own behaviour, and the desk's hidden tests as regressions. Never shown to the
// agent.
import base from "../desk/hidden.mjs";
import { CLOSED, OPEN, loaded, open, selected } from "./fixtures.mjs";

export default [
  ...base.map(t => ({ ...t, name: `base: ${t.name}` })),
  { name: "a declined close puts the count back", async run(app) {
    await selected(app);
    await app.click("close");
    await app.eq("tab-issues", "Issues (2)");
    await app.fail("closeIssue:3", "declined");
    await app.eq("tab-issues", "Issues (3)");
  } },
  { name: "the count stays on the other pages", async run(app) {
    await loaded(app);
    await open(app, "help");
    await app.eq("tab-issues", "Issues (3)");
    await open(app, "settings");
    await app.eq("tab-issues", "Issues (3)");
  } },
  { name: "the count follows the open issues when the issues page opens again", async run(app) {
    await loaded(app);
    await open(app, "help");
    await open(app, "issues");
    await app.eq("tab-issues", "Issues (3)");
    await app.land("fetchIssues:open", OPEN.slice(0, 2));
    await app.eq("tab-issues", "Issues (2)");
  } },
  { name: "the count keeps its number while closed issues show, and follows open ones again", async run(app) {
    await loaded(app);
    await app.click("filter-closed");
    await app.land("fetchIssues:closed", CLOSED);
    await app.eq("tab-issues", "Issues (3)");
    await app.click("filter-open");
    await app.landIfAsked("fetchIssues:open", [...OPEN, { id: 5, title: "Slow start", assignee: null }]);
    await app.eq("tab-issues", "Issues (4)");
  } },
  { name: "a failed load keeps the last count", async run(app) {
    await loaded(app);
    await open(app, "help");
    await open(app, "issues");
    await app.fail("fetchIssues:open", "offline");
    await app.see("list", "list error: offline");
    await app.eq("tab-issues", "Issues (3)");
  } },
  { name: "no count before the open issues have loaded once", async run(app) {
    await app.fail("fetchIssues:open", "offline");
    await app.eq("tab-issues", "Issues");
    await open(app, "help");
    await app.eq("tab-issues", "Issues");
  } },
];
