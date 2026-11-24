// createEval bound to @solidjs/web, the renderer this app's TSX compiles against, so evaluated RX renders into the
// same DOM and the same reactive graph as the host. Plans create elements with their events as static props, then
// append and insert children; @solidjs/web's own insert, createComponent and memo do the reactive parts.
import { createComponent, insert, memo } from '@solidjs/web';
import { bindEval } from '../../../frontend/eval/runtime.ts';
import type { Renderer } from '../../../frontend/plan/solid-plan.ts';

const isEvent = (name: string) => /^on[A-Z]/.test(name);

const renderer: Renderer = {
  createElement(tag, props) {
    const el = document.createElement(tag);
    // A form in evaluated code never navigates: Enter in its input clicks its first enabled button, and that's all.
    if (tag === 'form') el.addEventListener('submit', e => e.preventDefault());
    for (const [k, v] of Object.entries(props ?? {})) {
      if (isEvent(k) && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : String(v));
    }
    return el;
  },
  createTextNode: value => document.createTextNode(value),
  insertNode: (parent, node) => { (parent as Node).appendChild(node as Node); },
  insert: (parent, value, marker) => insert(parent as Element, value as never, marker as Node | undefined),
  createComponent: (c, props) => createComponent(c, props as never),
  memo: (fn, equal) => memo(fn, equal),
  // Plan v2.2 attributes. Form state is a property; writing the same value again would move the caret.
  setProp(node, name, value) {
    const el = node as HTMLElement & Record<string, unknown>;
    if (name === 'value' || name === 'checked') { if (el[name] !== value) el[name] = value; }
    else if (value === false || value == null) el.removeAttribute(name);
    else el.setAttribute(name, value === true ? '' : String(value));
  },
};

export const createEval = bindEval({ renderer });
export { compileOrThrow, EvalRefused } from '../../../frontend/eval/runtime.ts';
