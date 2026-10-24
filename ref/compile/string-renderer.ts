// The test renderer: @solidjs/universal over a tree of plain objects, whose frame is its text. Compiled JSX for the
// "universal" target (compile/jsx.ts) imports its helpers and Solid's control flow from this module.
import { createRenderer } from "@solidjs/universal";
export { Show, For, Switch, Match, Loading, Errored, Repeat, Reveal } from "solid-js";

type N = { kind: "el"; tag: string; children: N[]; parent?: N; props: Record<string, unknown> } | { kind: "text"; text: string; parent?: N };
const stringNodes = {
  createElement: (tag: string) => ({ kind: "el", tag, children: [], props: {} }) as N,
  createTextNode: (text: string) => ({ kind: "text", text }) as N,
  replaceText: (n: N, v: string) => { (n as Extract<N, { kind: "text" }>).text = v; },
  isTextNode: (n: N) => n.kind === "text",
  setProperty: (n: N, k: string, v: unknown) => { if (n.kind === "el") n.props[k] = v; },
  insertNode: (p: N, n: N, anchor?: N) => { if (p.kind !== "el") return; if (n.parent) { const q = n.parent as Extract<N, { kind: "el" }>; const j = q.children.indexOf(n); if (j >= 0) q.children.splice(j, 1); } const i = anchor ? p.children.indexOf(anchor) : -1; if (i < 0) p.children.push(n); else p.children.splice(i, 0, n); n.parent = p; },
  removeNode: (p: N, n: N) => { if (p.kind !== "el") return; const i = p.children.indexOf(n); if (i >= 0) p.children.splice(i, 1); n.parent = undefined; },
  getParentNode: (n: N) => n.parent,
  getFirstChild: (n: N) => (n.kind === "el" ? n.children[0] : undefined),
  getNextSibling: (n: N) => { const p = n.parent; if (!p || p.kind !== "el") return undefined; return p.children[p.children.indexOf(n) + 1]; },
};
export const R = createRenderer<N>(stringNodes as never);
export const { render, effect, memo, createComponent, createElement, createTextNode, insertNode, insert, spread, setProp, mergeProps, applyRef, ref } = R as any;
export const serialize = (n: N): string => n.kind === "text" ? n.text : n.children.map(serialize).join("");
