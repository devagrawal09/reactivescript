// Round 4 hidden tests: the change's writes overlapping the base app's, and the base app's overlap tests as
// regressions. Never shown to the agent.
import base from "../tracker/hidden-overlap.mjs";
import { C1, C3, D1, D3, withComments, post } from "./fixtures.mjs";

const after = (...more) => [...C3, ...more];

export default [
  ...base.map(t => ({ ...t, name: `base: ${t.name}` })),
  { name: "two posts at once: a declined one does not take the other with it", async run(app) {
    await withComments(app);
    await app.type("user", "ann");
    await post(app, "first");
    await post(app, "second");
    await app.fail("addComment:3,ann,first", "declined");
    // the declined post may stay until the other settles (two guesses on one list are one change, H-11); the one
    // still out must not go
    await app.see("comments", "ann: second (sending…)");
    await app.land("addComment:3,ann,second", { author: "ann", text: "second" });
    await app.landIfAsked("fetchComments:3", after({ author: "ann", text: "second" }));
    await app.rows("comment", ["dana: seen it too", "ann: second"]);
  } },
  { name: "a post on one issue does not show on another", async run(app) {
    await withComments(app);
    await app.type("user", "ann");
    await post(app, "on it");
    await app.clickText("issue", "#1 "); await app.land("fetchIssue:1", D1); await app.land("fetchComments:1", C1);
    await app.notSee("comments", "on it");
    await app.land("addComment:3,ann,on it", { author: "ann", text: "on it" });
    await app.landIfAsked("fetchComments:3", after({ author: "ann", text: "on it" }));
    await app.notSee("comments", "on it");
  } },
  { name: "comments that load while a post is out keep the post", async run(app) {
    await withComments(app);
    await app.type("user", "ann");
    await post(app, "on it");
    await app.clickText("issue", "#1 "); await app.land("fetchIssue:1", D1); await app.land("fetchComments:1", C1);
    await app.clickText("issue", "#3 "); await app.landIfAsked("fetchIssue:3", D3);
    await app.landIfAsked("fetchComments:3", C3);
    await app.rows("comment", ["dana: seen it too", "ann: on it (sending…)"]);
    await app.land("addComment:3,ann,on it", { author: "ann", text: "on it" });
    await app.landIfAsked("fetchComments:3", after({ author: "ann", text: "on it" }));
    await app.rows("comment", ["dana: seen it too", "ann: on it"]);
  } },
  { name: "a post declined while an assignment is out leaves the assignment", async run(app) {
    await withComments(app);
    await app.type("user", "ann");
    await app.click("assign");
    await post(app, "on it");
    await app.fail("addComment:3,ann,on it", "declined");
    await app.see("list", "#3 Crash on save (ann)");
    await app.see("detail", "post error: declined");
  } },
];
