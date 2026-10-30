// Visible tests: the agent sees and runs these. The desk's, then each change's so far.
import { ANN, AP, APP, C1, C3, CLOSED, D1, D3, ITEM3, ITEM4, ITEM8, L1, L3, OPEN, OPEN_ROWS, REL1, REL3, addLabel, loaded, open, openWithout, post, removeLabel, rename, rowAssign, rowClose, rowsWithout, saving, searched, selected, settingsLoaded, withComments, withLabels, withRelated } from "./fixtures.mjs";

export default [
  { name: "on load: the open issues load", async run(app) {
    await app.see("list", "loading open issues");
    await app.see("detail", "select an issue");
    await loaded(app);
    await app.rows("issue", OPEN_ROWS);
  } },
  { name: "switching the filter loads the closed issues", async run(app) {
    await loaded(app);
    await app.click("filter-closed");
    await app.see("list", "loading closed issues");
    await app.land("fetchIssues:closed", CLOSED);
    await app.rows("issue", ["#2 Old bug (eve)"]);
  } },
  { name: "selecting an issue loads its detail", async run(app) {
    await loaded(app);
    await app.clickText("issue", "#3 ");
    await app.see("detail", "loading #3");
    await app.land("fetchIssue:3", D3);
    await app.see("detail", "#3 Crash on save", "stack trace attached");
  } },
  { name: "assigning shows the new assignee at once", async run(app) {
    await selected(app);
    await app.type("user", "ann");
    await app.see("assign", "assign to ann");
    await app.click("assign");
    await app.inAir("assign:3,ann");
    await app.see("list", "#3 Crash on save (ann)");
    await app.land("assign:3,ann", { id: 3, assignee: "ann" });
    await app.see("list", "#3 Crash on save (ann)");
  } },
  { name: "renaming shows the new title at once in the row and the heading", async run(app) {
    await selected(app);
    await rename(app, "Crash at boot");
    await app.inAir("renameIssue:3,Crash at boot");
    await app.see("list", "#3 Crash at boot (unassigned)");
    await app.see("detail", "#3 Crash at boot");
  } },
  { name: "an accepted rename keeps the new title", async run(app) {
    await selected(app);
    await rename(app, "Crash at boot");
    await app.land("renameIssue:3,Crash at boot", { id: 3, title: "Crash at boot" });
    await app.see("list", "#3 Crash at boot (unassigned)");
    await app.see("detail", "#3 Crash at boot");
  } },
  { name: "closing removes the row at once and keeps the detail", async run(app) {
    await selected(app);
    await app.click("close");
    await app.inAir("closeIssue:3");
    await app.rows("issue", rowsWithout(3));
    await app.see("detail", "#3 Crash on save");
  } },
  { name: "an accepted close keeps the row out", async run(app) {
    await selected(app);
    await app.click("close");
    await app.land("closeIssue:3", { id: 3 });
    await app.rows("issue", rowsWithout(3));
  } },
  { name: "selecting an issue loads its comments", async run(app) {
    await selected(app);
    await app.see("comments", "loading comments");
    await app.land("fetchComments:3", [{ author: "dana", text: "seen it too" }]);
    await app.rows("comment", ["dana: seen it too"]);
  } },
  { name: "posting shows the comment at once and keeps it when accepted", async run(app) {
    await withComments(app);
    await app.type("user", "ann");
    await post(app, "on it");
    await app.inAir("addComment:3,ann,on it");
    await app.rows("comment", ["dana: seen it too", "ann: on it (sending…)"]);
    await app.hasValue("comment-input", "");
    await app.land("addComment:3,ann,on it", { author: "ann", text: "on it" });
    await app.landIfAsked("fetchComments:3", [{ author: "dana", text: "seen it too" }, { author: "ann", text: "on it" }]);
    await app.rows("comment", ["dana: seen it too", "ann: on it"]);
  } },
  { name: "help on open: nothing selected, nothing asked", async run(app) {
    await open(app, "help");
    await app.see("item", "pick a result");
    if ((await app.asked()).some(k => /^(search|fetchItem):/.test(k))) throw new Error(`asked ${await app.asked()} on open`);
  } },
  { name: "one character is too short and asks nothing", async run(app) {
    await open(app, "help");
    await app.type("query", "a");
    await app.see("results", "too short: a");
    await app.notAsked("search:a");
  } },
  { name: "a search shows searching…, then its results", async run(app) {
    await open(app, "help");
    await app.type("query", "ap");
    await app.inAir("search:ap");
    await app.see("results", "searching…");
    await app.land("search:ap", AP);
    await app.see("results", "2 results for ap");
    await app.notSee("results", "searching…");
    await app.rows("hit", ["apple", "apricot"]);
  } },
  { name: "selecting a hit loads its detail", async run(app) {
    await open(app, "help");
    await searched(app, "app", APP);
    await app.clickText("hit", "applesauce");
    await app.rows("hit", ["apple", "> applesauce", "apple pie"]);
    await app.see("item", "loading…");
    await app.land("fetchItem:3", ITEM3);
    await app.see("item", "applesauce", "stewed apples");
  } },
  { name: "loads, then shows the saved line and the form", async run(app) {
    await open(app, "settings");
    await app.see("load", "Loading settings…");
    await settingsLoaded(app);
    await app.eq("saved", "Saved: Ann · light · compact");
    await app.hasValue("name", "Ann");
    await app.eq("name-count", "3/20");
    await app.eq("preview", "Preview: light / compact");
  } },
  { name: "validates the name", async run(app) {
    await open(app, "settings");
    await settingsLoaded(app);
    await app.type("name", "");
    await app.see("name-error", "Display name is required");
    await app.type("name", "Bartholomew the Magnificent");
    await app.see("name-error", "Display name must be at most 20 characters, not 27");
    await app.eq("name-count", "27/20");
    await app.type("name", "Bea");
    await app.notSee("name-error", "Display name");
  } },
  { name: "a save shows at once, then lands", async run(app) {
    await open(app, "settings");
    await saving(app, "Bea", "dark");
    await app.eq("saved", "Saved: Bea · dark · compact (saving…)");
    await app.landOnly("saveSettings", { name: "Bea", theme: "dark", density: "compact" });
    await app.eq("saved", "Saved: Bea · dark · compact");
  } },
  { name: "a failed load says so", async run(app) {
    await open(app, "settings");
    await app.fail("loadSettings:", "network down");
    await app.see("load", "Could not load settings: network down");
  } },
  { name: "tabs: settings, then back to issues, starts the issues page again", async run(app) {
    await selected(app);
    await open(app, "settings");
    await app.see("load", "Loading settings…");
    await app.notSee("list", "Crash on save");
    await open(app, "issues");
    await app.see("list", "loading open issues");
    await app.see("detail", "select an issue");
  } },
  { name: "selecting an issue loads its labels", async run(app) {
    await selected(app);
    await app.see("labels", "loading labels");
    await app.landIfAsked("fetchComments:3", C3);
    await app.land("fetchLabels:3", L3);
    await app.rows("label", ["bug", "ui"]);
  } },
  { name: "adding a label shows it at once and keeps it when accepted", async run(app) {
    await withLabels(app);
    await addLabel(app, "crash");
    await app.inAir("addLabel:3,crash");
    await app.rows("label", ["bug", "ui", "crash"]);
    await app.hasValue("label-input", "");
    await app.land("addLabel:3,crash", [...L3, "crash"]);
    await app.landIfAsked("fetchLabels:3", [...L3, "crash"]);
    await app.rows("label", ["bug", "ui", "crash"]);
  } },
  { name: "removing a label takes it out at once", async run(app) {
    await withLabels(app);
    await removeLabel(app, "bug");
    await app.inAir("removeLabel:3,bug");
    await app.rows("label", ["ui"]);
    await app.land("removeLabel:3,bug", ["ui"]);
    await app.landIfAsked("fetchLabels:3", ["ui"]);
    await app.rows("label", ["ui"]);
  } },
  { name: "the issues tab shows the open count once the open issues load", async run(app) {
    await app.eq("tab-issues", "Issues");
    await loaded(app);
    await app.eq("tab-issues", "Issues (3)");
  } },
  { name: "closing takes one off the count at once and keeps it off when accepted", async run(app) {
    await selected(app);
    await app.click("close");
    await app.eq("tab-issues", "Issues (2)");
    await app.land("closeIssue:3", { id: 3 });
    await app.landIfAsked("fetchIssues:open", openWithout(3));
    await app.eq("tab-issues", "Issues (2)");
  } },
  { name: "a selected issue shows its related help", async run(app) {
    await selected(app);
    await app.see("related", "finding related help");
    await app.land("search:Crash on save", REL3);
    await app.rows("related-hit", ["saving files", "crash reports", "autosave"]);
  } },
  { name: "opening a related hit shows it on the help page", async run(app) {
    await withRelated(app);
    await app.clickText("related-hit", "crash reports");
    await app.hasValue("query", "Crash on save");
    await app.landIfAsked("search:Crash on save", REL3);
    await app.see("results", "4 results for Crash on save");
    await app.rows("hit", ["saving files", "> crash reports", "autosave", "backups"]);
    await app.see("item", "loading…");
    await app.land("fetchItem:8", ITEM8);
    await app.see("item", "crash reports", "send us the log");
  } },
  { name: "rows: each row has an assign and a close button, and its text is unchanged", async run(app) {
    await loaded(app);
    await app.rows("issue", OPEN_ROWS);
    await app.rows("row-assign", ["assign to guest", "assign to guest", "assign to guest"]);
    await app.rows("row-close", ["close", "close", "close"]);
    await app.type("user", "ann");
    await app.rows("row-assign", ["assign to ann", "assign to ann", "assign to ann"]);
  } },
  { name: "rows: a row assign shows the assignee at once and keeps it, without selecting the issue", async run(app) {
    await loaded(app);
    await app.type("user", "ann");
    await rowAssign(app, 1);
    await app.inAir("assign:3,ann");
    await app.see("list", "#3 Crash on save (ann)");
    await app.see("detail", "select an issue");
    await app.notAsked("fetchIssue:3");
    await app.land("assign:3,ann", { id: 3, assignee: "ann" });
    await app.see("list", "#3 Crash on save (ann)");
  } },
  { name: "rows: a row close removes the row at once and keeps it out", async run(app) {
    await loaded(app);
    await rowClose(app, 1);
    await app.inAir("closeIssue:3");
    await app.rows("issue", rowsWithout(3));
    await app.eq("tab-issues", "Issues (2)");
    await app.land("closeIssue:3", { id: 3 });
    await app.rows("issue", rowsWithout(3));
    await app.eq("tab-issues", "Issues (2)");
  } },
  { name: "rows: closed issues have no row close button", async run(app) {
    await loaded(app);
    await app.click("filter-closed");
    await app.land("fetchIssues:closed", CLOSED);
    await app.rows("row-assign", ["assign to guest"]);
    await app.rows("row-close", []);
  } },
];
