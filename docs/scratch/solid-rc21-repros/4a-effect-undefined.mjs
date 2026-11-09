// solid-js 2.0.0-rc.21 (solidjs/solid@2105ffb8). In an app: import * as S from "solid-js".
// Here the built package is imported by path (override with SOLID_JS=...). Node 24.
const S = await import(process.env.SOLID_JS ?? new URL("../../../solid-next/packages/solid/dist/solid.js", import.meta.url).href);

const drain = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); S.flush(); };
const failed = Promise.reject(new Error("failed"));
failed.catch(() => {});

const [s, setS] = S.createSignal(0);
S.createRoot(() => {
  // An async memo whose every answer is the same rejection: it never has a value.
  const a = S.createMemo(() => { s(); return failed; });
  S.createEffect(
    () => { const v = a(); console.log("compute returned", v); return v; },
    {
      effect: v => console.log("effect called with", v),
      error: e => console.log("error handler:", e.message)
    }
  );
});
await drain();

let go;
const gate = new Promise(r => (go = r));
S.action(function* () {
  setS(1); // re-asks (the same rejection)
  yield gate;
  setS(2); // re-asks again
})();
S.flush();
go();
await drain();
console.log("settled");
