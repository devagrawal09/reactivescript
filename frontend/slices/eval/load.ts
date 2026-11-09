// The eval slice's files (docs/EVAL.md, "Gate"), as eval/harness/run.ts takes a program.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HostSig } from '../../plan/fuzz/host.ts';
const here = (f: string) => fileURLToPath(new URL('./' + f, import.meta.url));
export const slice = (f: string) => readFileSync(here(f), 'utf8');
export const sliceFiles = (): Record<string, string> => ({ 'App.rx': slice('eval.rx'), 'App.tsx': slice('eval.tsx'), 'Static.tsx': slice('eval.static.tsx'), 'api.d.rx': slice('api.d.rx') });
export const sliceHosts: HostSig[] = [{ name: 'save', parameters: ['number'], returns: 'string', async: true }];
export const slicePath = here;
