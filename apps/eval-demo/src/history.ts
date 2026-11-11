import type { Syntax, ValueType } from './interface.ts';

export type Diagnostic = { code: string; message: string; line?: number; rule?: string };
export type Entry = {
  id: number;
  at: string;
  code: string;
  syntax: Syntax;
  /** Present for a value eval; absent for a markup eval. */
  type?: ValueType;
  ok: boolean;
  diagnostics: Diagnostic[];
  /** The server's compiled plan (plan v2), for code the page cannot compile itself (TSX syntax). */
  plan?: unknown;
};
export type Submission = { code: string; syntax: Syntax; type?: ValueType };
export type Check = (s: Submission) => { ok: boolean; diagnostics: Diagnostic[]; plan?: unknown };

/** An in-memory, append-only list of posted code, with listeners for the live stream. */
export function createHistory(check: Check, now: () => Date = () => new Date()) {
  const entries: Entry[] = [];
  const listeners = new Set<(e: Entry) => void>();
  return {
    list: (): readonly Entry[] => entries,
    add(s: Submission): Entry {
      const r = check(s);
      const entry: Entry = { id: entries.length + 1, at: now().toISOString(), ...s, ok: r.ok, diagnostics: r.diagnostics, ...(r.plan ? { plan: r.plan } : {}) };
      entries.push(entry);
      for (const l of listeners) l(entry);
      return entry;
    },
    subscribe(l: (e: Entry) => void): () => void {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
export type History = ReturnType<typeof createHistory>;

/** Reads a POST /eval request's options from its query string. */
export function submission(code: string, query: URLSearchParams): Submission | { error: string } {
  const syntax = query.get('syntax') ?? 'rx';
  if (syntax !== 'rx' && syntax !== 'tsx') return { error: 'syntax is rx or tsx' };
  const type = query.get('type');
  if (type !== null && type !== 'number' && type !== 'string' && type !== 'boolean') return { error: 'type is number, string or boolean' };
  if (!code.trim()) return { error: 'the body is the code to evaluate; it is empty' };
  return { code: code.replace(/\r\n?/g, '\n'), syntax, ...(type ? { type } : {}) };
}
