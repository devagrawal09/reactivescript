# Prototype 3: read-site caches. Run from a Solid worktree's packages/signals.
p='src/store/store.ts'; s=open(p).read()
def rep(a,b,cnt=1):
    global s
    n=s.count(a); assert n==cnt,(a[:80],n); s=s.replace(a,b)
rep("""  } else if (t.n?.[key as any] === node) {
    delete t.n![key as any];
""","""  } else if (t.n?.[key as any] === node) {
    delete t.n![key as any];
    // No longer the key's node: a read site that kept it must look again
    // (`storeGetAt`). Only a node `acc === false` is served from a site.
    node.acc = null;
""")
rep("""/** `key in proxy`. */
export function storeHas(""","""/** A read site's memory of the node it last resolved: the compiler makes
 * one per site with a fixed key (per instance of the scope the site is in),
 * and `storeGetAt` skips the key lookup while it still holds. */
export interface StoreSite {
  t: StoreTarget | null;
  n: Signal<any> | null;
}
export function storeSite(): StoreSite {
  return { t: null, n: null };
}

/** `storeGet(t, key)` from a site that reads this one key. The site serves
 * exactly the get trap's existing-plain-node case (same conditions, same
 * `read()`), for a target of no family: any other read is the trap's. */
export function storeGetAt(site: StoreSite, t: StoreTarget, key: PropertyKey): any {
  const node: any = site.n;
  if (
    site.t === t &&
    node.acc === false &&
    writeScopes === null &&
    !writeOverride &&
    verdict === null &&
    !t.ch &&
    !t.s
  ) {
    if (__DEV__ && getObserver() === null) checkForeignRead();
    const nv = readNode(node);
    if (nv === null || typeof nv !== "object") return nv;
    if (node.pxv === nv) return node.px;
    if (isWrappable(nv)) {
      const p = wrapTarget(nv, t, key);
      node.px = p;
      node.pxv = nv;
      return p;
    }
    return nv;
  }
  const v = traps.get!.call(t, HANDLE, (key = propKey(key)) as any, undefined);
  // Remember the node the read used, if the trap's inline case would serve it.
  if (t._fam === null) {
    const n: any = t.n?.[key as any];
    if (n !== undefined && n.acc === false) {
      site.t = t;
      site.n = n;
    } else site.t = null;
  } else site.t = null;
  return v;
}

/** `key in proxy`. */
export function storeHas(""")
open(p,'w').write(s)
p='src/store/index.ts'; s=open(p).read()
a="  storeSet\n} from \"./store.js\";"; assert a in s
s=s.replace(a,"  storeSet,\n  storeGetAt,\n  storeSite\n} from \"./store.js\";\nexport type { StoreSite } from \"./store.js\";"); open(p,'w').write(s)
