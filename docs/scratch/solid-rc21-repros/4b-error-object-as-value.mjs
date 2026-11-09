// solid-js 2.0.0-rc.21 (solidjs/solid@2105ffb8). In an app: import * as S from "solid-js".
// Here the built package is imported by path (override with SOLID_JS=...). Node 24.
const S = await import(process.env.SOLID_JS ?? new URL("../../../solid-next/packages/solid/dist/solid.js", import.meta.url).href);

const drain = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); S.flush(); };
const failed = Promise.reject(new Error("failed"));
failed.catch(() => {});
const show = v => (v instanceof Error ? `${v.constructor.name}("${v.message}")` : JSON.stringify(v));

const [s, setS] = S.createSignal(1);
const [o, setO] = S.createOptimistic(2);
let m;
S.createRoot(() => {
  const a = S.createMemo(() => (s() === 3 ? failed : Promise.resolve(s() * 10)));
  m = S.createMemo(() => a() + o());
  S.createEffect(
    () => { const v = m(); console.log("effect compute: m() returned", show(v)); return v + s(); },
    {
      effect: v => console.log("effect called with", show(v)),
      error: e => console.log("error handler:", show(e))
    }
  );
});
await drain();

let go;
const gate = new Promise(r => (go = r));
// Action 1: after `gate`, write s = 3 (a request that rejects).
S.action(function* () { yield gate; setS(3); })();
// Action 2 (pending forever): an optimistic guess o = 6, which m reads.
S.action(function* () { setO(6); yield new Promise(() => {}); })();
await drain();
console.log("-- release action 1");
go();
await drain();
const probe = f => { try { return "returns " + show(f()); } catch (e) { return "throws " + show(e); } };
console.log("m()        ", probe(() => m()));
console.log("latest(m)  ", probe(() => S.latest(m)));
