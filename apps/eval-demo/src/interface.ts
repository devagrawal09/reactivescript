// The bindings the demo page passes to every evaluation. Posted code sees these names and nothing else.
export const INTERFACE = [
  'read count: number',
  'action increment()',
  'store todos: { list: { id: number, text: string, done: boolean }[] }',
  'action addTodo(string)',
  'action toggleTodo(number)',
  'pure host fetchUser(number): { id: number, name: string }',
].join('\n');

export type Syntax = 'rx' | 'tsx';
export type ValueType = 'number' | 'string' | 'boolean';
