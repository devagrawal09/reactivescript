// The graph the map draws, served to the program as a host signal (MO-10 `ref`): a `source` holding the graph would be
// a Solid store over every node and edge (decisions/opaque-sources.md); a foreign accessor hands it over as is. The
// setter is io, called from the program's `swapGraph` action. Plans' graphs (a module replacement's) are kept by
// number until they are swapped in; `putGraph` / `graphAt` are io too: only actions call them.
import { createSignal } from "solid-js";
import { servedGraph } from "./env.js";

/** The graph now, and its setter (a new graph replaces it; nothing in it is ever written). */
export function graphSignal() {
  const [get, set] = createSignal(servedGraph(), { equals: false });
  return [get, g => set(() => g)];
}

const kept = [];
/** Keeps a plan's graph; its number. */
export const putGraph = g => kept.push(g) - 1;
/** The graph kept under `n`. */
export const graphAt = n => kept[n];
