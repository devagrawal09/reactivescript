export const AP = [{ id: 1, name: "apple" }, { id: 2, name: "apricot" }];
export const APP = [{ id: 1, name: "apple" }, { id: 3, name: "applesauce" }, { id: 4, name: "apple pie" }];
export const ITEM3 = { id: 3, name: "applesauce", blurb: "stewed apples" };
export const ITEM4 = { id: 4, name: "apple pie", blurb: "baked with cinnamon" };
/** type a query and land its answer */
export async function searched(app, q, hits) { await app.type("query", q); await app.land(`search:${q}`, hits); }
