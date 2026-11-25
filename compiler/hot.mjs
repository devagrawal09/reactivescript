import { createMemo, createSignal, flush, getOwner, onCleanup, untrack } from "solid-js";
import { planHmr, prepareCarry, finishCarry } from "./hmr.mjs";

const entries = new Map();
let localId = 0;

// Only Vite's hot client imports this. The map is a subscriber, not the owner
// of a replacement or its carried state.
export function hotEntry(payload, factory, hot, observer) {
  const replacement = { ...payload, factory, hot, observer };
  const graph = payload.graph ?? payload.update.graph;
  const entry = graph.modules.at(-1);
  let state = entries.get(entry);
  if (!state) {
    const [code, replace] = createSignal({ factory });
    const mounts = new Map();
    state = { current: replacement, mounts, replace, queue: Promise.resolve(),
      main: rt => () => {
        if (rt.hotRuntime && getOwner()) {
          rt.hotRuntime.activate();
          mounts.set(rt, (mounts.get(rt) ?? 0) + 1);
          onCleanup(() => {
            const count = mounts.get(rt);
            if (count === 1) mounts.delete(rt);
            else mounts.set(rt, count - 1);
          });
        }
        return createMemo(() => {
          const current = code().factory;
          return untrack(() => current(rt)());
        }, { transparent: true, _plumbing: true });
      } };
    entries.set(entry, state);
    observer?.register(graph, { hot });
  }
  function accept(next) {
    state.queue = state.queue.then(async () => {
      const old = state.current;
      if (!next) {
        if (state.announced) old.observer?.hmr({ phase: "failed", id: state.announced, error: "replacement module did not load", fallback: "none" });
        state.announced = undefined;
        return;
      }
      const previous = old.graph ?? old.update.graph;
      const graph = next.graph ?? next.update.graph;
      const update = next.update;
      const sameBase = update && update.from === old.revision;
      const changedModules = new Set(sameBase ? update.changedModules : [...previous.modules, ...graph.modules]);
      const edit = {
        phase: "plan", id: update?.id ?? `client-${++localId}`, modules: update?.modules ?? [entry],
        graph, plan: sameBase ? update.plan : planHmr(previous, graph),
      };
      const observer = next.observer;
      if (!sameBase || state.announced !== edit.id) observer?.hmr(edit);
      state.announced = undefined;
      const apply = (commit = flush) => {
        const frames = [...state.mounts.keys()].map(rt => {
          const runtime = rt.hotRuntime;
          const frame = prepareCarry(previous, graph, edit.plan, runtime.sources, changedModules);
          return { runtime, ...frame };
        });
        try {
          for (const { runtime, carry } of frames) runtime.begin(carry, changedModules);
          state.replace({ factory: next.factory });
          commit();
          return new Set(frames.flatMap(frame => finishCarry(frame, frame.runtime.sources)));
        } finally {
          for (const { runtime } of frames) runtime.end();
        }
      };
      const installed = () => {
        state.current = next;
        observer?.register(graph, { hot: next.hot, replacement: true });
      };
      if (observer) await observer.replace(edit, apply, installed);
      else {
        try { flush(); apply(); installed(); }
        catch (e) { console.error("[rx] replacement failed:", e); location.reload(); }
      }
    }).catch(e => console.error("[rx] replacement failed:", e));
  }
  // Vite replaces these listeners on the next evaluation of this module.
  hot?.on("rx:hmr:plan", ({ from, to, type, changedModules, ...edit }) => {
    if (edit.graph.modules.at(-1) !== entry || state.current.revision !== from || state.announced === edit.id) return;
    state.announced = edit.id;
    observer?.hmr(edit);
  });
  hot?.on("rx:hmr:error", error => {
    if (error.entry === entry) observer?.hmr({ phase: "failed", id: error.id, error: error.error, fallback: "none" });
  });
  return { main: state.main, replacement, accept };
}
