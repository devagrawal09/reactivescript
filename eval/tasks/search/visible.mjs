// Visible tests: the agent sees and runs these.
import { AP, APP, ITEM3, searched } from "./fixtures.mjs";

export default [
  { name: "on load: nothing selected, nothing asked", async run(app) {
    await app.see("detail", "pick a result");
    if ((await app.asked()).length) throw new Error(`asked ${await app.asked()} on load`);
  } },
  { name: "one character is too short and asks nothing", async run(app) {
    await app.type("query", "a");
    await app.see("results", "too short: a");
    await app.notAsked("search:a");
  } },
  { name: "a search shows searching…, then its results", async run(app) {
    await app.type("query", "ap");
    await app.inAir("search:ap");
    await app.see("results", "searching…");
    await app.land("search:ap", AP);
    await app.see("results", "2 results for ap");
    await app.notSee("results", "searching…");
    await app.rows("hit", ["apple", "apricot"]);
  } },
  { name: "selecting a hit loads its detail", async run(app) {
    await searched(app, "app", APP);
    await app.clickText("hit", "applesauce");
    await app.rows("hit", ["apple", "> applesauce", "apple pie"]);
    await app.see("detail", "loading…");
    await app.land("fetchItem:3", ITEM3);
    await app.see("detail", "applesauce", "stewed apples");
  } },
];
