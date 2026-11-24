// One editable RX program: what's typed (draft), what's running (code), and the checker's verdict on the draft.
// The draft is checked in a worker once typing pauses; it runs when the checker accepts it. Until then the last good
// version keeps running.
import { createSignal } from 'solid-js';

export type Diagnostic = { code: string; message: string; line?: number };

// One checker worker for the page. A check that doesn't answer in time is a parser hang: the worker is replaced.
const TIMEOUT_MS = 2000;
let worker: Worker | undefined, nextId = 0;
const waiting = new Map<number, (ds: Diagnostic[]) => void>();
const spawn = () => {
  const w = new Worker('/check.js', { type: 'module' });
  w.onmessage = (ev: MessageEvent<{ id: number; diagnostics: Diagnostic[] }>) => {
    waiting.get(ev.data.id)?.(ev.data.diagnostics);
    waiting.delete(ev.data.id);
  };
  return w;
};
function check(code: string, iface: string): Promise<Diagnostic[]> {
  worker ??= spawn();
  const id = nextId++, w = worker;
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      if (!waiting.delete(id)) return;
      w.terminate();
      if (worker === w) worker = undefined;
      // Everything else this worker was holding is lost with it: ask again.
      for (const [other, done] of [...waiting]) { waiting.delete(other); done([{ code: 'RETRY', message: 'checker restarted' }]); }
      resolve([{ code: 'HANG', message: 'the RX parser did not finish on this text (an unclosed tag at the end hangs it); keep typing' }]);
    }, TIMEOUT_MS);
    waiting.set(id, ds => { clearTimeout(timer); resolve(ds); });
    w.postMessage({ id, code, iface });
  });
}

export function createProgram(initial: string, iface: string, delayMs = 300) {
  const [draft, setDraft] = createSignal(initial);
  const [code, setCode] = createSignal(initial);
  const [version, setVersion] = createSignal(1);
  const [diagnostics, setDiagnostics] = createSignal<Diagnostic[]>([]);
  const problems = () => diagnostics().map(d => d.code + (d.line !== undefined ? ' line ' + d.line : '') + ': ' + d.message).join('\n');

  let latest = initial, timer: ReturnType<typeof setTimeout> | undefined;
  const run = (text: string) => {
    // New code replaces the evaluated subtree, textarea included. If the user is typing in it, put the caret back in
    // the new one, in the same panel.
    const active = document.activeElement;
    const panel = active instanceof HTMLTextAreaElement ? active.closest('[data-eval]') : null;
    const caret = panel ? [(active as HTMLTextAreaElement).selectionStart, (active as HTMLTextAreaElement).selectionEnd, (active as HTMLTextAreaElement).scrollTop] : null;
    setCode(text);
    setVersion(v => v + 1);
    if (panel && caret) requestAnimationFrame(() => {
      const t = panel.querySelector('textarea');
      if (!t || t === active) return;
      t.focus();
      t.setSelectionRange(caret[0], caret[1]);
      t.scrollTop = caret[2];
    });
  };
  const settle = async () => {
    const text = latest;
    const ds = await check(text, iface);
    if (text !== latest) return;            // typed again meanwhile: that text gets its own check
    setDiagnostics(ds);
    if (!ds.length && text !== code()) run(text);
  };
  const edit = (text: string) => {
    latest = text;
    setDraft(text);
    clearTimeout(timer);
    timer = setTimeout(settle, delayMs);
  };
  const reset = () => edit(initial);

  return { draft, code, version, diagnostics, problems, edit, reset };
}
