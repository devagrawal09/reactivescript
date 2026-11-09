// One eval fuzz program (docs/EVAL.md, "Eval fuzz"): the plan fuzz's program for the seed, split into an enclosing
// component and evaluated code (eval/fuzz/gen.ts), run on the four eval legs (eval/harness/run.ts), plus one check
// against the plan fuzz: the code is refused exactly when, and with the diagnostic with which, plan/resolve-v2.ts
// refuses the same program written statically.
import { loadTsxModules } from '../../tsx/modules.ts';
import { resolvePlanV2 } from '../../plan/resolve-v2.ts';
import { emit } from '../../plan/fuzz/gen.ts';
import { hostSigs } from '../../plan/fuzz/run.ts';
import { runEvalProgram, type EvalOutcome } from '../harness/run.ts';
import { generateEval } from './gen.ts';

export type EvalFuzzOutcome = EvalOutcome & { seed: number; family: string; mode: string; syntax: string; reload: boolean; outer: string[]; bindings: string[]; baseRefusal?: string };

export async function runEvalSeed(seed: number, opts: { rust?: string; timeoutMs?: number; keep?: string } = {}): Promise<EvalFuzzOutcome> {
  const c = generateEval(seed);
  const o = await runEvalProgram({ name: 'eval fuzz seed ' + seed, files: c.files, hosts: hostSigs(c.base), record: c.base }, opts);
  const files = emit(c.base);
  let baseRefusal: string | undefined;
  try { resolvePlanV2(loadTsxModules('App.rx', p => files[p])); } catch (e) { baseRefusal = (e as Error).message; }
  const out: EvalFuzzOutcome = { ...o, seed, family: c.base.family, mode: c.mode, syntax: c.syntax, reload: c.reload, outer: c.outer, bindings: c.bindings, ...(baseRefusal ? { baseRefusal } : {}) };
  if (o.status === 'refused' && (!baseRefusal || !o.detail?.endsWith(': ' + baseRefusal)))
    return { ...out, status: 'divergent', classes: [...o.classes, baseRefusal ? 'eval refused with another diagnostic than the plan' : 'eval refused a program the plan accepts'] };
  if (o.status === 'agree' && baseRefusal) return { ...out, status: 'divergent', classes: ['eval accepted a program the plan refuses'] };
  return out;
}
