// Hidden tests: the six tasks' hidden tests, each on its page, and the tabs' own. Never shown to the agent.
import tracker from "../tracker/hidden.mjs";
import rename from "../rename/hidden.mjs";
import close from "../close/hidden.mjs";
import comments from "../comments/hidden.mjs";
import search from "../search/hidden.mjs";
import settings from "../settings/hidden.mjs";
import { onPage, own } from "./pages.mjs";
import { ANN, AP, D3, OPEN, loaded, open, selected, searched, settingsLoaded } from "./fixtures.mjs";

export default [
  ...tracker, ...own(rename), ...own(close), ...own(comments),
  ...onPage("help", search).map(t => ({ ...t, name: `help: ${t.name}` })),
  ...onPage("settings", settings).map(t => ({ ...t, name: `settings: ${t.name}` })),
  { name: "tabs: the help page starts again when reopened", async run(app) {
    await open(app, "help");
    await searched(app, "ap", AP);
    await open(app, "issues");
    await open(app, "help");
    await app.hasValue("query", "");
    await app.notSee("results", "apricot");
    await app.see("item", "pick a result");
  } },
  { name: "tabs: the settings page loads again when reopened, with a fresh draft", async run(app) {
    await open(app, "settings");
    await settingsLoaded(app);
    await app.type("name", "Bea");
    await open(app, "help");
    await open(app, "settings");
    await app.see("load", "Loading settings…");
    await app.askedTimes("loadSettings:", 2);
    await app.land("loadSettings:", ANN);
    await app.hasValue("name", "Ann");
  } },
  { name: "tabs: a detail answer for a page that was left does not show when it is reopened", async run(app) {
    await loaded(app);
    await app.clickText("issue", "#3 ");
    await open(app, "help");
    await open(app, "issues");
    await app.land("fetchIssue:3", D3);
    await loaded(app);
    await app.see("detail", "select an issue");
    await app.notSee("detail", "Crash on save");
  } },
  { name: "tabs: the user resets to guest when the issues page is reopened", async run(app) {
    await selected(app);
    await app.type("user", "ann");
    await open(app, "settings");
    await open(app, "issues");
    await loaded(app);
    await app.hasValue("user", "guest");
    await app.clickText("issue", "#3 ");
    await app.landIfAsked("fetchIssue:3", D3);
    await app.see("assign", "assign to guest");
  } },
];
