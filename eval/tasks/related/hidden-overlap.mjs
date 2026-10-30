// Round 5 hidden tests: the change's requests overlapping the desk's, and the desk's overlap tests as regressions.
// Never shown to the agent.
import base from "../desk/hidden-overlap.mjs";
import { AP, ITEM4, ITEM8, REL3, open, selected, withRelated } from "./fixtures.mjs";

export default [
  ...base.map(t => ({ ...t, name: `base: ${t.name}` })),
  { name: "a related search answering after the issues page was left does not show on the help page", async run(app) {
    await selected(app);
    await open(app, "help");
    await app.type("query", "ap");
    await app.land("search:Crash on save", REL3);
    await app.land("search:ap", AP);
    await app.rows("hit", ["apple", "apricot"]);
    await app.see("results", "2 results for ap");
  } },
  { name: "selecting another hit after opening a related one shows the other", async run(app) {
    await withRelated(app);
    await app.clickText("related-hit", "crash reports");
    await app.landIfAsked("search:Crash on save", REL3);
    await app.clickText("hit", "backups");
    await app.land("fetchItem:10", { id: 10, name: "backups", blurb: "nightly" });
    await app.landIfAsked("fetchItem:8", ITEM8);
    await app.see("item", "nightly");
    await app.notSee("item", "send us the log");
    await app.rows("hit", ["saving files", "crash reports", "autosave", "> backups"]);
  } },
  { name: "typing a new query after opening a related hit searches for it", async run(app) {
    await withRelated(app);
    await app.clickText("related-hit", "crash reports");
    await app.landIfAsked("search:Crash on save", REL3);
    await app.type("query", "app");
    await app.land("search:app", [{ id: 1, name: "apple" }, { id: 4, name: "apple pie" }]);
    await app.see("results", "2 results for app");
    await app.clickText("hit", "apple pie");
    await app.land("fetchItem:4", ITEM4);
    await app.see("item", "baked with cinnamon");
  } },
];
