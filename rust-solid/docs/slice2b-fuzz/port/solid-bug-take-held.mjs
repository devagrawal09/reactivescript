// Suspected Solid bug (rc.21, 2105ffb8): `take(n, l, true)` (lanes.ts:174-181), called by
// optimistic.ts `_slotTake` when a derived optimistic store re-asks in another action's
// lane, nulls the taken slot's `_x._transaction` but keeps its CONFIG_HELD (set when a
// landing was held beneath the guess, lanes.ts `laneWrite`). The next write to that slot
// (the re-ask's landing: reconcile -> leafSet -> setSignal) takes the CONFIG_HELD arm,
// `joinFuture(txOf(el))`, and `resolveTx(null)` throws
//   TypeError: Cannot read properties of null (reading 'eo')
// inside a render effect's flush, which halts reactivity. Fuzz seeds 1430, 4623, 5270
// (--slice2b) reduce to this program (op form: solid-bug-take-held.json).
// Usage (repository root, Node 24): node docs/slice2b-fuzz/port/solid-bug-take-held.mjs
const S = await import(new URL('../../../../solid-next/packages/signals/dist/prod/index.js', import.meta.url).href);
const flights = new Map();
const flight = id => {
  let f = flights.get(id);
  if (!f) {
    let resolve;
    const promise = new Promise(r => (resolve = r));
    flights.set(id, (f = { promise, resolve }));
  }
  return f;
};
const drain = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); S.flush(); };
const err = console.error;
console.error = (...a) => err('console.error:', ...a.map(x => (x instanceof Error ? x.stack.split('\n').slice(0, 4).join('\n') : x)));
let page, setPage, os, setOs;
const asked = new Map();
S.createRoot(() => {
  [page, setPage] = S.createOptimistic(1);
  [os, setOs] = S.createOptimisticStore(
    () => {
      const k = page(), n = (asked.get(k) ?? 0) + 1;
      asked.set(k, n);
      console.log('derive asks', `list:${k}#${n}`);
      return flight(`list:${k}#${n}`).promise;
    },
    [],
    { key: 'id' }
  );
  S.createRenderEffect(
    () => { const r = []; for (let i = 0; i < os.length; i++) r.push({ id: os[i].id, d: os[i].d }); return r; },
    v => console.log('rows', JSON.stringify(v))
  );
});
flight('list:1#2').resolve([{ id: 5, d: 0 }]);
await drain();
S.action(function* () {
  setOs(d => { d[d.length] = { id: 9, d: 0 }; });
  yield flight('save:5#1').promise;
  S.refresh(os);
})();
S.refresh(os).catch(() => {});
flight('list:0#1').resolve([]);
await drain();
S.action(function* () {
  setPage(0);
  yield flight('nav#2').promise;
  S.refresh(os);
})();
await drain();
console.log('done');
