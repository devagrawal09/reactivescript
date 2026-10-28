export const OPEN = [{ id: 1, title: "Login fails", assignee: null }, { id: 3, title: "Crash on save", assignee: null }, { id: 4, title: "Typo in footer", assignee: "dana" }];
export const CLOSED = [{ id: 2, title: "Old bug", assignee: "eve" }];
export const OPEN_ROWS = ["#1 Login fails (unassigned)", "#3 Crash on save (unassigned)", "#4 Typo in footer (dana)"];
export const D1 = { id: 1, title: "Login fails", body: "on Safari only" };
export const D3 = { id: 3, title: "Crash on save", body: "stack trace attached" };
/** the open issues loaded */
export async function loaded(app) { await app.land("fetchIssues:open", OPEN); }
/** the open issues loaded and issue `id` selected with its detail */
export async function selected(app, id = 3, detail = D3) { await loaded(app); await app.clickText("issue", `#${id} `); await app.land(`fetchIssue:${id}`, detail); }
/** the open issues without `id` */
export const openWithout = id => OPEN.filter(i => i.id !== id);
export const rowsWithout = id => OPEN_ROWS.filter(r => !r.startsWith(`#${id} `));
