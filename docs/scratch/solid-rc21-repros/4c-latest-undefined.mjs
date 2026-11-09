// solid-js 2.0.0-rc.21 (solidjs/solid@2105ffb8). In an app: import * as S from "solid-js".
// Here the built package is imported by path (override with SOLID_JS=...). Node 24.
const S = await import(process.env.SOLID_JS ?? new URL("../../../solid-next/packages/solid/dist/solid.js", import.meta.url).href);

const drain = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); S.flush(); };
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); promise.catch(() => {}); return { promise, resolve, reject }; };
const show = v => (v instanceof Error ? `${v.constructor.name}("${v.message}")` : v === undefined ? "undefined" : JSON.stringify(v));
const probe = f => { try { return "returns " + show(f()); } catch (e) { return "throws " + show(e); } };

const first = deferred(), done = deferred(), never = new Promise(() => {});
const [o, setO] = S.createOptimistic(0);
let a, m;
S.createRoot(() => {
  a = S.createMemo(() => (o() === 0 ? first.promise : never));
  m = S.createMemo(() => a() + o());
});
// Action 1 guesses o = 1 and waits on `done`.
S.action(function* () { setO(1); yield done.promise; })();
// The memo's first request (o = 0) rejects: it never had a value.
first.reject(new Error("failed"));
await drain();
// Action 2 (pending forever) guesses o = 0 again.
S.action(function* () { setO(0); yield never; })();
S.flush();
done.resolve();
await drain();
console.log("m()        ", probe(() => m()));
console.log("latest(m)  ", probe(() => S.latest(m)));
console.log("a()        ", probe(() => a()));
console.log("latest(a)  ", probe(() => S.latest(a)));
