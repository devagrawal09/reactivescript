// Bundles the page (client/main.ts) for the browser into dist/app.js. Solid resolves from frontend/node_modules, the
// same pinned build the frontend and the eval runtime use, so the page and the evaluated plans share one runtime.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const result = await build({
  entryPoints: [here('../client/main.ts')],
  outfile: here('../dist/app.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  conditions: ['browser'],
  nodePaths: [here('../../../frontend/node_modules')],
  target: 'es2022',
  sourcemap: 'inline',
  logLevel: 'error',
  metafile: true,
  // Node-only modules on the compile path that the RX path never calls: stubbed for the page.
  alias: {
    'oxc-parser/src-js/index': here('../client/stubs/oxc-parser.ts'),
    '@solidjs/compiler': here('../client/stubs/solid-compiler.ts'),
    'node:url': here('../client/stubs/node-url.ts'),
  },
});
const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
console.log('dist/app.js built (' + Math.round(bytes / 1024) + ' KiB with source map)');
