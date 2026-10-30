export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** an error that belongs to one issue: shown only while that issue is selected */
export type IssueError = { issueId: number; message: string };
