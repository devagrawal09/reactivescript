// solid-js 2.0.0-rc.21 (solidjs/solid@2105ffb8). In an app: import * as S from "solid-js".
// Here the built package is imported by path (override with SOLID_JS=...). Node 24:
//   node 1-take-held.mjs
//   SOLID_JS=.../packages/solid/dist/solid.dev.js node --conditions=development 1-take-held.mjs
const S = await import(process.env.SOLID_JS ?? new URL("../../../solid-next/packages/solid/dist/solid.js", import.meta.url).href);

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

let setPage, list, setList;
const asked = new Map();
S.createRoot(() => {
  let page;
  [page, setPage] = S.createOptimistic(0);
  // A derived optimistic store; each derive run asks a fresh question "list:<page>#<n>".
  [list, setList] = S.createOptimisticStore(
    () => {
      const k = page(), n = (asked.get(k) ?? 0) + 1;
      asked.set(k, n);
      console.log("derive asks", `list:${k}#${n}`);
      return flight(`list:${k}#${n}`).promise;
    },
    [],
    { key: "id" }
  );
  S.createRenderEffect(
    () => { const ids = []; for (let i = 0; i < list.length; i++) ids.push(list[i].id); return ids; },
    ids => console.log("rows", JSON.stringify(ids))
  );
});
flight("list:0#1").resolve([{ id: 2 }, { id: 3 }]);
await drain(); // rows [2,3]

// Action A: optimistically remove row 2, then wait on a save that never settles.
S.action(function* () {
  setList(d => { d.splice(d.findIndex(r => r.id === 2), 1); });
  yield flight("save").promise;
})();
// A mainline refresh; its answer lands beneath A's guess.
S.refresh(list);
await drain();
flight("list:0#2").resolve([{ id: 1 }]);
await drain();

// Action B: guess the derive's input; the store re-asks in B's lane.
S.action(function* () {
  setPage(1);
  yield flight("nav").promise;
})();
flight("list:1#1").resolve([]);
await drain();
console.log("done");
