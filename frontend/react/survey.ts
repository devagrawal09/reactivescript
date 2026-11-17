// Survey: run the React frontend over every component in a React app and say, per component, what the frontend does
// today (the real lowerer: accepted, or its first refusal) and every blocker a collect-all pass finds, each mapped to the
// rung of a fallback ladder that could accept it (snapshot, coarse memo, island) or to a frontend gap. Measurement only.
// Usage: survey.ts SRC_DIR OUT_JSON
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseSync, transformSync } from "@babel/core";
import traverseModule from "@babel/traverse";
import SyntaxTypeScript from "@babel/plugin-syntax-typescript";
import ReactCompiler from "babel-plugin-react-compiler";
import { lowerReact, ReactRefusal } from "./lower.ts";

type N = any;
const traverse: typeof traverseModule = (traverseModule as any).default ?? traverseModule;

/** Each collect-all blocker, and the rung that accepts it. "gap" is a frontend gap, not a React-semantics one. */
export const RUNG = {
  STALE_READ: "snapshot", READ_AFTER_WRITE: "snapshot", HELD_WRITE: "snapshot",
  UNDECIDED: "coarse",
  COMPILER: "island", SET_STATE_IN_RENDER: "island", EFFECT: "island", REF: "island", CONTEXT: "island", USE: "island",
  HOOK_REACT: "island", HOOK_CUSTOM: "island", HOOK_LIBRARY: "island", ASYNC_URGENT_WRITE: "island",
  PROPS: "island", CHILD_COMPONENT: "island", CLASS: "refused",
  ATTRIBUTE: "gap", MEMO_HOOK: "gap", REDUCER: "gap", RENDER_CONTROL: "gap", FALSY_RENDER: "gap",
} as const;
export type Blocker = keyof typeof RUNG;

const REACT_HOOKS_ISLAND: Record<string, Blocker> = {
  useEffect: "EFFECT", useLayoutEffect: "EFFECT", useInsertionEffect: "EFFECT", useEffectEvent: "EFFECT",
  useRef: "REF", useImperativeHandle: "REF", useContext: "CONTEXT", use: "USE",
  useMemo: "MEMO_HOOK", useCallback: "MEMO_HOOK", useReducer: "REDUCER",
};
const LOWERED = new Set(["useState", "useOptimistic", "startTransition"]);

const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  if (statSync(p).isDirectory()) return f === "node_modules" ? [] : files(p);
  return /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) ? [p] : [];
});

const parse = (source: string, filename: string) => parseSync(source, { filename, babelrc: false, configFile: false, sourceType: "module", plugins: [[SyntaxTypeScript, { isTSX: true }]] }) as N;

/** React Compiler's verdict per function, keyed by the function's start offset. */
function compilerVerdicts(source: string, filename: string) {
  const events: N[] = [];
  try {
    transformSync(source, { filename, babelrc: false, configFile: false, sourceType: "module", code: false,
      plugins: [[SyntaxTypeScript, { isTSX: true }], [ReactCompiler, { panicThreshold: "none", target: "19", logger: { logEvent: (_: string, e: N) => events.push(e) } }]] });
  } catch (e) { return { crashed: String((e as Error).message).split("\n")[0], byLine: new Map<number, N[]>() }; }
  const byLine = new Map<number, N[]>();
  for (const e of events) { const l = e.fnLoc?.start?.line; if (l) byLine.set(l, [...(byLine.get(l) ?? []), e]); }
  return { crashed: undefined, byLine };
}

export type Row = { file: string; name: string; line: number; today: string; blockers: Blocker[]; hooks: { custom: string[]; library: string[] }; reasons: string[] };

