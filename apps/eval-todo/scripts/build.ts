// Bundles the page into dist/. The host's TSX goes through Solid 2's own compiler (DOM output on @solidjs/web) after
// esbuild strips its types; .rx files load as text (the code the page evaluates). Solid resolves from
// frontend/node_modules, the pinned build the eval runtime uses, so the host and the evaluated plans share one runtime.
//   node --experimental-strip-types scripts/build.ts           build dist/
//   node --experimental-strip-types scripts/build.ts --serve   build, watch and serve http://127.0.0.1:4190 (PORT)
import { context, transform as esTransform, type Plugin } from 'esbuild';
import { transform as solidTransform } from '../../../frontend/node_modules/@solidjs/compiler/index.js';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const serve = process.argv.includes('--serve');

const solid: Plugin = {
  name: 'solid-tsx',
  setup(b) {
    b.onLoad({ filter: /\.tsx$/ }, async args => {
      const src = readFileSync(args.path, 'utf8');
      const stripped = await esTransform(src, { loader: 'tsx', jsx: 'preserve', format: 'esm', sourcefile: args.path });
      const out = solidTransform(stripped.code, { filename: args.path, generate: 'dom', moduleName: '@solidjs/web', dev: serve });
      return { contents: out.code, loader: 'js', resolveDir: args.path.replace(/[^/]+$/, '') };
    });
  },
};

mkdirSync(here('../dist'), { recursive: true });
copyFileSync(here('../client/index.html'), here('../dist/index.html'));
const ctx = await context({
  // The page, and the checker's worker (half-typed code can hang the RX parser, so it never runs on the page).
  entryPoints: { app: here('../client/main.tsx'), check: here('../client/check-worker.ts') },
  outdir: here('../dist'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  conditions: ['browser', ...(serve ? ['development'] : [])],
  nodePaths: [here('../../../frontend/node_modules')],
  target: 'es2022',
  sourcemap: 'inline',
  logLevel: 'error',
  loader: { '.rx': 'text' },
  plugins: [solid],
  // Node-only modules on the compile path that the RX path never calls: stubbed for the page.
  alias: {
    'oxc-parser/src-js/index': here('../client/stubs/oxc-parser.ts'),
    '@solidjs/compiler': here('../client/stubs/solid-compiler.ts'),
    'node:url': here('../client/stubs/node-url.ts'),
  },
});
if (serve) {
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: here('../dist'), host: '127.0.0.1', port: Number(process.env.PORT ?? 4190) });
  console.log('serving http://127.0.0.1:' + port);
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log('dist/ built');
}
