export const ANN = { name: "Ann", theme: "light", density: "compact" };
export async function loaded(app) { await app.land("loadSettings:", ANN); }
/** loaded, the name typed, the theme picked, then saved: returns the request's key */
export async function saving(app, name, theme) {
  await loaded(app);
  await app.type("name", name);
  if (theme) await app.click(`theme-${theme}`);
  await app.click("save");
  return app.only("saveSettings");
}
