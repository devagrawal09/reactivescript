// solid-js 2.0.0-rc.21 (solidjs/solid@2105ffb8). In an app: import * as S from "solid-js".
// Here the built package is imported by path (override with SOLID_JS=...). Node 24.
const S = await import(process.env.SOLID_JS ?? new URL("../../../solid-next/packages/solid/dist/solid.js", import.meta.url).href);

const drain = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); S.flush(); };
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); promise.catch(() => {}); return { promise, resolve, reject }; };
const show = v => (v instanceof Error ? `${v.constructor.name}("${v.message}")` : JSON.stringify(v));

const q = [deferred(), deferred(), deferred()], f0 = deferred();
const [s, setS] = S.createSignal(0);
const [o, setO] = S.createOptimistic(0);
S.createRoot(() => {
  const a = S.createMemo(() => q[s() % 3].promise, { loadingValue: 0 });
  S.createMemo(prev => { console.log("m compute, prev =", show(prev)); return a() + o(); });
});
q[0].resolve(2);
await drain();
// Action 1: guess o = 1 and write s = 5 (request q[2]); after f0, write s = 4 (request q[1]).
S.action(function* () { setO(1); setS(5); yield f0.promise; setS(4); })();
S.flush();
// Action 2 (pending forever): guess o = 2.
S.action(function* () { setO(2); yield new Promise(() => {}); })();
q[2].reject(new Error("failed")); // the request action 1 made rejects
await drain();
f0.resolve();
await drain();
