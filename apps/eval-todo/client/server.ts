// A fake server in the page: it owns the truth (`db`), answers after a delay, and fails when told to. The RX code
// only reads `db` and calls the three functions; it never writes `db` itself.
import { createSignal, createStore } from 'solid-js';
import type { Item, Todo } from '../src/interface.ts';

export type LogEntry = { id: number; call: string; state: 'pending' | 'ok' | 'failed' };

export function createServer() {
  const [db, setDb] = createStore<{ list: Todo[] }>({ list: [
    { id: 1, text: 'try eval', done: true },
    { id: 2, text: 'write the todo app in RX', done: false },
  ] });
  const [delay, setDelay] = createSignal(900);
  const [failing, setFailing] = createSignal(false);
  const [log, setLog] = createSignal<LogEntry[]>([]);
  let nextId = 3, nextReq = 1;

  // One request: logged as pending, then after the delay either rejected or applied to `db` and resolved.
  const request = (call: string, apply: () => void) => new Promise<string>((resolve, reject) => {
    const id = nextReq++, fail = failing();
    // Called inside an RX action, so a write here would be held with the action's own writes until it settles (Solid
    // 2 transitions). The log is the host's, not the action's: write it outside.
    queueMicrotask(() => setLog(l => [{ id, call, state: 'pending' as const }, ...l].slice(0, 12)));
    const settle = (state: LogEntry['state']) => setLog(l => l.map(e => e.id === id ? { ...e, state } : e));
    setTimeout(() => {
      if (fail) { settle('failed'); reject(new Error(call + ' failed')); return; }
      apply();
      settle('ok');
      resolve('ok');
    }, delay());
  });

  const addTodo = (text: string) => request('addTodo(' + JSON.stringify(text) + ')', () => {
    const id = nextId++;
    setDb(s => { s.list.push({ id, text, done: false }); });
  });
  const saveDone = (id: number, done: boolean) => request('saveDone(' + id + ', ' + done + ')', () => {
    setDb(s => { const t = s.list.find(x => x.id === id); if (t) t.done = done; });
  });
  const removeTodo = (id: number) => request('removeTodo(' + id + ')', () => {
    setDb(s => { const i = s.list.findIndex(x => x.id === id); if (i >= 0) s.list.splice(i, 1); });
  });

  // The inventory: kept sorted by name, each item with its search index (`words`, see src/interface.ts).
  const index = (name: string) => [...new Set(name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).flatMap(w => [...w].map((_, i) => w.slice(0, i + 1))))];
  const item = (id: number, name: string, category: string, qty: number, active: boolean): Item => ({ id, name, category, qty, active, words: index(name) });
  const byName = (a: Item, b: Item) => a.name.localeCompare(b.name);
  const [inv, setInv] = createStore<{ items: Item[] }>({ items: [
    item(1, 'Claw hammer', 'tools', 12, true), item(2, 'Hex bolt M6', 'parts', 40, true),
    item(3, 'Duct tape', 'supplies', 3, true), item(4, 'Cordless drill', 'tools', 4, true),
    item(5, 'Wood glue', 'supplies', 9, false), item(6, 'Spring washer', 'parts', 57, true),
    item(7, 'Tape measure', 'tools', 0, true),
  ].sort(byName) });
  let nextItem = 8;
  const addItem = (name: string, category: string, qty: number, active: boolean) =>
    request('addItem(' + JSON.stringify(name) + ', ' + category + ', ' + qty + ', ' + active + ')', () => {
      const id = nextItem++;
      setInv(s => { s.items.push(item(id, name, category, qty, active)); s.items.sort(byName); });
    });
  const updateItem = (id: number, name: string, category: string, qty: number, active: boolean) =>
    request('updateItem(' + id + ', ' + JSON.stringify(name) + ', ' + category + ', ' + qty + ', ' + active + ')', () => {
      setInv(s => { const i = s.items.findIndex(x => x.id === id); if (i >= 0) s.items[i] = item(id, name, category, qty, active); s.items.sort(byName); });
    });
  const removeItem = (id: number) => request('removeItem(' + id + ')', () => {
    setInv(s => { const i = s.items.findIndex(x => x.id === id); if (i >= 0) s.items.splice(i, 1); });
  });

  return { inv, addItem, updateItem, removeItem, db, delay, setDelay, failing, setFailing, log, addTodo, saveDone, removeTodo };
}
