import { createSignal, createRoot, flush, createMemo, createEffect, createRenderEffect, onCleanup, getOwner, runWithOwner, createContext, getContext, setContext, untrack, action, refresh, isPending, latest, createOptimistic } from "@solidjs/signals";
export const __keep = [createSignal, createRoot, flush, createMemo, createEffect, createRenderEffect, onCleanup, getOwner, runWithOwner, createContext, getContext, setContext, untrack, action, refresh, isPending, latest, createOptimistic];
const [ag] = createSignal(async () => 1);
refresh(ag);
export const __async = ag;
