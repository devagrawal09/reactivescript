// Solid 2's universal renderer over the browser DOM. Plans pass events as static props (onClick), which become
// listeners; other props become attributes.
import { createRenderer } from '@solidjs/universal';

const isEvent = (name: string) => /^on[A-Z]/.test(name);
const setProperty = (node: Node, name: string, value: unknown, prev?: unknown) => {
  const el = node as HTMLElement;
  if (isEvent(name)) {
    const type = name.slice(2).toLowerCase();
    if (typeof prev === 'function') el.removeEventListener(type, prev as EventListener);
    if (typeof value === 'function') el.addEventListener(type, value as EventListener);
  } else if (value === false || value == null) el.removeAttribute(name === 'className' ? 'class' : name);
  else el.setAttribute(name === 'className' ? 'class' : name, value === true ? '' : String(value));
};

export const renderer = createRenderer<Node>({
  createElement(tag, props) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props ?? {})) setProperty(el, k, v);
    return el;
  },
  createTextNode: value => document.createTextNode(value),
  replaceText: (node, value) => { node.textContent = value; },
  isTextNode: node => node.nodeType === 3,
  setProperty,
  insertNode: (parent, node, anchor) => { parent.insertBefore(node, anchor ?? null); },
  removeNode: (parent, node) => { if (node.parentNode === parent) parent.removeChild(node); },
  getParentNode: node => node.parentNode ?? undefined,
  getFirstChild: node => node.firstChild ?? undefined,
  getNextSibling: node => node.nextSibling ?? undefined,
});

type Child = Node | string | number | (() => unknown) | null | undefined | false | Child[];
/** A small element builder for the page's own chrome: function children are reactive inserts. */
export function h(tag: string, props: Record<string, unknown> = {}, ...children: Child[]): Node {
  const statics: Record<string, unknown> = {}, dynamic: [string, () => unknown][] = [];
  for (const [k, v] of Object.entries(props)) (typeof v === 'function' && !isEvent(k) ? dynamic.push([k, v as () => unknown]) : statics[k] = v);
  const el = renderer.createElement(tag, statics);
  for (const [k, f] of dynamic) renderer.effect(() => f(), (v, prev) => setProperty(el, k, v, prev));
  for (const c of children.flat(Infinity as 1) as Child[]) {
    if (c === null || c === undefined || c === false) continue;
    // A reactive child gets its own marker, so it never replaces its static siblings.
    if (typeof c === 'function') { const marker = document.createTextNode(''); renderer.insertNode(el, marker); renderer.insert(el, c, marker); }
    else renderer.insertNode(el, typeof c === 'object' ? c : renderer.createTextNode(String(c)));
  }
  return el;
}
