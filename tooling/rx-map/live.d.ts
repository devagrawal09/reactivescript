/** Registers a program's map graph (injected into dev entries by the RX Vite front end). */
export function register(graph: unknown, options?: { hot?: unknown }): void;
/** Mounts the live map into `el`; returns a dispose function. */
export function mount(el: HTMLElement): () => void;
export function preview(value: unknown, max?: number, depth?: number): string;
export function mergeGraphs(list: unknown[]): unknown;
