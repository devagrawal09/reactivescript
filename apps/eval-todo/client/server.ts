// A fake server in the page: it owns the truth (`db`), answers after a delay, and fails when told to. The RX code
// only reads `db` and calls the three functions; it never writes `db` itself.
import { createSignal, createStore } from 'solid-js';
import type { Todo } from '../src/interface.ts';

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
    setLog(l => [{ id, call, state: 'pending' as const }, ...l].slice(0, 12));
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

  return { db, delay, setDelay, failing, setFailing, log, addTodo, saveDone, removeTodo };
}
