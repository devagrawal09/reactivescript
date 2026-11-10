// One eval fuzz program (docs/EVAL.md, "Eval fuzz"): the plan fuzz's program for the seed, split into an enclosing
// component and evaluated code (eval/fuzz/gen.ts), run on the four eval legs (eval/harness/run.ts), plus one check
// against the plan fuzz: the code is refused exactly when, and with the diagnostic with which, plan/resolve-v2.ts
// refuses the same program written statically.
import { loadTsxModules } from '../../tsx/modules.ts';
import { resolvePlanV2 } from '../../plan/resolve-v2.ts';
import { emit } from '../../plan/fuzz/gen.ts';
import { hostSigs } from '../../plan/fuzz/run.ts';
import { asyncHostSigs, emitAsync } from '../../plan/fuzz/gen-async.ts';
import { runEvalProgram, type EvalOutcome } from '../harness/run.ts';
import { generateEval, generateEvalAsync } from './gen.ts';
import { fileURLToPath } from 'node:url';

export type EvalFuzzOutcome = EvalOutcome & { seed: number; family: string; mode: string; syntax: string; reload: boolean; outer: string[]; bindings: string[]; baseRefusal?: string };

/** `async`: the plan v2.1 eval fuzz (generateEvalAsync): the v2.1 fuzz's program split, format 2.1 scenarios recorded
 *  with gen-async.ts's chooser, the v2.1 builder for the static program's refusal, Rust's refusal of a v2.1 plan
 *  reported as rust-unsupported. */
export async function runEvalSeed(seed: number, opts: { rust?: string; timeoutMs?: number; keep?: string; async?: boolean } = {}): Promise<EvalFuzzOutcome> {
  const c = opts.async ? generateEvalAsync(seed) : generateEval(seed);
  const o = await runEvalProgram(c.async
    ? { name: 'eval fuzz v2.1 seed ' + seed, files: c.files, hosts: asyncHostSigs(c.async), record: c.async, async: true, chooser: fileURLToPath(new URL('../../plan/fuzz/gen-async.ts', import.meta.url)) }
    : { name: 'eval fuzz seed ' + seed, files: c.files, hosts: hostSigs(c.base), record: c.base }, opts);
  const files = c.async ? emitAsync(c.async) : emit(c.base);
  let baseRefusal: string | undefined;
  try { resolvePlanV2(loadTsxModules('App.rx', p => files[p], c.async ? { async: true } : {}), c.async ? { async: true } : {}); } catch (e) { baseRefusal = (e as Error).message; }
  const out: EvalFuzzOutcome = { ...o, seed, family: c.base.family, mode: c.mode, syntax: c.syntax, reload: c.reload, outer: c.outer, bindings: c.bindings, ...(baseRefusal ? { baseRefusal } : {}) };
  if (o.status === 'refused' && (!baseRefusal || !o.detail?.endsWith(': ' + baseRefusal)))
    return { ...out, status: 'divergent', classes: [...o.classes, baseRefusal ? 'eval refused with another diagnostic than the plan' : 'eval refused a program the plan accepts'] };
  if ((o.status === 'agree' || o.status === 'rust-unsupported') && baseRefusal) return { ...out, status: 'divergent', classes: ['eval accepted a program the plan refuses'] };
  return out;
}
