// The host: a Solid 2 app on @solidjs/web. Everything inside the dashed panels is RX evaluated live with
// createEval(() => code(), { bindings }): the todo app, and the code editor (src/editor.rx) that edits the todo app's
// code and, in the last panel, its own. The host owns only the fake server and the programs' text.
import { Errored, For } from 'solid-js';
import { createEval } from './eval.ts';
import { createProgram } from './program.ts';
import { createServer } from './server.ts';
import { EDITOR_INTERFACE, INTERFACE } from '../src/interface.ts';
import TODO_RX from '../src/todo.rx';
import EDITOR_RX from '../src/editor.rx';

type Diagnostic = { code: string; message: string };
const diagnosticsOf = (err: unknown): Diagnostic[] => {
  const e = err as { diagnostics?: Diagnostic[]; message?: string };
  return Array.isArray(e?.diagnostics) ? e.diagnostics : [{ code: 'RUNTIME', message: String(e?.message ?? err) }];
};

/** A runtime failure of evaluated code, with a retry. Refusals never get here: only accepted code runs. */
const Boundary = (props: { children: unknown }) => (
  <Errored fallback={(err, retry) => (
    <div class="errors">
      <b>Runtime error</b>
      <For each={diagnosticsOf(err())}>{d => <p>{d.code}: {d.message}</p>}</For>
      <button onClick={() => retry()}>retry</button>
    </div>
  )}>{props.children}</Errored>
);

export default function App() {
  const server = createServer();
  const todo = createProgram(TODO_RX, INTERFACE);
  const editor = createProgram(EDITOR_RX, EDITOR_INTERFACE);

  const todoBindings = { db: server.db, addTodo: server.addTodo, saveDone: server.saveDone, removeTodo: server.removeTodo };
  // The same editor code, bound to two programs: the todo app's text, and its own.
  const editorFor = (title: string, p: ReturnType<typeof createProgram>) =>
    ({ title: () => title, code: p.draft, problems: p.problems, version: p.version, edit: p.edit });

  return (
    <main>
      <header>
        <h1>RX, evaluated live into Solid 2</h1>
        <p class="muted">
          Dashed panels are ReactiveScript, run with <code>createEval(() =&gt; code(), {'{'} …bindings {'}'})</code>.
          The editor is RX too. Code runs once the checker accepts it; until then the last good version stays.
        </p>
      </header>

      <section class="app">
        <h3>todo.rx running <span class="muted">(v{todo.version()})</span></h3>
        <div class="eval" data-eval="todo-app">
          <Boundary>{createEval(() => todo.code(), todoBindings, { interface: INTERFACE })}</Boundary>
        </div>
      </section>

      <section class="server">
        <h3>Fake server (host)</h3>
        <label>
          latency <input type="range" min="0" max="3000" step="100" value={server.delay()}
            onInput={e => server.setDelay(Number(e.currentTarget.value))} /> {server.delay()} ms
        </label>
        <label class="fail">
          <input type="checkbox" checked={server.failing()} onChange={e => server.setFailing(e.currentTarget.checked)} />
          fail every request (watch the guesses roll back)
        </label>
        <h4>Truth (db.list)</h4>
        <ul class="truth">
          <For each={server.db.list}>{t => <li class={{ done: t.done }}>#{t.id} {t.text}</li>}</For>
        </ul>
        <h4>Requests</h4>
        <ul class="log">
          <For each={server.log()}>{e => <li class={e.state}>{e.call} <b>{e.state}</b></li>}</For>
        </ul>
      </section>

      <section class="wide">
        <h3>Editing todo.rx <span class="muted">with editor.rx v{editor.version()}</span>
          <button class="reset" onClick={() => todo.reset()}>reset todo.rx</button></h3>
        <div class="eval rx-editor" data-eval="todo-editor">
          <Boundary>{createEval(() => editor.code(), editorFor('todo.rx', todo), { interface: EDITOR_INTERFACE })}</Boundary>
        </div>
      </section>

      <section class="wide self">
        <h3>editor.rx editing itself <span class="muted">— every accepted edit rebuilds this editor (and the one above)</span>
          <button class="reset" onClick={() => editor.reset()}>reset editor.rx</button></h3>
        <div class="eval rx-editor" data-eval="self-editor">
          <Boundary>{createEval(() => editor.code(), editorFor('editor.rx', editor), { interface: EDITOR_INTERFACE })}</Boundary>
        </div>
        <details>
          <summary>binding interfaces</summary>
          <pre>{'// todo.rx\n' + INTERFACE + '\n\n// editor.rx\n' + EDITOR_INTERFACE}</pre>
        </details>
      </section>
    </main>
  );
}
