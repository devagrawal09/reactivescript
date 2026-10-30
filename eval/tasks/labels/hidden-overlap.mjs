// Round 5 hidden tests: the change's writes overlapping each other and the desk's, and the desk's overlap tests as
// regressions. Never shown to the agent.
import base from "../desk/hidden-overlap.mjs";
import { C1, C3, D1, D3, L1, L3, withLabels, addLabel, removeLabel } from "./fixtures.mjs";

export default [
  ...base.map(t => ({ ...t, name: `base: ${t.name}` })),
  { name: "an add and a remove at once: a declined add does not undo the remove", async run(app) {
    await withLabels(app);
    await addLabel(app, "crash");
    await removeLabel(app, "bug");
    await app.fail("addLabel:3,crash", "declined");
    // the declined add may stay until the remove settles (two guesses on one list are one change, H-11); the
    // remove still out must not come undone
    await app.notSee("labels", "bug");
    await app.land("removeLabel:3,bug", ["ui"]);
    await app.landIfAsked("fetchLabels:3", ["ui"]);
    await app.rows("label", ["ui"]);
  } },
  { name: "two adds at once: a declined one does not take the other with it", async run(app) {
    await withLabels(app);
    await addLabel(app, "crash");
    await addLabel(app, "p1");
    await app.fail("addLabel:3,crash", "declined");
    await app.see("labels", "p1");
    await app.land("addLabel:3,p1", [...L3, "p1"]);
    await app.landIfAsked("fetchLabels:3", [...L3, "p1"]);
    await app.rows("label", ["bug", "ui", "p1"]);
  } },
  { name: "a label added on one issue does not show on another", async run(app) {
    await withLabels(app);
    await addLabel(app, "crash");
    await app.clickText("issue", "#1 "); await app.landIfAsked("fetchIssue:1", D1); await app.landIfAsked("fetchComments:1", C1);
    await app.landIfAsked("fetchLabels:1", L1);
    // the selection may be held until the add settles (see comments' "a post on one issue…"); what must not show is
    // the label under #1
    if ((await app.text("labels") ?? "").includes("crash")) await app.see("detail", "Crash on save");
    await app.land("addLabel:3,crash", [...L3, "crash"]);
    await app.landIfAsked("fetchIssue:1", D1); await app.landIfAsked("fetchComments:1", C1); await app.landIfAsked("fetchLabels:1", L1);
    await app.landIfAsked("fetchLabels:3", [...L3, "crash"]);
    await app.see("detail", "Login fails");
    await app.notSee("labels", "crash");
  } },
  { name: "labels that load while an add is out keep the add", async run(app) {
    await withLabels(app);
    await addLabel(app, "crash");
    await app.clickText("issue", "#1 "); await app.land("fetchIssue:1", D1); await app.landIfAsked("fetchComments:1", C1);
    await app.land("fetchLabels:1", L1);
    await app.clickText("issue", "#3 "); await app.landIfAsked("fetchIssue:3", D3); await app.landIfAsked("fetchComments:3", C3);
    await app.landIfAsked("fetchLabels:3", L3);
    await app.rows("label", ["bug", "ui", "crash"]);
    await app.land("addLabel:3,crash", [...L3, "crash"]);
    await app.landIfAsked("fetchLabels:3", [...L3, "crash"]);
    await app.rows("label", ["bug", "ui", "crash"]);
  } },
  { name: "a label change declined while a rename is out leaves the rename", async run(app) {
    await withLabels(app);
    await app.type("title-input", "Crash at boot"); await app.click("rename");
    await removeLabel(app, "ui");
    await app.fail("removeLabel:3,ui", "declined");
    await app.see("list", "#3 Crash at boot (unassigned)");
    await app.see("detail", "#3 Crash at boot", "label error: declined");
    await app.rows("label", ["bug", "ui"]);
  } },
];
