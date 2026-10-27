export type Issue = { id: number; title: string; assignee: string | null };
export type IssueDetail = { id: number; title: string; body: string };
export function fetchIssues(filter: "open" | "closed"): Promise<Issue[]>;
export function fetchIssue(id: number): Promise<IssueDetail | null>;
export function assign(id: number, user: string): Promise<{ id: number; assignee: string }>;
export type Comment = { author: string; text: string };
export function fetchComments(id: number): Promise<Comment[]>;
export function addComment(id: number, author: string, text: string): Promise<Comment>;
