// Issues
export const OPEN = [{ id: 1, title: "Login fails", assignee: null }, { id: 3, title: "Crash on save", assignee: null }, { id: 4, title: "Typo in footer", assignee: "dana" }];
export const CLOSED = [{ id: 2, title: "Old bug", assignee: "eve" }];
export const OPEN_ROWS = ["#1 Login fails (unassigned)", "#3 Crash on save (unassigned)", "#4 Typo in footer (dana)"];
export const D1 = { id: 1, title: "Login fails", body: "on Safari only" };
export const D3 = { id: 3, title: "Crash on save", body: "stack trace attached" };
export const C3 = [{ author: "dana", text: "seen it too" }];
export const C1 = [];
/** the open issues loaded */
export async function loaded(app) { await app.land("fetchIssues:open", OPEN); }
/** the open issues loaded and issue `id` selected with its detail */
export async function selected(app, id = 3, detail = D3) { await loaded(app); await app.clickText("issue", `#${id} `); await app.land(`fetchIssue:${id}`, detail); }
/** issue 3 selected with its detail and its comments */
export async function withComments(app) { await selected(app); await app.land("fetchComments:3", C3); }
/** type `title` into the detail's title input and click rename */
export async function rename(app, title) { await app.type("title-input", title); await app.click("rename"); }
/** type `text` into the comment input and click post */
export async function post(app, text) { await app.type("comment-input", text); await app.click("post"); }
export const openWithout = id => OPEN.filter(i => i.id !== id);
export const rowsWithout = id => OPEN_ROWS.filter(r => !r.startsWith(`#${id} `));

// Help
export const AP = [{ id: 1, name: "apple" }, { id: 2, name: "apricot" }];
export const APP = [{ id: 1, name: "apple" }, { id: 3, name: "applesauce" }, { id: 4, name: "apple pie" }];
export const ITEM3 = { id: 3, name: "applesauce", blurb: "stewed apples" };
export const ITEM4 = { id: 4, name: "apple pie", blurb: "baked with cinnamon" };
/** type a query and land its answer */
export async function searched(app, q, hits) { await app.type("query", q); await app.land(`search:${q}`, hits); }

// Settings
export const ANN = { name: "Ann", theme: "light", density: "compact" };
export async function settingsLoaded(app) { await app.land("loadSettings:", ANN); }
/** loaded, the name typed, the theme picked, then saved: returns the request's key */
export async function saving(app, name, theme) {
  await settingsLoaded(app);
  await app.type("name", name);
  if (theme) await app.click(`theme-${theme}`);
  await app.click("save");
  return app.only("saveSettings");
}

/** open the help or settings tab first */
export async function open(app, page) { await app.click(`tab-${page}`); }
