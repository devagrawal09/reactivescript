// Hidden tests: adversarial timing. Never shown to the agent.
import { AP, APP, ITEM3, ITEM4, searched } from "./fixtures.mjs";

export default [
  { name: "an earlier search landing late does not replace the current results", async run(app) {
    await app.type("query", "ap"); await app.type("query", "app");
    await app.land("search:app", APP);
    await app.land("search:ap", AP);
    await app.rows("hit", ["apple", "applesauce", "apple pie"]);
    await app.see("results", "3 results for app");
    await app.notSee("results", "searching…", "apricot");
  } },
  { name: "an earlier search failing late shows no error", async run(app) {
    await app.type("query", "ap"); await app.type("query", "app");
    await app.land("search:app", APP);
    await app.fail("search:ap", "boom");
    await app.notSee("results", "search failed");
    await app.rows("hit", ["apple", "applesauce", "apple pie"]);
  } },
  { name: "a search landing after the query became too short is ignored", async run(app) {
    await app.type("query", "ap"); await app.type("query", "a");
    await app.land("search:ap", AP);
    await app.see("results", "too short: a");
    await app.notSee("results", "apricot", "2 results");
  } },
  { name: "a search landing after the query was cleared is ignored", async run(app) {
    await app.type("query", "ap"); await app.type("query", "");
    await app.land("search:ap", AP);
    await app.notSee("results", "apricot", "2 results");
  } },
  { name: "the previous results stay up while the next search is in flight", async run(app) {
    await searched(app, "ap", AP);
    await app.type("query", "app");
    await app.see("results", "searching…");
    await app.rows("hit", ["apple", "apricot"]);
  } },
  { name: "the current search failing shows its error, a later search clears it", async run(app) {
    await app.type("query", "ap");
    await app.fail("search:ap", "offline");
    await app.see("results", "search failed: offline");
    await searched(app, "app", APP);
    await app.notSee("results", "search failed");
    await app.see("results", "3 results for app");
  } },
  { name: "details landing out of order show the selected item", async run(app) {
    await searched(app, "app", APP);
    await app.clickText("hit", "apple pie"); await app.clickText("hit", "applesauce");
    await app.land("fetchItem:3", ITEM3);
    await app.land("fetchItem:4", ITEM4);
    await app.see("detail", "applesauce", "stewed apples");
    await app.notSee("detail", "cinnamon");
  } },
  { name: "a late failure for a previous selection shows nothing", async run(app) {
    await searched(app, "app", APP);
    await app.clickText("hit", "apple pie"); await app.clickText("hit", "applesauce");
    await app.land("fetchItem:3", ITEM3);
    await app.fail("fetchItem:4", "timeout");
    await app.notSee("detail", "failed");
    await app.see("detail", "stewed apples");
  } },
  { name: "selecting after a failure shows loading…, not the old failure", async run(app) {
    await searched(app, "app", APP);
    await app.clickText("hit", "applesauce");
    await app.fail("fetchItem:3", "timeout");
    await app.see("detail", "failed: timeout");
    await app.clickText("hit", "apple pie");
    await app.see("detail", "loading…");
    await app.notSee("detail", "failed");
    await app.land("fetchItem:4", ITEM4);
    await app.see("detail", "baked with cinnamon");
  } },
  { name: "selecting after not found shows loading…, not the old message", async run(app) {
    await searched(app, "app", APP);
    await app.clickText("hit", "apple pie");
    await app.land("fetchItem:4", null);
    await app.see("detail", "item 4 not found");
    await app.clickText("hit", "applesauce");
    await app.see("detail", "loading…");
    await app.notSee("detail", "not found");
  } },
  { name: "retry asks again and its answer replaces the failure", async run(app) {
    await searched(app, "app", APP);
    await app.clickText("hit", "applesauce");
    await app.fail("fetchItem:3", "timeout");
    await app.click("retry");
    await app.inAir("fetchItem:3");
    await app.land("fetchItem:3", ITEM3);
    await app.see("detail", "stewed apples");
    await app.notSee("detail", "failed");
  } },
  { name: "a failing detail leaves the results alone", async run(app) {
    await searched(app, "app", APP);
    await app.clickText("hit", "applesauce");
    await app.fail("fetchItem:3", "timeout");
    await app.see("results", "3 results for app");
    await app.rows("hit", ["apple", "> applesauce", "apple pie"]);
  } },
];
