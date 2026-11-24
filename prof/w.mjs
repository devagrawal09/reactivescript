const [solid, wl] = process.argv.slice(2);
const S = await import(`${solid}/packages/signals/dist/prod/index.js`);
const { createStore, createProjection, createRoot, createRenderEffect, createSignal, flush, mapArray, $TARGET, storeGet, storeSet } = S;
let id = 0; const build = (n, v = 0) => Array.from({ length: n }, (_, i) => ({ id: i, label: "row " + i + (i % 10 === 0 ? v : ""), n: i }));
let api;
createRoot(() => {
  const [store, setStore] = createStore({ rows: build(1000) });
  const T = store[$TARGET];
  const [ver, setVer] = createSignal(0);
  const proj = wl === "keyed" ? createProjection(() => build(1000, ver()), [], { key: "id" }) : null;
  const list = () => wl === "keyed" ? proj[$TARGET] : storeGet(T, "rows");
  const mapped = mapArray(list, row => { createRenderEffect(() => storeGet(row, "id") + storeGet(row, "label"), () => {}); return row; });
  createRenderEffect(() => mapped().length, () => {});
  api = { T, setStore, setVer };
});
flush();
const N = wl === "path" ? 300000 : 600; const t0 = process.hrtime.bigint();
for (let i = 1; i <= N; i++) {
  if (wl === "path") api.setStore(() => { storeSet(storeGet(storeGet(api.T, "rows"), i % 1000), "label", "u" + i); });
  if (wl === "replace") api.setStore(() => ({ rows: build(1000, i) }));
  if (wl === "keyed") api.setVer(i);
  flush();
}
console.log(wl, (Number(process.hrtime.bigint() - t0) / 1e3 / N).toFixed(2), "us/op");
