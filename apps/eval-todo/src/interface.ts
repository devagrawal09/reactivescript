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

// The inventory admin's interface. `inv.items` is in the server's order (by name). `words` is the server's search index
// for an item: every lowercase prefix of every word of its name, so the code can search with `==` (it has no
// substring test).
export const INVENTORY_INTERFACE = [
  'store inv: { items: { id: number, name: string, category: string, qty: number, active: boolean, words: string[] }[] }',
  'host addItem(string, string, number, boolean): string',
  'host updateItem(number, string, string, number, boolean): string',
  'host removeItem(number): string',
].join('\n');

export type Item = { id: number; name: string; category: string; qty: number; active: boolean; words: string[] };
export type Todo = { id: number; text: string; done: boolean };
