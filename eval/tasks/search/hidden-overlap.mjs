// Round 3 hidden tests: overlapping requests and writes. Never shown to the agent.
import { APP, ITEM4, searched } from "./fixtures.mjs";

export default [
  { name: "a retry's answer landing after another selection is ignored", async run(app) {
    await searched(app, "app", APP);
    await app.clickText("hit", "applesauce");
    await app.fail("fetchItem:3", "timeout");
    await app.click("retry");
    await app.clickText("hit", "apple pie");
    await app.land("fetchItem:4", ITEM4);
    await app.land("fetchItem:3", { id: 3, name: "applesauce", blurb: "stewed apples" });
    await app.see("detail", "baked with cinnamon");
    await app.notSee("detail", "stewed apples", "failed");
  } },
];
