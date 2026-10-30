/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test } from "vitest";
import { Loading, For, action, createOptimisticStore, flush, refresh } from "solid-js";
import { render } from "../src/index.js";
const tick = async () => { for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r, 0)); flush(); } };
for (const second of [false, true])
test(`second close in the air: ${second}`, async () => {
  const asks: { key: string; res: (v: any) => void }[] = [];
  const ask = (key: string) => new Promise<any>(res => asks.push({ key, res }));
  const land = async (key: string, v: any) => { for (const a of asks.filter(a => a.key === key)) { asks.splice(asks.indexOf(a), 1); a.res(v); } await tick(); };
  const container = document.body.appendChild(document.createElement("div"));
  const frames: string[] = []; const snap = (l: string) => frames.push(`${l}: ${container.textContent}`);
  let closeOne!: (id: number) => any;
  const dispose = render(() => {
    const [issues, set] = createOptimisticStore(async (d: any[]) => { const r = await ask("fetch"); d.length = r.length; r.forEach((x: any, i: number) => { d[i] = x; }); }, [] as any[], { key: "id" });
    closeOne = action(function* (id: number) {
      set((d: any) => { const i = d.findIndex((t: any) => t.id === id); if (i >= 0) d.splice(i, 1); });
      yield ask(`close:${id}`);
      refresh(issues);
    });
    return <For each={issues}>{(it: any) => <i>[#{it.id}]</i>}</For>;
  }, container);
  await tick();
  await land("fetch", [{ id: 1 }, { id: 3 }, { id: 4 }]); snap("loaded");
  closeOne(1); await tick(); snap("close 1");
  if (second) { closeOne(4); await tick(); snap("close 4"); }
  await land("close:1", {}); snap("close 1 accepted");
  await land("fetch", second ? [{ id: 3 }, { id: 4 }] : [{ id: 3 }, { id: 4 }]); snap("refresh answered");
  console.log(`second close in the air: ${second}\n  ` + frames.join("\n  "));
  dispose(); container.remove();
});
