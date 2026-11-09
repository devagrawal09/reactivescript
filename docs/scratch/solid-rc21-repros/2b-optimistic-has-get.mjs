// solid-js 2.0.0-rc.21 (solidjs/solid@2105ffb8). In an app: import * as S from "solid-js".
// Here the built package is imported by path (override with SOLID_JS=...). Node 24.
const S = await import(process.env.SOLID_JS ?? new URL("../../../solid-next/packages/solid/dist/solid.js", import.meta.url).href);

const deferred = () => { let resolve; const promise = new Promise(r => (resolve = r)); return { promise, resolve }; };
const drain = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); S.flush(); };
const never = new Promise(() => {});
const [store, setStore] = S.createOptimisticStore({ list: [{ id: 2 }, { id: 3 }] });
const indexOf = (l, id) => l.findIndex(r => r.id === id);

const seen = [];
S.createRoot(() => {
  const rows = S.mapArray(
    () => {
      const l = store.list;
      // What the pass sees, untracked: every index below length should be `in` the array.
      S.untrack(() => { for (let i = 0; i < l.length; i++) if (!(i in l)) seen.push(`pass: length ${l.length}, list[${i}] is row ${l[i]?.id}, but (${i} in list) is false`); });
      return l;
    },
    item => item,
    { keyed: row => { if (row === undefined) seen.push("key function called with undefined"); return row?.id; } }
  );
  S.createRenderEffect(() => rows().length, () => {});
});
S.flush();

// c0 (pending forever): guess removing row 4, which does not exist (writes nothing).
S.action(function* () { setStore(d => { const i = indexOf(d.list, 4); if (i >= 0) d.list.splice(i, 1); }); yield never; })();
// c1: guess the reversed list (the setter returns a replacement); its flight settles.
const c1 = deferred();
S.action(function* () { setStore(d => ({ list: [...d.list].reverse() })); yield c1.promise; })();
c1.resolve(); await drain();
// c2: guess a pushed row 6; after its flight, remove row 2.
const c2 = deferred();
S.action(function* () {
  setStore(d => { d.list.push({ id: 6 }); });
  yield c2.promise;
  setStore(d => { const i = indexOf(d.list, 2); if (i >= 0) d.list.splice(i, 1); });
})();
// c3: guess row 2 moved to the front; its flight settles first.
const c3 = deferred();
S.action(function* () { setStore(d => { d.list.unshift(...d.list.splice(indexOf(d.list, 2), 1)); }); yield c3.promise; })();
c3.resolve(); await drain();
c2.resolve(); await drain();
console.log(seen.length ? seen.join("\n") : "not reproduced");
