import { flight } from "./flights.js";

export const fetchIssues = filter => flight("fetchIssues", [filter]);
export const fetchIssue = id => flight("fetchIssue", [id]);
export const assign = (id, user) => flight("assign", [id, user]);
export const renameIssue = (id, title) => flight("renameIssue", [id, title]);
export const closeIssue = id => flight("closeIssue", [id]);
export const fetchComments = id => flight("fetchComments", [id]);
export const addComment = (id, author, text) => flight("addComment", [id, author, text]);
export const search = q => flight("search", [q]);
export const fetchItem = id => flight("fetchItem", [id]);
export const loadSettings = () => flight("loadSettings", []);
export const saveSettings = s => flight("saveSettings", [s]);
export const fetchLabels = id => flight("fetchLabels", [id]);
export const addLabel = (id, label) => flight("addLabel", [id, label]);
export const removeLabel = (id, label) => flight("removeLabel", [id, label]);
