// solid-js 2.0.0-rc.21 (solidjs/solid@2105ffb8). In an app: import * as S from "solid-js".
// Here the built package is imported by path (override with SOLID_JS=...). Node 24.
const S = await import(process.env.SOLID_JS ?? new URL("../../../solid-next/packages/solid/dist/solid.js", import.meta.url).href);

const drain = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); S.flush(); };
const out = [];
let resolve;
const flight = new Promise(r => (resolve = r));

// A PLAIN store (createStore, not optimistic).
const [st, set] = S.createStore({ list: [] });
S.createRoot(() => {
  const rows = S.mapArray(
    () => {
      const l = st.list;
      // What the pass sees, untracked: `i in list` and list[i].id for each index below length.
      S.untrack(() => { const seen = []; for (let i = 0; i < l.length; i++) seen.push(`${i in l}:${l[i]?.id}`); out.push(`pass sees length ${l.length} [${seen}]`); });
      return l;
    },
    item => item().id,
    { keyed: row => { if (row === undefined) { out.push("key function called with undefined"); return undefined; } return row.id; } }
  );
  S.createRenderEffect(() => rows(), v => { out.push("mapped " + JSON.stringify(v)); });
});
set(d => { d.list.unshift({ id: 6 }); });
S.flush();
// An action whose edit finds no row 3 (writes nothing), pending on `flight`.
S.action(function* () {
  set(d => { const r = d.list.find(r => r.id === 3); if (r) r.a = 9; });
  const v = yield flight;
  set(d => { const r = d.list.find(r => r.id === 3); if (r) r.t = v; });
})();
set(S.reconcile({ list: [] }, "id"));
S.flush();
set(d => { d.list.push({ id: 8 }); });
S.flush();
set(S.reconcile({ list: [{ id: 9 }] }, "id"));
resolve(1);
await drain();
console.log(out.join("\n"));
