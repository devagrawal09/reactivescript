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
  Object.defineProperty(C, "declared", { value: true });                // SV-5a: a declared class's failures cross the wire as they are
  const f = ((...args: unknown[]) => new C(...args)) as ErrorClass;
  f.cls = C; f.errorClass = name;
  return f;
}

/** R-f-10: `Panic` in a catch or boundary list. Statically it discharges no failure; at run time it takes whatever reaches it,
 *  which — every failure being discharged below it — can only be a panic. */
export const PANIC = { panic: true } as const;

/** Does a catch or boundary over `classes` take `err`? `undefined` classes: every failure. A class is an ErrorClass or a JS class. */
export function isA(err: unknown, classes: unknown[] | undefined): boolean {
  if (!classes) return true;
  if (classes.includes(PANIC)) return true;
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

// ---------------------------------------------------------------- the wire (12 SF-6)
/** SF-6a: what crosses between the two sides is data, copied: primitives, arrays and plain records. Anything else — a function,
 *  an instance of a class — is `WIRE_VALUE` (a runtime error, naming where it was found). */
export function wireCopy(v: unknown, where: string, fail: (msg: string) => never): unknown {
  if (v === null || v === undefined || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map((x, i) => wireCopy(x, `${where}[${i}]`, fail));
  if (typeof v === "object") {
    const proto = Object.getPrototypeOf(v);
    if (proto === Object.prototype || proto === null) { const o: Record<string, unknown> = {}; for (const k of Object.keys(v as object)) o[k] = wireCopy((v as Record<string, unknown>)[k], `${where}.${k}`, fail); return o; }
  }
  return fail(`${where} is ${typeof v === "function" ? "a function" : `an instance of ${(v as object).constructor?.name ?? "a class"}`}, which the wire cannot carry: send data`);
}
/** SF-6b / SV-5: a failure crosses as it is when its class is declared; anything else as the generic error. */
export function wireFailure(err: unknown): unknown {
  return err instanceof Error && (err.constructor as { declared?: boolean }).declared ? err : new Error("Internal Server Error");
}
