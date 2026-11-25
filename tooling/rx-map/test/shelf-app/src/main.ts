// `?cap=N` sets the live timeline's capacity (TRACE-CONTRACT ring) before the map's recorder starts.
const cap = Number(new URLSearchParams(location.search).get('cap'));
if (cap > 0) (globalThis as any).__RX_TIMELINE_CAPACITY__ = cap;
const { createApp } = await import('@reactivescript/runtime');
await import('./App.css');
// @ts-expect-error rx-tsc's projection of App.rx has no default export yet
const { default: main } = await import('./App.rx');

const app = createApp({ root: document.getElementById('app')! });
app.mount(main(app));
