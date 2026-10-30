/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test } from "vitest";
import { Loading, For, action, createOptimisticStore, createSignal, createEffect, flush, refresh, untrack } from "solid-js";
import { render } from "../src/index.js";
const tick = async () => { for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r, 0)); flush(); } };
for (const withCount of [false, true]) for (const withAssign of [false, true])
test(`count effect=${withCount}, assign first=${withAssign}`, async () => {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const land = async (key: string, v: any) => { for (const a of asks.filter(a => a.key === key)) { asks.splice(asks.indexOf(a), 1); a.res(v); } await tick(); };
  const container = document.body.appendChild(document.createElement("div"));
  let assignTo!: (id: number) => any; let closeOne!: (id: number) => any;
  const dispose = render(() => {
    const [issues, set] = createOptimisticStore(async (d: any[]) => { const r = await ask("fetch"); d.length = r.length; r.forEach((x: any, i: number) => { d[i] = x; }); }, [] as any[], { key: "id" });
    assignTo = action(function* (id: number) {
      const i = untrack(() => issues.findIndex((t: any) => t.id === id));
      set((d: any) => { d[i].assignee = "guest"; });
      yield ask(`assign:${id}`);
      refresh(issues);
    });
    closeOne = action(function* (id: number) {
      const next = untrack(() => issues.filter((t: any) => t.id !== id));
      set((d: any) => { d.length = next.length; next.forEach((x: any, i: number) => { d[i] = x; }); });
      yield ask(`close:${id}`);
      refresh(issues);
    });
    const [count, setCount] = createSignal(-1);
    if (withCount) createEffect(() => issues.length, (n: number) => { setCount(n); });
    return <>
      <b>({count()})</b>
      <Loading fallback={<p>loading</p>}><For each={issues}>{(it: any) => <i>[#{it.id} {it.assignee}]</i>}</For></Loading>
    </>;
  }, container);
  await tick();
  await land("fetch", [{ id: 1, assignee: "ann" }, { id: 3, assignee: "bob" }, { id: 4, assignee: "dana" }]);
  if (withAssign) { assignTo(4); await tick(); await land("assign:4", {}); }   // its refresh is now in the air
  closeOne(3); await tick();
  await land("close:3", {});
  await land("fetch", [{ id: 1, assignee: "ann" }, { id: 4, assignee: withAssign ? "guest" : "dana" }]);
  console.log(`count effect=${withCount}, assign first=${withAssign}: ${container.textContent}`);
  dispose(); container.remove();
});
