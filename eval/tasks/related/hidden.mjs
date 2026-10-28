// Round 5 hidden tests: the change's own behaviour, and the desk's hidden tests as regressions. Never shown to the
// agent.
import base from "../desk/hidden.mjs";
import { D1, D3, ITEM8, REL1, REL3, loaded, open, selected, withRelated } from "./fixtures.mjs";

export default [
  ...base.map(t => ({ ...t, name: `base: ${t.name}` })),
  { name: "an issue with no related help says so", async run(app) {
    await selected(app);
    await app.land("search:Crash on save", []);
    await app.see("related", "no related help");
    await app.rows("related-hit", []);
  } },
  { name: "a failed related search says so and leaves the issue", async run(app) {
    await selected(app);
    await app.fail("search:Crash on save", "offline");
    await app.see("related", "related help failed: offline");
    await app.see("detail", "#3 Crash on save", "stack trace attached");
  } },
  { name: "related help landing out of order shows the selected issue's", async run(app) {
    await loaded(app);
    await app.clickText("issue", "#3 "); await app.land("fetchIssue:3", D3);
    await app.clickText("issue", "#1 "); await app.land("fetchIssue:1", D1);
    await app.land("search:Login fails", REL1);
    await app.landIfAsked("search:Crash on save", REL3);
    await app.rows("related-hit", ["signing in"]);
  } },
  { name: "the help page opened from its tab after a related hit starts empty", async run(app) {
    await withRelated(app);
    await app.clickText("related-hit", "crash reports");
    await app.landIfAsked("search:Crash on save", REL3);
    await app.land("fetchItem:8", ITEM8);
    await open(app, "issues");
    await open(app, "help");
    await app.hasValue("query", "");
    await app.see("item", "pick a result");
    await app.notSee("results", "crash reports");
  } },
  { name: "the results for a related hit may land after the help page opens", async run(app) {
    await withRelated(app);
    await app.clickText("related-hit", "autosave");
    await app.see("item", "loading…");
    await app.land("fetchItem:9", { id: 9, name: "autosave", blurb: "every minute" });
    await app.see("item", "every minute");
    await app.landIfAsked("search:Crash on save", REL3);
    await app.see("results", "4 results for Crash on save");
    await app.rows("hit", ["saving files", "crash reports", "> autosave", "backups"]);
  } },
  { name: "a related item that fails can be retried on the help page", async run(app) {
    await withRelated(app);
    await app.clickText("related-hit", "crash reports");
    await app.fail("fetchItem:8", "timeout");
    await app.see("item", "failed: timeout");
    await app.click("retry-item");
    await app.land("fetchItem:8", ITEM8);
    await app.see("item", "send us the log");
  } },
];
