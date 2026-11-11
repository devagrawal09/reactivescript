// The demo's bindings: a counter, a todo store and a slow fake fetch. They live outside every evaluation, so they keep
// their state when the code changes; the evaluated code's own state starts fresh with each new code.
import { action, createSignal, createStore } from 'solid-js';

export function createBindings(delayMs = 700) {
  const [count, setCount] = createSignal(0);
  const increment = action(function* () { setCount(c => c + 1); });

  let nextId = 3;
  const [todos, setTodos] = createStore({ list: [
    { id: 1, text: 'try eval', done: true },
    { id: 2, text: 'post some code', done: false },
  ] });
  const addTodo = action(function* (text: string) {
    const id = nextId++;
    setTodos(s => { s.list.push({ id, text, done: false }); });
  });
  const toggleTodo = action(function* (id: number) {
    setTodos(s => { const t = s.list.find(x => x.id === id); if (t) t.done = !t.done; });
  });

  const NAMES = ['Ada', 'Grace', 'Linus', 'Margaret', 'Ryan'];
  const fetchUser = (id: number) => new Promise<{ id: number; name: string }>(resolve =>
    setTimeout(() => resolve({ id, name: NAMES[Math.abs(id) % NAMES.length] }), delayMs));

  return { count, increment, todos, addTodo, toggleTodo, fetchUser };
}
