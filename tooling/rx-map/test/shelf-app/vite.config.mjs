// The shelf app for test/real-host.mjs: the rx-r1 browser template with a deterministic fake server.
import solid from '@solidjs/vite-plugin';
import { rxMap } from '@reactivescript/map/vite';
import { readFileSync } from 'node:fs';

// RX_MAP_PAGE=<file>: serve that file as @reactivescript/map's page.mjs (test/real-host.mjs with MAP_PAGE=app runs the
// RX build of the page this way, without touching the package's own page.mjs)
const pageSwap = file => ({
  name: 'rx-map-page-swap',
  enforce: 'pre',
  load(id) { if (id.split('?')[0].replace(/\\/g, '/').endsWith('/rx-map/page.mjs')) return readFileSync(file, 'utf8'); },
});

export default {
  plugins: [...(process.env.RX_MAP_PAGE ? [pageSwap(process.env.RX_MAP_PAGE)] : []), solid({ diagnostics: true }), rxMap()],
  resolve: { dedupe: ['solid-js', '@solidjs/web', '@solidjs/signals'] },
  build: { target: 'esnext' },
};
