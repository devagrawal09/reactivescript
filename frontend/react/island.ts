// The island level of the fallback ladder: a component the frontend refuses to lower becomes one plan v2 node that holds
// its compiled JS (plan/island.ts runs it with a hook shim). The node is marked, a plan that has one says so, and a
// runner without a JS host (the Rust runtime) refuses it with NEEDS_JS_HOST. An island only takes what the shim runs
// as React does: the synchronous hooks, plain async handlers and hosts declared in a .d.rx. Async transitions and
// useOptimistic (React's own scheduling of pending work), library hooks, props, and the rules of React that React
// Compiler reports stay refused.
import { parseSync, transformSync, type PluginObj } from "@babel/core";
import TransformTypeScript from "@babel/plugin-transform-typescript";
import TransformJsx from "@babel/plugin-transform-react-jsx";
import SyntaxTypeScript from "@babel/plugin-syntax-typescript";
import { parseDeclarations } from "../tsx/rx/compiler.ts";
import type { IslandView } from "../plan/island.ts";
import type { Host, Plan } from "../plan/resolve-v2.ts";
import type { ReactRefusal } from "./lower.ts";

type N = any;
/** React exports the shim implements (plan/island.ts). */
const SHIMMED = new Set(["useState", "useReducer", "useRef", "useMemo", "useCallback", "useEffect", "useLayoutEffect", "useInsertionEffect",
  "useContext", "createContext", "useId", "useDeferredValue", "startTransition", "useTransition", "Fragment", "createElement"]);
/** Refusals no island takes: React Compiler's rules of React, no component, an entry with props. */
const NOT_ISLAND = new Set(["REACT_COMPILER", "REACT_NOT_COMPONENT", "REACT_PROPS"]);

export type Island = { view: IslandView; hosts: Host[]; line: number };

/** The island for a refused component, or undefined when the refusal stands. `read` reads a host module's .d.rx. */
export function islandFor(source: string, filename: string, refusal: ReactRefusal, read: (path: string) => string | undefined, resolveDeclarations: (from: string) => string): Island | undefined {
  if (NOT_ISLAND.has(refusal.code)) return undefined;
  const ast = parseSync(source, { filename, babelrc: false, configFile: false, sourceType: "module", plugins: [[SyntaxTypeScript, { isTSX: true }]] }) as N;
  const imports: IslandView["imports"] = [], hosts: Host[] = [];
  const used = new Set<string>();
  const uses = (n: N): void => { if (!n || typeof n !== "object") return; if (Array.isArray(n)) return n.forEach(uses); if (n.type === "ImportDeclaration") return;
    if (n.type === "Identifier") used.add(n.name); for (const k of Object.keys(n)) if (k !== "loc") uses(n[k]); };
  uses(ast.program.body);
  let component: string | undefined;
  for (const s of ast.program.body) {
    if (s.type === "ImportDeclaration") {
      const names = s.specifiers.map((sp: N) => sp.type === "ImportSpecifier" ? sp.imported.name : undefined);
      if (names.includes(undefined)) return undefined;
      if (s.source.value === "react") { if (names.some((n: string) => !SHIMMED.has(n) && used.has(n))) return undefined; }
      else {
        const text = read(resolveDeclarations(s.source.value));
        const ds = text === undefined ? [] : parseDeclarations(text);
        for (const n of names) {
          const d = ds.find(d => d.kind === "fn" && d.name === n);
          if (!d || d.kind !== "fn") return undefined;
          hosts.push({ name: n, params: (d.ptypes ?? d.params.map(() => undefined)).map(t => (t ?? "number") as Host["params"][number]), returns: d.ret ?? "number" });
        }
      }
      imports.push({ from: s.source.value, names });
    } else if (s.type === "ExportDefaultDeclaration") {
      const f = s.declaration;
      if (f.type !== "FunctionDeclaration" || !f.id || f.params.length || f.async || f.generator) return undefined;
      component = f.id.name;
    } else if (s.type === "ExportNamedDeclaration") return undefined;
  }
  if (!component || asyncTransition(ast.program)) return undefined;
  const module = transformSync(source, {
    filename, babelrc: false, configFile: false, sourceType: "module", compact: false, comments: false,
    plugins: [[TransformTypeScript, { isTSX: true, onlyRemoveTypeImports: true }], [TransformJsx, { runtime: "classic", pragma: "__React.createElement", pragmaFrag: "__React.Fragment" }], linkModule],
  })!.code!;
  return { view: { kind: "island", component, module, imports, reasons: [refusal.code] }, hosts, line: refusal.line };
}

/** Whether any startTransition (React's, or useTransition's start) is given an async function. */
function asyncTransition(n: N): boolean {
  if (!n || typeof n !== "object") return false;
  if (Array.isArray(n)) return n.some(asyncTransition);
  if (n.type === "CallExpression" && n.arguments.some((a: N) => /Function/.test(a?.type ?? "") && a.async) &&
    (n.callee.type !== "Identifier" || /^start|Transition$/.test(n.callee.name))) return true;
  return Object.keys(n).some(k => k !== "loc" && asyncTransition(n[k]));
}

/** Imports become `__import(from)`, the default export `__exports.default`; JSX is compiled against `__React`. */
const linkModule = (): PluginObj => ({
  visitor: {
    Program: { exit(path) { path.unshiftContainer("body", parseStatement('const __React = __import("react");')); } },
    ImportDeclaration(path) {
      const s = path.node as N;
      const fields = s.specifiers.map((sp: N) => sp.imported.name === sp.local.name ? sp.local.name : sp.imported.name + ": " + sp.local.name).join(", ");
      path.replaceWith(parseStatement("const { " + fields + " } = __import(" + JSON.stringify(s.source.value) + ");"));
    },
    ExportDefaultDeclaration(path) {
      const f = (path.node as N).declaration;
      path.replaceWithMultiple([f, parseStatement("__exports.default = " + f.id.name + ";")]);
    },
  },
});
const parseStatement = (code: string): N => (parseSync(code, { babelrc: false, configFile: false, sourceType: "module" }) as N).program.body[0];

/** An island's plan: no sources, memos or actions; its markup is the island node. */
export function islandPlan(island: Island): Plan {
  return { version: 2, component: island.view.component, hosts: island.hosts, sources: [], memos: [], actions: [], markup: [island.view as never] };
}
