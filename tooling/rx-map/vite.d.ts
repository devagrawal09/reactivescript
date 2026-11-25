import type { Plugin } from "vite";
/** Dev-server half of the RX live channel: serves `/__rx/live` (GET status; POST `{ method, params }`). */
export function rxMap(options?: { mcp?: { act?: boolean } }): Plugin;
