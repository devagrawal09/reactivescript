// MO-3: a module's signature printed as `.d.rx` text — what an importer is checked against (display only; reading a `.d.rx` in
// place of its module is not in ref/ yet).
import type { ModSig, ExportSig } from "./check.ts";

const cls = (c: Set<string> | "all") => c === "all" ? "Error" : [...c].sort().join(" | ");
const rows = (r: string[], fails: string[]) => [...["io", "pending", "lane"].filter(x => r.includes(x)), ...(fails.length ? [`fails(${[...fails].sort().join(" | ")})`] : [])].join(" ");

function line(name: string, x: ExportSig): string {
  switch (x.kind) {
    case "source": { const r = rows(x.rows, x.fails); return `export source ${name}${r ? `: ${r}` : ""}${x.question ? "   // a question" : ""}`; }
    case "eq": { const r = rows(x.io ? ["io", ...x.rows] : x.rows, x.fails); return `export ${name}${r ? `: ${r}` : ""}`; }
    case "fn": { const r = rows(x.rows, x.fails); const rj = x.rejects.length && !(x.rejects.length === 1 && x.rejects[0] === "Error") ? ` rejects(${x.rejects.join(" | ")})` : ""; return `export fn ${name}(${x.params.map(p => (p.ref ? "ref " : "") + p.name).join(", ")})${r ? `: ${r}` : ""}${rj}${x.instantiating ? "   // instantiating (RG-6)" : ""}`; }
    case "action": return `export action ${name}`;
    case "errclass": return `export error ${name}(${x.params.join(", ")})`;
    case "type": return `export type ${name}`;
    case "context": { const r = rows(x.rows, x.fails); const t = [x.source ? "source" : "", r, x.type ?? ""].filter(Boolean).join(" "); return `export context ${name}${t ? `: ${t}` : ""}${x.dflt ? " = …" : ""}`; }
    case "comp": {
      const s = x.sig;
      const props = Object.entries(s.props).map(([f, v]) => {
        const parts: string[] = [];
        if (v.rendered && !(v.f instanceof Set && v.f.size === 0)) parts.push(`catches(${cls(v.f)})`);
        if (f === "children" && v.rendered && !(v.p instanceof Set && v.p.size === 0)) parts.push(v.p === "all" ? "provides(*)" : `provides(${[...v.p].join(", ")})`);
        if (v.action) parts.push(`action catches(${v.action.f instanceof Set && v.action.f.size === 0 ? "nothing" : cls(v.action.f)})`);
        return `${f === "*" ? "...props" : f}${parts.length ? `: ${parts.join(" ")}` : ""}`;
      });
      const own = [...new Set(s.own.map(o => o.cls))];
      return `export component ${name}(props: ${props.length ? `{ ${props.join("; ")} }` : "{}"})${own.length ? ` fails(${own.sort().join(" | ")})` : ""}${s.requires.length ? ` uses(${s.requires.map(k => `${k.split("#")[0].split("/").pop()}#${k.split("#").pop()!.replace(/@\d+$/, "")}`).join(", ")})` : ""}`;
    }
  }
}

export function printSignature(sig: ModSig): string {
  const out = [`// ${sig.file} — signature (09-modules MO-3). Sources are read-only to importers (MO-2).`];
  for (const [n, x] of sig.exports) out.push(line(n, x));
  return out.join("\n") + "\n";
}
