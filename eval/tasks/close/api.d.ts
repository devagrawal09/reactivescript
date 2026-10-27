export type Issue = { id: number; title: string; assignee: string | null };
export type IssueDetail = { id: number; title: string; body: string };
export function fetchIssues(filter: "open" | "closed"): Promise<Issue[]>;
export function fetchIssue(id: number): Promise<IssueDetail | null>;
export function assign(id: number, user: string): Promise<{ id: number; assignee: string }>;
export function closeIssue(id: number): Promise<{ id: number }>;
