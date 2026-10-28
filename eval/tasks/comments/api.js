import { flight } from "./flights.js";

export const fetchIssues = filter => flight("fetchIssues", [filter]);
export const fetchIssue = id => flight("fetchIssue", [id]);
export const assign = (id, user) => flight("assign", [id, user]);
export const fetchComments = id => flight("fetchComments", [id]);
export const addComment = (id, author, text) => flight("addComment", [id, author, text]);
