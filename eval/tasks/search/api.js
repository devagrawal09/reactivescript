import { flight } from "./flights.js";

export const search = q => flight("search", [q]);
export const fetchItem = id => flight("fetchItem", [id]);
