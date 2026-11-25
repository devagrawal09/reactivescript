/** AC-1: capture data before the action starts. Read through store proxies
 * so the copy sees exactly the values a snapshot read can see at the call. */
export function actionInput(args: unknown[]): unknown[] {
  const seen = new WeakMap<object, object>();
  function copy(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    const proto = Object.getPrototypeOf(value);
    const array = Array.isArray(value);
    if (!array && proto !== Object.prototype && proto !== null) return value;
    if (seen.has(value)) return seen.get(value);
    const out = array ? new Array((value as unknown[]).length) : Object.create(proto);
    seen.set(value, out);
    for (const key of Reflect.ownKeys(value)) {
      if (!Object.getOwnPropertyDescriptor(value, key)?.enumerable) continue;
      Object.defineProperty(out, key, { value: copy(Reflect.get(value, key)), enumerable: true, configurable: true, writable: true });
    }
    return out;
  }
  return args.map(copy);
}
