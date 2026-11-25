// The shelf app for test/real-host.mjs: the rx-r1 browser template with a deterministic fake server.
import solid from '@solidjs/vite-plugin';
import { rxMap } from '@reactivescript/map/vite';

export default {
  plugins: [solid({ diagnostics: true }), rxMap()],
  resolve: { dedupe: ['solid-js', '@solidjs/web', '@solidjs/signals'] },
  build: { target: 'esnext' },
};
