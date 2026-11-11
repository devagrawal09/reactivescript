// Slice 6 (docs/RESULTS.md, "Slice 6: inferred server components"): a frames program's modules compiled the way
// @solidjs/vite-plugin's Start mode compiles them (its src/server-functions/index.ts and src/ssr/index.ts at
// origin/next), without the plugin: Solid's directive pass (`transformDirectives`) and then its JSX transform.
//   server  transformDirectives({ mode: "server" }) + transform({ generate: "ssr", hydratable: true, serverComponents: true })
//   client  transformDirectives({ mode: "client" }) + transform({ generate: "dom", hydratable: true })
// Module paths are fixed (FRAMES_ROOT + "/src/<file>"), so every wire id (`<name>-<xxHash32(root-relative path)>`)
// is fixed too. Types are stripped by node:module. Relative imports are rewritten to the compiled files' names:
// `./x.tsx` -> `./x.js` (client) or `./x.mjs` (server); the server-only host module `./db` -> `./db.mjs`.
import { stripTypeScriptTypes } from 'node:module';
import { transform, transformDirectives } from '@solidjs/compiler';

/** The virtual project root every frames program is compiled under. */
export const FRAMES_ROOT = '/frames-app';
const RUNTIME = '@solidjs/web/server-functions';
const DEFINITIONS = {
  register: { kind: 'named', name: 'registerServerReference', source: RUNTIME },
  create: { kind: 'named', name: 'createServerReference', source: RUNTIME },
};

export type Side = 'server' | 'client';
export type Compiled = { code: string; functions: { id: string; name: string; exports: string[] }[]; directives: boolean };

/** `file`: the module's path under `src/` (for example `tracker-frames.server.tsx`). `hostModules`: the specifiers of
 *  server-only host modules (rewritten to `<name>.mjs` on the server; a client module that still imports one after the
 *  directive pass is an error: it would put server-only code in the browser). */
export function compileModule(source: string, file: string, side: Side, hostModules: string[] = ['./db']): Compiled {
  const filename = FRAMES_ROOT + '/src/' + file;
  const d = transformDirectives(source, { filename, root: FRAMES_ROOT, mode: side, env: 'production', directive: 'use server', sourceMap: false, ...DEFINITIONS });
  const code0 = d.valid ? d.code : source;
  const t = transform(code0, { filename, generate: side === 'server' ? 'ssr' : 'dom', hydratable: true, ...(side === 'server' ? { serverComponents: true } : {}) });
  let code = stripTypeScriptTypes(t.code);
  for (const h of hostModules) {
    const spec = JSON.stringify(h);
    if (side === 'client' && code.includes(spec)) throw new Error('the client compile of ' + file + ' still imports the server-only host module ' + h);
    code = code.replaceAll(spec, JSON.stringify(h + '.mjs'));
  }
  code = code.replace(/(["'])(\.\/[^"']+)\.tsx\1/g, (_, q, p) => q + p + (side === 'server' ? '.mjs' : '.js') + q);
  return { code, functions: d.valid ? d.functions.map(f => ({ id: f.id, name: f.name, exports: [...f.exports] })) : [], directives: d.valid };
}

/** The wire ids `transformDirectives` assigns to a module's `"use server"` functions, by function name. */
export function wireIds(source: string, file: string): Record<string, string> {
  const filename = FRAMES_ROOT + '/src/' + file;
  const d = transformDirectives(source, { filename, root: FRAMES_ROOT, mode: 'server', env: 'production', directive: 'use server', sourceMap: false, ...DEFINITIONS });
  return Object.fromEntries((d.valid ? d.functions : []).map(f => [f.name, f.id]));
}
