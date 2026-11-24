export const pending = [];

let todos = [
  { id: "t1", title: "Draft the spec", done: false },
  { id: "t2", title: "Review the PR", done: true },
  { id: "t3", title: "Ship the fix", done: false },
  { id: "t4", title: "Write the notes", done: false },
];

function later(value) {
  return new Promise((resolve, reject) => {
    pending.push({ resolve, reject, value });
  });
}

function snapshot() {
  return todos.map((t) => ({ ...t }));
}

export function loadTodos() {
  return later(snapshot());
}

export function addTodo(id, title) {
  todos = [...todos, { id, title, done: false }];
  return later(snapshot());
}

export function toggleTodo(id, done) {
  todos = todos.map((t) => (t.id === id ? { ...t, done } : t));
  return later(snapshot());
}

export function removeTodo(id) {
  todos = todos.filter((t) => t.id !== id);
  return later(snapshot());
}
