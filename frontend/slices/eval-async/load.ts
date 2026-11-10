// The async eval slice's files (docs/EVAL.md, "Async data"), as eval/harness/run.ts takes a program.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HostSig } from '../../plan/fuzz/host.ts';
const here = (f: string) => fileURLToPath(new URL('./' + f, import.meta.url));
export const slice = (f: string) => readFileSync(here(f), 'utf8');
export const sliceFiles = (): Record<string, string> => ({ 'App.rx': slice('eval-async.rx'), 'App.tsx': slice('eval-async.tsx'), 'Static.tsx': slice('eval-async.static.tsx'), 'api.d.rx': slice('api.d.rx') });
/** Format 2.1: the structured result printed canonically, as the plan prints it. */
export const sliceHosts: HostSig[] = [
  { name: 'assignIssue', parameters: ['number'], returns: 'string', async: true },
  { name: 'loadIssues', parameters: [], returns: '{ id: number, title: string, owner: string }[]', async: true },
];
export const slicePath = here;
