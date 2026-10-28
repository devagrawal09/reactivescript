// Round 5 hidden tests: the change's own behaviour, and the desk's hidden tests as regressions. Never shown to the
// agent.
import base from "../desk/hidden.mjs";
import { C1, C3, D1, D3, L1, L3, loaded, selected, withLabels, addLabel, removeLabel } from "./fixtures.mjs";

/** switch to issue 1 and land what it asks */
async function toIssue1(app) {
  await app.clickText("issue", "#1 ");
  await app.landIfAsked("fetchIssue:1", D1); await app.landIfAsked("fetchComments:1", C1); await app.landIfAsked("fetchLabels:1", L1);
}

export default [
  ...base.map(t => ({ ...t, name: `base: ${t.name}` })),
  { name: "a declined add removes the label and shows the message", async run(app) {
    await withLabels(app);
    await addLabel(app, "crash");
    await app.fail("addLabel:3,crash", "declined");
    await app.rows("label", ["bug", "ui"]);
    await app.see("detail", "label error: declined");
  } },
  { name: "a declined remove puts the label back where it was and shows the message", async run(app) {
    await withLabels(app);
    await removeLabel(app, "bug");
    await app.fail("removeLabel:3,bug", "declined");
    await app.rows("label", ["bug", "ui"]);
    await app.see("detail", "label error: declined");
  } },
  { name: "adding a label the issue already has asks nothing", async run(app) {
    await withLabels(app);
    await addLabel(app, "ui");
    await app.noneInAir("addLabel");
    await app.rows("label", ["bug", "ui"]);
  } },
  { name: "a new label change clears the previous error at once", async run(app) {
    await withLabels(app);
    await addLabel(app, "crash");
    await app.fail("addLabel:3,crash", "declined");
    await removeLabel(app, "ui");
    await app.notSee("detail", "label error");
    await app.rows("label", ["bug"]);
  } },
  { name: "selecting another issue clears the label error", async run(app) {
    await withLabels(app);
    await addLabel(app, "crash");
    await app.fail("addLabel:3,crash", "declined");
    await toIssue1(app);
    await app.notSee("detail", "label error");
  } },
  { name: "labels landing out of order show the selected issue's", async run(app) {
    await loaded(app);
    await app.clickText("issue", "#3 "); await app.clickText("issue", "#1 ");
    await app.land("fetchIssue:1", D1);
    await app.landIfAsked("fetchComments:1", C1);
    await app.land("fetchLabels:1", ["docs"]);
    await app.landIfAsked("fetchIssue:3", D3);
    await app.landIfAsked("fetchComments:3", C3);
    await app.landIfAsked("fetchLabels:3", L3);
    await app.rows("label", ["docs"]);
  } },
  { name: "failing labels show their error and leave the issue", async run(app) {
    await selected(app);
    await app.fail("fetchLabels:3", "timeout");
    await app.see("labels", "labels error: timeout");
    await app.see("detail", "#3 Crash on save", "stack trace attached");
  } },
  { name: "an accepted add stays after switching issues and back", async run(app) {
    await withLabels(app);
    await addLabel(app, "crash");
    await app.land("addLabel:3,crash", [...L3, "crash"]);
    await app.landIfAsked("fetchLabels:3", [...L3, "crash"]);
    await toIssue1(app);
    await app.clickText("issue", "#3 "); await app.landIfAsked("fetchIssue:3", D3); await app.landIfAsked("fetchComments:3", C3);
    await app.landIfAsked("fetchLabels:3", [...L3, "crash"]);
    await app.rows("label", ["bug", "ui", "crash"]);
  } },
];
