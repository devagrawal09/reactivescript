// Runs another task's tests on one page of the desk: opens the page's tab first, and for the help page maps the
// search task's ids onto the desk's (`detail` -> `item`, `retry` -> `retry-item`) and hides the issues page's
// requests from `asked`/`pending` (the desk opens on the issues page, which asks for the open issues).
const ids = { detail: "item", retry: "retry-item" };

export function onPage(page, tests) {
  return tests.map(t => ({
    ...t,
    async run(app) {
      if (page === "help") {
        for (const m of ["text", "exists", "type", "value", "click", "clickText", "items"]) {
          const f = app[m];
          app[m] = (id, ...rest) => f(ids[id] ?? id, ...rest);
        }
        for (const m of ["asked", "pending"]) {
          const f = app[m];
          app[m] = async () => (await f()).filter(k => !k.startsWith("fetchIssues:"));
        }
      }
      if (page !== "issues") await app.click(`tab-${page}`);
      await t.run(app);
    },
  }));
}

/** a task's own tests, without the base tests it repeats */
export const own = tests => tests.filter(t => !t.name.startsWith("base: "));
