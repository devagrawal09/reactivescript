// Round 4 hidden tests: the change's own behaviour, and the base app's hidden tests as regressions. Never shown to
// the agent.
import base from "../tracker/hidden.mjs";
import { C1, C3, D1, D3, loaded, selected, withComments, post } from "./fixtures.mjs";

const after = (...more) => [...C3, ...more];

export default [
  ...base.map(t => ({ ...t, name: `base: ${t.name}` })),
  { name: "a declined post removes the row and shows the message", async run(app) {
    await withComments(app);
    await app.type("user", "ann");
    await post(app, "on it");
    await app.fail("addComment:3,ann,on it", "declined");
    await app.rows("comment", ["dana: seen it too"]);
    await app.see("detail", "post error: declined");
  } },
  { name: "a new post clears the previous error at once", async run(app) {
    await withComments(app);
    await app.type("user", "ann");
    await post(app, "on it");
    await app.fail("addComment:3,ann,on it", "declined");
    await post(app, "really");
    await app.notSee("detail", "post error");
    await app.rows("comment", ["dana: seen it too", "ann: really (sending…)"]);
  } },
  { name: "selecting another issue clears the post error", async run(app) {
    await withComments(app);
    await app.type("user", "ann");
    await post(app, "on it");
    await app.fail("addComment:3,ann,on it", "declined");
    await app.clickText("issue", "#1 ");
    await app.notSee("detail", "post error");
  } },
  { name: "comments landing out of order show the selected issue's", async run(app) {
    await loaded(app);
    await app.clickText("issue", "#3 "); await app.clickText("issue", "#1 ");
    await app.land("fetchIssue:1", D1);
    await app.land("fetchComments:1", C1);
    await app.landIfAsked("fetchIssue:3", D3);
    await app.landIfAsked("fetchComments:3", C3);
    await app.notSee("comments", "seen it too");
  } },
  { name: "failing comments show their error and leave the issue", async run(app) {
    await selected(app);
    await app.fail("fetchComments:3", "timeout");
    await app.see("comments", "comments error: timeout");
    await app.see("detail", "#3 Crash on save", "stack trace attached");
  } },
  { name: "an accepted post stays after switching issues and back", async run(app) {
    await withComments(app);
    await app.type("user", "ann");
    await post(app, "on it");
    await app.land("addComment:3,ann,on it", { author: "ann", text: "on it" });
    await app.landIfAsked("fetchComments:3", after({ author: "ann", text: "on it" }));
    await app.clickText("issue", "#1 "); await app.land("fetchIssue:1", D1); await app.landIfAsked("fetchComments:1", C1);
    await app.clickText("issue", "#3 "); await app.landIfAsked("fetchIssue:3", D3);
    await app.landIfAsked("fetchComments:3", after({ author: "ann", text: "on it" }));
    await app.rows("comment", ["dana: seen it too", "ann: on it"]);
  } },
];
