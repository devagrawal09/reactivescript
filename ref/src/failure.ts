// R-f at run time: error classes (R-f-1), class matching for catches and boundaries (R-f-4), and the catch expression's
// value over sync values, promises and streams. Shared by the interpreter and the oracle; ref/compile/rt.ts carries a copy
// (it is served to the browser on its own).

/** `error NotFound(id) => message`: a constructor called without `new`, carrying its JS class. */
export type ErrorClass = ((...args: unknown[]) => Error) & { cls: new (...args: unknown[]) => Error; errorClass: string };

export function makeErrorClass(name: string, params: string[], message: (args: unknown[]) => string): ErrorClass {
  const C = class extends Error {
    constructor(...args: unknown[]) {
      super("");
      this.name = name;
      params.forEach((p, i) => { (this as unknown as Record<string, unknown>)[p] = args[i]; });
      this.message = message(args);
    }
  };
  Object.defineProperty(C, "name", { value: name });
  const f = ((...args: unknown[]) => new C(...args)) as ErrorClass;
  f.cls = C; f.errorClass = name;
  return f;
}

/** Does a catch or boundary over `classes` take `err`? `undefined` classes: every failure. A class is an ErrorClass or a JS class. */
export function isA(err: unknown, classes: unknown[] | undefined): boolean {
  if (!classes) return true;
  return classes.some(c => { const k = (c as { cls?: unknown })?.cls ?? c; return typeof k === "function" && err instanceof (k as new () => unknown); });
}

/** The value of `e catch (x: C) => alt` where `f` evaluates `e`: a matching failure becomes `alt(err)`; pending (`notReady`) and
 *  other failures pass. A promise or a stream (an equation's tail `await`, R-1) is mapped: a matching rejection is an answer. */
export function caughtValue(f: () => unknown, match: (err: unknown) => boolean, alt: (err: unknown) => unknown, notReady: (err: unknown) => boolean): unknown {
  let v: unknown;
  try { v = f(); } catch (err) { if (notReady(err) || !match(err)) throw err; return alt(err); }
  if (v && typeof v === "object" && typeof (v as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function") {
    const src = v as AsyncIterable<unknown>;
    return (async function* () { try { for await (const x of src) yield x; } catch (err) { if (!match(err)) throw err; yield alt(err); } })();
  }
  if (v && typeof (v as PromiseLike<unknown>).then === "function") return Promise.resolve(v).then(x => x, err => { if (!match(err)) throw err; return alt(err); });
  return v;
}
