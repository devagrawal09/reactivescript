// solid-js 2.0.0-rc.21 (solidjs/solid@2105ffb8). In an app: import * as S from "solid-js".
// Here the built package is imported by path (override with SOLID_JS=...). Node 24.
const S = await import(process.env.SOLID_JS ?? new URL("../../../solid-next/packages/solid/dist/solid.js", import.meta.url).href);

const [store, setStore] = S.createOptimisticStore({ list: [{ id: 1 }, { id: 2 }, { id: 3 }] });
const remove = id => d => { const i = d.list.findIndex(r => r.id === id); if (i >= 0) d.list.splice(i, 1); };
const moveToFront = id => d => { const i = d.list.findIndex(r => r.id === id); d.list.unshift(...d.list.splice(i, 1)); };

const views = [];
S.createRoot(() =>
  S.createRenderEffect(
    () => { const l = store.list, ids = []; for (let i = 0; i < l.length; i++) ids.push(l[i] === undefined ? "undefined" : l[i].id); return ids; },
    ids => { views.push(JSON.stringify(ids)); }
  )
);
S.flush();
const never = new Promise(() => {});
// Action A (stays pending): guess "row 2 to the front", then "remove row 3".
S.action(function* () { setStore(moveToFront(2)); setStore(remove(3)); yield never; })();
S.flush();
// Action B (stays pending): guess "remove row 2"; the second call finds no row 2 and writes nothing.
S.action(function* () { setStore(remove(2)); setStore(remove(2)); yield never; })();
S.flush();
console.log("views:", views.join(" -> "));
console.log("now: length", store.list.length, "| 0 in list:", 0 in store.list, "| list[0]:", store.list[0], "| [...list]:", JSON.stringify([...store.list]));
