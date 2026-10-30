// Round 5 hidden tests: the count under overlapping closes and loads, and the desk's overlap tests as regressions.
// Never shown to the agent.
import base from "../desk/hidden-overlap.mjs";
import { D1, OPEN, loaded, openWithout, selected } from "./fixtures.mjs";

export default [
  ...base.map(t => ({ ...t, name: `base: ${t.name}` })),
  { name: "two closes at once: a declined one leaves the other off the count", async run(app) {
    await selected(app);
    await app.click("close");
    await app.clickText("issue", "#1 "); await app.landIfAsked("fetchIssue:1", D1);
    await app.click("close");
    await app.eq("tab-issues", "Issues (1)");
    await app.fail("closeIssue:3", "declined");
    // the declined close may stay off until the other settles (two guesses on one list are one change, H-11)
    await app.land("closeIssue:1", { id: 1 });
    await app.landIfAsked("fetchIssues:open", openWithout(1));
    await app.eq("tab-issues", "Issues (2)");
  } },
  { name: "open issues that load while a close is out keep it off the count", async run(app) {
    await selected(app);
    await app.click("close");
    await app.click("filter-closed");
    await app.landIfAsked("fetchIssues:closed", []);
    await app.click("filter-open");
    await app.landIfAsked("fetchIssues:open", OPEN);
    await app.eq("tab-issues", "Issues (2)");
    await app.fail("closeIssue:3", "declined");
    await app.landIfAsked("fetchIssues:open", OPEN);
    await app.eq("tab-issues", "Issues (3)");
  } },
  { name: "a close that answers after the issues page was left still shows in the count", async run(app) {
    await selected(app);
    await app.click("close");
    await app.click("tab-help");
    await app.eq("tab-issues", "Issues (2)");
    await app.land("closeIssue:3", { id: 3 });
    await app.eq("tab-issues", "Issues (2)");
    await app.click("tab-issues");
    await app.land("fetchIssues:open", openWithout(3));
    await app.eq("tab-issues", "Issues (2)");
  } },
];