export function surveyFile(path: string, root: string): Row[] {
  const source = readFileSync(path, "utf8"), file = relative(root, path);
  let ast: N;
  try { ast = parse(source, path); } catch { return []; }
  const verdicts = compilerVerdicts(source, path);
  const imports = new Map<string, string>();
  for (const s of ast.program.body) if (s.type === "ImportDeclaration") for (const sp of s.specifiers) imports.set(sp.local.name, s.source.value);
  const hookKind = (name: string): "react" | "custom" | "library" => {
    const from = imports.get(name);
    if (from === undefined) return name === "use" || LOWERED.has(name) ? "react" : "custom"; // defined in this file
    if (from === "react") return "react";
    return /^(\.|~|@\/|@t3tools\/)/.test(from) ? "custom" : "library";
  };
  const importText = ast.program.body.filter((s: N) => s.type === "ImportDeclaration").map((s: N) => source.slice(s.start, s.end)).join("\n");
  const rows: Row[] = [];

  traverse(ast, {
    "FunctionDeclaration|FunctionExpression|ArrowFunctionExpression"(fp: N) {
      const fn = fp.node;
      // Name: the declaration, a variable, or a variable around memo(...)/forwardRef(...).
      let name = fn.id?.name, p: N = fp.parentPath;
      while (!name && p && p.node.type === "CallExpression" && /^(memo|forwardRef|React\.memo|React\.forwardRef)$/.test(source.slice(p.node.callee.start, p.node.callee.end))) p = p.parentPath;
      if (!name && p?.node.type === "VariableDeclarator" && p.node.id.type === "Identifier") name = p.node.id.name;
      if (!name || !/^[A-Z]/.test(name)) return;
      if (fp.findParent((q: N) => q.isFunction() && rows.some(r => r.line === q.node.loc.start.line))) return; // inner of a component
      let jsx = false;
      fp.traverse({ JSXElement() { jsx = true; }, JSXFragment() { jsx = true; } });
      if (!jsx) return;
      const blockers = new Set<Blocker>(), reasons: string[] = [], custom = new Set<string>(), library = new Set<string>();
      const add = (b: Blocker, why?: string) => { blockers.add(b); if (why) reasons.push(b + ": " + why); };

      // React Compiler on this function
      for (const e of verdicts.byLine.get(fn.loc.start.line) ?? []) if (e.kind === "CompileError" || e.kind === "PipelineError") {
        const d = e.detail ?? {}, o = d.options ?? d, reason = [o.reason, o.description].filter(Boolean).join(": ") || String(e.data ?? e.kind);
        add(/setState|set state/i.test(reason) ? "SET_STATE_IN_RENDER" : "COMPILER", reason.slice(0, 120));
      }
      if (fn.params.length) add("PROPS");

      // Render scope: the names an async handler or a later read would see as a snapshot.
      const renderNames = new Set<string>(), setterOf = new Map<string, string>();
      for (const prm of fn.params) for (const id of Object.keys(fp.scope.bindings)) if (fp.scope.bindings[id].kind === "param") renderNames.add(id);
      const body = fn.body.type === "BlockStatement" ? fn.body.body : [];
      for (const s of body) {
        if (s.type === "VariableDeclaration") {
          if (s.kind === "let" || s.kind === "var") add("UNDECIDED", "`" + s.kind + "` in render");
          for (const d of s.declarations) {
            const ids = d.id.type === "Identifier" ? [d.id] : d.id.type === "ArrayPattern" ? d.id.elements.filter(Boolean) : d.id.type === "ObjectPattern" ? d.id.properties.map((q: N) => q.value ?? q.argument) : [];
            for (const id of ids) if (id?.type === "Identifier") renderNames.add(id.name);
            if (d.init?.type === "CallExpression" && d.init.callee.name === "useState" && d.id.type === "ArrayPattern" && d.id.elements[1]?.type === "Identifier" && d.id.elements[0]?.type === "Identifier")
              setterOf.set(d.id.elements[1].name, d.id.elements[0].name);
          }
        } else if (s.type !== "ReturnStatement" || s !== body[body.length - 1]) {
          const hookCall = s.type === "ExpressionStatement" && s.expression.type === "CallExpression" && /^use([A-Z]|$)/.test(s.expression.callee.name ?? s.expression.callee.property?.name ?? "");
          if (s.type !== "FunctionDeclaration" && !hookCall) add("RENDER_CONTROL", s.type);
        }
      }

      fp.traverse({
        CallExpression(cp: N) {
          const c = cp.node.callee;
          const hook = c.type === "Identifier" ? c.name : c.type === "MemberExpression" && c.object.name === "React" ? c.property.name : undefined;
          if (!hook || !/^use([A-Z]|$)/.test(hook) || LOWERED.has(hook)) return;
          if (cp.getFunctionParent() !== fp) return; // hooks run in render only
          const kind = hookKind(hook);
          if (kind === "react") add(REACT_HOOKS_ISLAND[hook] ?? "HOOK_REACT");
          else if (kind === "custom") { add("HOOK_CUSTOM"); custom.add(hook); }
          else { add("HOOK_LIBRARY"); library.add(imports.get(hook) + ":" + hook); }
        },
        JSXOpeningElement(jp: N) {
          const n = jp.node.name;
          if (n.type !== "JSXIdentifier" || /^[A-Z]/.test(n.name)) add("CHILD_COMPONENT");
          for (const a of jp.node.attributes) if (a.type !== "JSXAttribute" || !["onClick", "key"].includes(a.name.name)) add("ATTRIBUTE");
        },
        LogicalExpression(lp: N) {
          if (lp.node.operator !== "&&" || !lp.parentPath.isJSXExpressionContainer()) return;
          const l = lp.node.left;
          const bool = l.type === "BooleanLiteral" || l.type === "UnaryExpression" && l.operator === "!" || l.type === "BinaryExpression" && /^(===|!==|<|>|<=|>=)$/.test(l.operator);
          if (!bool) add("FALSY_RENDER");
        },
        Function(hp: N) {
          // Handler timing: reads after an await, reads after the handler's own write, writes before an await.
          const h = hp.node;
          const awaits: number[] = [], writes: { at: number; state: string }[] = [], reads: { at: number; name: string }[] = [];
          let transition = false;
          const call = hp.parentPath?.node;
          if (call?.type === "CallExpression" && call.callee.name === "startTransition") transition = true;
          hp.traverse({
            Function(inner: N) { inner.skip(); },
            AwaitExpression(a: N) { awaits.push(a.node.start); },
            CallExpression(c: N) { const s = c.node.callee.type === "Identifier" && setterOf.get(c.node.callee.name); if (s) writes.push({ at: c.node.end, state: s }); },
            Identifier(i: N) {
              if (!i.isReferencedIdentifier() || !renderNames.has(i.node.name)) return;
              const b = i.scope.getBinding(i.node.name);
              if (b && b.scope === fp.scope) reads.push({ at: i.node.start, name: i.node.name });
            },
          });
          if (awaits.length) {
            const first = Math.min(...awaits);
            if (reads.some(r => r.at > first)) add("STALE_READ", reads.find(r => r.at > first)!.name);
            if (writes.length && !transition) add("ASYNC_URGENT_WRITE");
            if (transition && writes.some(w => w.at < first)) add("HELD_WRITE");
          }
          for (const w of writes) if (reads.some(r => r.name === w.state && r.at > w.at)) { add("READ_AFTER_WRITE", w.state); break; }
        },
      });

      // The real frontend, on the component alone as a module's default export.
      let today = "accepted";
      const params = fn.params.map((q: N) => source.slice(q.start, q.end)).join(", ");
      const bodyText = fn.body.type === "BlockStatement" ? source.slice(fn.body.start, fn.body.end) : "{ return " + source.slice(fn.body.start, fn.body.end) + "; }";
      try { lowerReact(importText + "\nexport default function " + name + "(" + params + ") " + bodyText + "\n", file); }
      catch (e) { today = e instanceof ReactRefusal ? e.code : "ERROR " + String((e as Error).message).split("\n")[0].slice(0, 80); }

      rows.push({ file, name, line: fn.loc.start.line, today, blockers: [...blockers], hooks: { custom: [...custom], library: [...library] }, reasons });
    },
  });
  return rows;
}

if (process.argv[1]?.endsWith("survey.ts")) {
  const [dir, out] = process.argv.slice(2);
  const quiet = console.warn; console.warn = () => {};
  const rows = files(dir).flatMap(f => surveyFile(f, dir));
  console.warn = quiet;
  writeFileSync(out, JSON.stringify(rows, null, 1));
  console.log(rows.length, "components");
}
