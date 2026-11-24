# Prototype 2: direct-path writes. Run from a Solid worktree's packages/signals.
p='src/store/store.ts'; s=open(p).read()
def rep(a,b,cnt=1):
    global s
    n=s.count(a); assert n==cnt,(a[:80],n); s=s.replace(a,b)
rep("""export function storeSetter<T>(proxy: T, fn: (draft: T) => T | void, guard = true): void {
  if (writeHook !== null) writeHook(proxy as object);
  if (__DEV__ && guard) devGuardStoreSetterWrite();
  const target: StoreTarget = (proxy as any)[$TARGET];
""","""export function storeSetter<T>(proxy: T, fn: (draft: T) => T | void, guard = true): void {
  setterOn((proxy as any)[$TARGET], proxy, fn, guard, null, undefined);
}

/** A user's write of one path, as `setStore(d => { d[k0][k1]… = value })`
 * makes it: the setter's scope around the same draft reads and the same
 * `set`, with no callback and no draft proxy. */
export function storeWrite(target: StoreTarget, path: readonly PropertyKey[], value: any): void {
  setterOn(target, null, null, true, path, value);
}

function setterOn<T>(
  target: StoreTarget,
  proxy: T | null,
  fn: ((draft: T) => T | void) | null,
  guard: boolean,
  path: readonly PropertyKey[] | null,
  value: any
): void {
  if (writeHook !== null) writeHook((proxy ??= proxyOf(target)) as object);
  if (__DEV__ && guard) devGuardStoreSetterWrite();
""")
rep("""    result = fn(proxy);
""","""    if (fn !== null) result = fn(proxy!);
    else {
      let t: any = target;
      const last = path!.length - 1;
      for (let i = 0; i < last; i++) t = storeGet(t, path![i]);
      storeSet(t, path![last], value);
    }
""")
open(p,'w').write(s)
p='src/store/index.ts'; s=open(p).read()
a="  storeSet\n} from \"./store.js\";"; assert a in s
s=s.replace(a,"  storeSet,\n  storeWrite\n} from \"./store.js\";"); open(p,'w').write(s)
