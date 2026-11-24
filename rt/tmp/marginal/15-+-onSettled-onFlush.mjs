import { createSignal, createRoot, flush, createMemo, createEffect, createRenderEffect, onCleanup, getOwner, runWithOwner, createContext, getContext, setContext, untrack, action, refresh, isPending, latest, createOptimistic, createLoadingBoundary, createErrorBoundary, createRevealOrder, mapArray, createStore, createProjection, createOptimisticStore, onSettled, onFlush } from "@solidjs/signals";
export const __keep = [createSignal, createRoot, flush, createMemo, createEffect, createRenderEffect, onCleanup, getOwner, runWithOwner, createContext, getContext, setContext, untrack, action, refresh, isPending, latest, createOptimistic, createLoadingBoundary, createErrorBoundary, createRevealOrder, mapArray, createStore, createProjection, createOptimisticStore, onSettled, onFlush];
const [ag] = createSignal(async () => 1);
refresh(ag);
export const __async = ag;
