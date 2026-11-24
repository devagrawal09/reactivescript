import { createSignal, createRoot, flush, createMemo, createEffect, createRenderEffect, onCleanup, getOwner, runWithOwner, createContext, getContext, setContext, untrack, action, refresh } from "@solidjs/signals";
export const __keep = [createSignal, createRoot, flush, createMemo, createEffect, createRenderEffect, onCleanup, getOwner, runWithOwner, createContext, getContext, setContext, untrack, action, refresh];
const [ag] = createSignal(async () => 1);
refresh(ag);
export const __async = ag;
