// Suspected Solid bug (rc.21, 2105ffb8), the plain-store member of the "array view with a
// hole" family (docs/SLICE1.md, docs/slice2c-fuzz/port/README.md): a PLAIN store's array,
// held by a pending action, hands mapArray an `undefined` row after mainline reconciles and
// pushes. Each map pass logs what it sees (untracked, the posture of mapArray's
// `newItems.slice(0)`): a pass with length 1 where `0 in list` is false while `list[0]` is
// a row stores a hole in `_items`, and the next pass's `compare` hands it to the key
// function. On Solid's API alone; the op program is solid-bug-plain-store-hole.json (seed 4857,
// reduced with docs/slice2c-fuzz/tools/bug-reduce.mjs). Usage (repository root, Node 24):
//   node docs/slice2c-fuzz/port/solid-bug-plain-store-hole.mjs
const S = await import(process.env.SOLID_SIGNALS_URL ?? new URL('../../../../solid-next/packages/signals/dist/prod/index.js', import.meta.url).href);
const out = [];
let holes = 0;
let resolve;
const flight = new Promise(r => (resolve = r));
flight.catch(() => {});
const drain = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); S.flush(); };
S.createRoot(() => {
  const [st, set] = S.createStore({ list: [] });
  globalThis.st = st; globalThis.set = set;
  // The key function reports an undefined row instead of throwing (`x.id`).
  const list = S.mapArray(() => { const l = st.list; S.untrack(() => { const n = l.length; const h = []; for (let i = 0; i < n; i++) h.push((i in l) + ':' + (l[i]?.id)); out.push('pass sees length ' + n + ' [' + h.join(',') + ']'); }); return l; }, (item, index) => {
    S.createRenderEffect(() => item().t, () => {});
    S.createRenderEffect(() => item().a, () => {});
    return item().id;
  }, { keyed: x => { if (x === undefined) { holes++; out.push("key fn got undefined; untracked: length " + S.untrack(() => st.list.length) + ", 0 in list " + S.untrack(() => 0 in st.list) + ", list[0].id " + S.untrack(() => st.list[0]?.id)); return undefined; } return x.id; } });
  S.createRenderEffect(() => list(), v => { out.push('mapped ' + JSON.stringify(v)); });
});
const findKey = (t, k) => { const n = t.length; for (let i = 0; i < n; i++) { const r = t[i]; if (r != null && r.id === k) return i; } return -1; };
const shiftInsert = (a, i, x) => { for (let k = a.length; k > i; k--) a[k] = a[k - 1]; a[i] = x; };
set(d => { shiftInsert(d.list, 0, { id: 6, a: 3, t: 5 }); });
S.flush();
// An action whose edit finds no row (a miss: it writes nothing), pending on `flight`.
S.action(function* () {
  set(d => { const i = findKey(d.list, 3); if (i >= 0) d.list[i].a = 9; });
  const v = yield flight;
  set(d => { const i = findKey(d.list, 3); if (i >= 0) d.list[i].t = v; });
})().then(() => {}, () => {});
set(S.reconcile({ list: [] }, 'id'));
S.flush();
set(d => { d.list[d.list.length] = { id: 8, a: 2, t: 5 }; });
S.flush();
set(S.reconcile({ list: [{ id: 9, a: 2, t: 6 }] }, 'id'));
resolve(1);
await drain();
console.log(out.join('\n'));
console.log(holes ? `REPRODUCED: mapArray handed its key function an undefined row ${holes}x` : 'not reproduced');
