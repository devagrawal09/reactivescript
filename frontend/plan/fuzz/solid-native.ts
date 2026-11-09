// The `solid-js` a native leg's compiled TSX imports: Solid itself, with `action` reporting each call's promise to the
// recording host (host.ts watchAction), so the native log has the ['action', name, outcome] entries the plan
// consumers log. Names are the program's declared actions in creation order, which is declaration order, or the
// generator's own name when it has one.
export * from 'solid-js';
import { action as solidAction } from 'solid-js';
type Wrap = (run: (...a: unknown[]) => Promise<unknown>, name?: string) => (...a: unknown[]) => Promise<unknown>;
export function action(...args: unknown[]) {
  const wrap = (globalThis as { __planFuzzAction?: Wrap }).__planFuzzAction;
  if (!wrap) throw new Error('the plan-fuzz action hook is installed before compiled code is imported');
  // A named generator (`action(function* claim() {…})`, the eval twins) names its action; an anonymous one is named by
  // creation order.
  const name = typeof args[0] === 'function' && (args[0] as { name: string }).name || undefined;
  return wrap((solidAction as (...a: unknown[]) => (...a: unknown[]) => Promise<unknown>)(...args), name);
}
