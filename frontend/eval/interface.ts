// An eval site's binding interface (docs/EVAL.md, "Bindings and their types"): the names evaluated code may use, what
// each is, and its type, as an RX-style declaration string. The checker derives it from the enclosing component's plan
// (plan/types.ts) and writes it into the plan's eval node (and, for compiled TSX, into the createEval call); a plugin
// host may write it by hand. One declaration per line:
//
//   read count: number                         a value: a signal, memo or optimistic source (TSX `count()`)
//   store issues: { list: { id: number }[] }   a store root, read by path (TSX `issues.list`)
//   action claim(number)                       an action: callable from a handler, never awaited
//   host assignIssue(number): string           a host function: awaited in an action of the evaluated code
//
// Types: number (an integer), string, boolean, T[], { key: T, … }. Parameter names are allowed (`action claim(id:
// number)`) and dropped. The canonical form (printInterface) keeps declaration order and prints no names.
import { printType, sameType, scalarType, type Type, type NameType } from '../plan/types.ts';
import type { HostType } from '../plan/resolve-v2.ts';

export type BindingDecl =
  | { name: string; kind: 'read' | 'store'; type: Type }
  | { name: string; kind: 'action'; params: HostType[] }
  | { name: string; kind: 'host'; params: HostType[]; returns: HostType };

const SCALAR = new Set(['number', 'string', 'boolean']);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class InterfaceError extends Error {}

/** Parses an interface string. Throws InterfaceError on anything outside the grammar above. */
export function parseInterface(text: string): BindingDecl[] {
  const out: BindingDecl[] = [];
  const lines = text.split(/\n|;/).map(l => l.trim()).filter(l => l && !l.startsWith('//'));
  for (const line of lines) {
    const m = /^(read|store|action|host)\s+([A-Za-z_$][\w$]*)\s*(.*)$/.exec(line);
    if (!m) throw new InterfaceError('interface: expected `read|store|action|host name …`, got ' + JSON.stringify(line));
    const kind = m[1] as BindingDecl['kind'], name = m[2], rest = m[3];
    if (!IDENT.test(name)) throw new InterfaceError('interface: binding names are identifiers without `$`: ' + name);
    if (out.some(d => d.name === name)) throw new InterfaceError('interface: ' + name + ' is declared twice');
    if (kind === 'read' || kind === 'store') {
      const t = /^:\s*(.+)$/.exec(rest);
      if (!t) throw new InterfaceError('interface: ' + kind + ' ' + name + ' needs `: type`');
      const type = parseType(t[1]);
      if (kind === 'store' && type.k !== 'record' && type.k !== 'array') throw new InterfaceError('interface: store ' + name + ' is a record or an array');
      out.push({ name, kind, type });
    } else {
      const p = /^\(([^)]*)\)\s*(?::\s*(\w+))?$/.exec(rest);
      if (!p) throw new InterfaceError('interface: ' + kind + ' ' + name + ' needs `(types)`' + (kind === 'host' ? ' and `: type`' : ''));
      const params = p[1].trim() ? p[1].split(',').map(x => {
        const t = x.includes(':') ? x.slice(x.indexOf(':') + 1).trim() : x.trim();
        if (!SCALAR.has(t)) throw new InterfaceError('interface: ' + name + ' parameters are number, string or boolean, not ' + t);
        return t as HostType;
      }) : [];
      if (kind === 'action') {
        if (p[2]) throw new InterfaceError('interface: an action returns nothing a caller sees: ' + name);
        out.push({ name, kind, params });
      } else {
        if (!p[2] || !SCALAR.has(p[2])) throw new InterfaceError('interface: host ' + name + ' returns number, string or boolean');
        out.push({ name, kind, params, returns: p[2] as HostType });
      }
    }
  }
  return out;
}

export function parseType(text: string): Type {
  let i = 0;
  const s = text.trim();
  const ws = () => { while (/\s/.test(s[i] ?? '')) i++; };
  const one = (): Type => {
    ws();
    let t: Type;
    if (s[i] === '{') {
      i++;
      const fields: [string, Type][] = [];
      ws();
      while (s[i] !== '}') {
        const k = /^[A-Za-z_$][\w$]*/.exec(s.slice(i));
        if (!k) throw new InterfaceError('type: field name expected in ' + JSON.stringify(text));
        i += k[0].length; ws();
        if (s[i++] !== ':') throw new InterfaceError('type: `:` expected in ' + JSON.stringify(text));
        if (fields.some(([n]) => n === k[0])) throw new InterfaceError('type: field ' + k[0] + ' twice');
        fields.push([k[0], one()]);
        ws();
        if (s[i] === ',' || s[i] === ';') { i++; ws(); }
        else if (s[i] !== '}') throw new InterfaceError('type: `,` or `}` expected in ' + JSON.stringify(text));
      }
      i++;
      t = { k: 'record', fields };
    } else if (s[i] === '(') {
      i++; t = one(); ws();
      if (s[i++] !== ')') throw new InterfaceError('type: `)` expected in ' + JSON.stringify(text));
    } else {
      const w = /^(number|string|boolean)\b/.exec(s.slice(i));
      if (!w) throw new InterfaceError('type: number, string, boolean, T[] or { … } expected in ' + JSON.stringify(text));
      i += w[0].length;
      t = scalarType(w[0] as HostType);
    }
    ws();
    while (s.slice(i, i + 2) === '[]') { i += 2; t = { k: 'array', item: t }; ws(); }
    return t;
  };
  const t = one();
  ws();
  if (i !== s.length) throw new InterfaceError('type: unexpected ' + JSON.stringify(s.slice(i)) + ' in ' + JSON.stringify(text));
  return t;
}

export function printDecl(d: BindingDecl): string {
  if (d.kind === 'read' || d.kind === 'store') return d.kind + ' ' + d.name + ': ' + printType(d.type);
  if (d.kind === 'action') return 'action ' + d.name + '(' + d.params.join(', ') + ')';
  if (d.kind !== 'host') throw new InterfaceError('unknown binding kind');
  return 'host ' + d.name + '(' + d.params.join(', ') + '): ' + d.returns;
}

export const printInterface = (ds: BindingDecl[]) => ds.map(printDecl).join('\n');

/** Equal interfaces: the same names, kinds and types (records by field set). Order and parameter names do not count. */
export function sameInterface(a: BindingDecl[], b: BindingDecl[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(x => {
    const y = b.find(d => d.name === x.name);
    if (!y || y.kind !== x.kind) return false;
    if (x.kind === 'read' || x.kind === 'store') return sameType(x.type, (y as typeof x).type);
    if (x.kind === 'action') return JSON.stringify(x.params) === JSON.stringify((y as typeof x).params);
    if (x.kind !== 'host') return false;
    return JSON.stringify(x.params) === JSON.stringify((y as typeof x).params) && x.returns === (y as typeof x).returns;
  });
}

/** The typer's view of the bindings (plan/types.ts). Hosts are not names: evaluated code awaits them as hosts. */
export function bindingTypes(ds: BindingDecl[]): Map<string, NameType> {
  const out = new Map<string, NameType>();
  for (const d of ds) {
    if (d.kind === 'read') out.set(d.name, { kind: 'value', type: d.type, binding: true });
    else if (d.kind === 'store') out.set(d.name, { kind: 'store', type: d.type, binding: true });
    else if (d.kind === 'action') out.set(d.name, { kind: 'action', params: d.params.map(scalarType), binding: true });
  }
  return out;
}
