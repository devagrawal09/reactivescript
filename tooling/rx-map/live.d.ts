/** Registers a program's map graph (injected into dev entries by the RX Vite front end). */
export function register(graph: unknown, options?: { hot?: unknown }): void;
/** Mounts the live map into `el`; returns a dispose function. */
export function mount(el: HTMLElement): () => void;
/**
 * A view without the map page (tests, other tools in the app's window): `listener` gets every host message and
 * `post` takes view messages (`hello`, `snapshot?`, `travel`, `resume`). TRACE-CONTRACT §2–3.
 */
export function attach(listener: (msg: { source: "rx-map"; v: 1; type: string; [k: string]: unknown }) => void): {
  post(msg: { type: string; [k: string]: unknown }): void;
  detach(): void;
  /** What the app displays now for each key (its newest live instance): TRACE-CONTRACT §5. */
  shown(keys?: string[]): Record<string, { preview: string } | { error: string }>;
};
export function preview(value: unknown, max?: number, depth?: number): string;
export function mergeGraphs(list: unknown[]): unknown;
/** Attaches a view (a pop-out map window) to the bridge directly; `post` receives host → view messages. */
export function connectView(post: (msg: unknown) => void): { send(msg: unknown): void; graph(): unknown; close(): void };
