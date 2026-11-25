// 09 MO-11d: the ref runners' generator host. A program's files are in memory (a scenario's `## Modules`, or the files a
// conformance request carries); the loader asks `rx-dts:<stem>` through the same `read` for a TS module's declaration
// (modules.ts), and this answers it in process with the one generator, `compiler/dts.mjs`, over those same files — so ref
// and the crate (`rxc conform`/`lower`/`project`, given the answers in `files`) read the same record.
import ts from "typescript";
import { dtsKey } from "./modules.ts";

type Read = (path: string) => string | undefined;
type Generator = { record(stem: string): { from: string; text: string; errors: { file: string }[]; files: string[] } | null };
const dts = await import("../../compiler/dts.mjs").catch(() => null) as { createDeclarations(o: object): Generator } | null;

const generators = new WeakMap<object, Generator>();
/** `read`, answering `rx-dts:<stem>` with the record (JSON) generated from the program's own files. `key`: what the files
 *  are (a scenario's module map), so the programs of one scenario share a generator (TypeScript's program is incremental). */
export function withDeclarations(read: Read, key: object = read): Read {
  // the generator resolves paths from `/`; a key the loader has relative (`api.ts`) is read as `/api.ts`, and given back as it was
  const at = (f: string) => read(f) ?? (f.startsWith("/") ? read(f.slice(1)) : undefined);
  const back = (f: string) => read(f) !== undefined || !f.startsWith("/") ? f : f.slice(1);
  return (p: string) => {
    if (!p.startsWith(dtsKey(""))) return read(p);
    if (!dts) return undefined;
    let gen = generators.get(key);
    if (!gen) { gen = dts.createDeclarations({ ts, read: at, fileExists: (f: string) => at(f) !== undefined, cwd: "/" }); generators.set(key, gen); }
    const stem = p.slice(dtsKey("").length);
    const r = gen.record(stem.startsWith("/") ? stem : "/" + stem);
    if (!r) return "null";
    return JSON.stringify({ ...r, from: back(r.from), errors: r.errors.map(e => ({ ...e, file: back(e.file) })), files: r.files.map(back) });
  };
}
