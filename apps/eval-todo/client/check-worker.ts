// Runs the eval checker off the main thread. Half-typed code can hang the pinned RX parser (an unclosed element at
// the end of the input loops forever), so the page asks here with a timeout and never compiles unchecked text itself.
import { compileEval } from '../../../frontend/eval/compile.ts';

self.onmessage = (ev: MessageEvent<{ id: number; code: string; iface: string }>) => {
  const { id, code, iface } = ev.data;
  const r = compileEval({ code, interface: iface });
  self.postMessage({ id, diagnostics: r.ok ? [] : r.diagnostics });
};
