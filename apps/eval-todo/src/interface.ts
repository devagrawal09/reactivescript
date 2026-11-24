// The binding interface the todo code is checked against: the only names it can see. `db` is the server's list
// (read only: the code changes it only by calling the server); the three hosts are the server calls.
export const INTERFACE = [
  'store db: { list: { id: number, text: string, done: boolean }[] }',
  'host addTodo(string): string',
  'host saveDone(number, boolean): string',
  'host removeTodo(number): string',
].join('\n');

// The editor's interface: the text it edits, the checker's verdict on it, and one way to change it.
export const EDITOR_INTERFACE = [
  'read title: string',
  'read code: string',
  'read problems: string',
  'read version: number',
  'action edit(string)',
].join('\n');

export type Todo = { id: number; text: string; done: boolean };
