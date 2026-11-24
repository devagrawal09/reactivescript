// store-ops.ts runs unbundled under the node runners: its one switch (`__RX_STORES__`) is a global there, on.
(globalThis as Record<string, unknown>).__RX_STORES__ ??= true;
export {};
