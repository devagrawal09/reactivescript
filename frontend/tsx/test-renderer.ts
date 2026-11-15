// The pinned Solid compiler passes static props to createElement. The shared reference
// string renderer currently ignores that argument; bridge it only in this test harness.
export * from "./rx/string-renderer.ts";
import { createElement as base, setProp } from "./rx/string-renderer.ts";
export function createElement(tag: string, props: Record<string, unknown> = {}) {
  const node = base(tag);
  for (const [name, value] of Object.entries(props)) setProp(node, name, value);
  return node;
}
/** The reference renderer has no removeNode export; plan islands (plan/island.ts) reconcile their own children. */
export function removeNode(parent: { kind: string; children?: unknown[] }, node: { parent?: unknown }) {
  const i = parent.children?.indexOf(node) ?? -1;
  if (i >= 0) parent.children!.splice(i, 1);
  node.parent = undefined;
}
