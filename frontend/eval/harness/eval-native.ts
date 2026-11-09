// The `reactivescript-tsx/eval` a native leg's compiled TSX imports (docs/EVAL.md): createEval bound to the leg's
// recording host (plan/fuzz/host.ts), created before any compiled module is imported, with each evaluated action's
// call reported to the host log as the plan consumer reports it.
import { bindEval } from '../runtime.ts';
const host = (globalThis as { __planFuzzHost?: { R: never; watchAction: (name: string, run: Promise<unknown>) => void } }).__planFuzzHost;
if (!host) throw new Error('the recording host is created before compiled code is imported');
export const createEval = bindEval({ renderer: host.R, onAction: host.watchAction });
