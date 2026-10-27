export type Theme = "light" | "dark";
export type Density = "comfortable" | "compact";
export type Settings = { name: string; theme: Theme; density: Density };
export function loadSettings(): Promise<Settings>;
export function saveSettings(s: Settings): Promise<Settings>;
