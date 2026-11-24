export const pending = [];

export function defaultPrefs() {
  return {
    theme: "light",
    density: "comfortable",
    notifications: { email: true, push: false, digest: "daily" },
    editor: { fontSize: 14, tabSize: 2, lineWrap: true },
  };
}

export function themeLabel(theme) {
  if (theme === "dark") return "Dark";
  if (theme === "system") return "Match system";
  return "Light";
}
