export const OPEN = [{ id: 1, title: "Login fails", assignee: null }, { id: 3, title: "Crash on save", assignee: null }, { id: 4, title: "Typo in footer", assignee: "dana" }];
export const CLOSED = [{ id: 2, title: "Old bug", assignee: "eve" }];
export const OPEN_ROWS = ["#1 Login fails (unassigned)", "#3 Crash on save (unassigned)", "#4 Typo in footer (dana)"];
export const D1 = { id: 1, title: "Login fails", body: "on Safari only" };
export const D3 = { id: 3, title: "Crash on save", body: "stack trace attached" };
/** the open issues loaded */
export async function loaded(app) { await app.land("fetchIssues:open", OPEN); }
/** the open issues loaded and issue `id` selected with its detail */
export async function selected(app, id = 3, detail = D3) { await loaded(app); await app.clickText("issue", `#${id} `); await app.land(`fetchIssue:${id}`, detail); }
export const C3 = [{ author: "dana", text: "seen it too" }];
export const C1 = [];
/** issue 3 selected with its detail and its comments */
export async function withComments(app) { await selected(app); await app.land("fetchComments:3", C3); }
/** type `text` into the comment input and click post */
export async function post(app, text) { await app.type("comment-input", text); await app.click("post"); }
