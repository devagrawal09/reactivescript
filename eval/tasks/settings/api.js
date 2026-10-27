import { flight } from "./flights.js";

export const loadSettings = () => flight("loadSettings", []);
export const saveSettings = s => flight("saveSettings", [s]);
