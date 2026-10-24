// Errors shared by the checker and the interpreter.
export class RuleError extends Error { rule: string; constructor(rule: string, msg: string) { super(`${rule}: ${msg}`); this.rule = rule; } }

/** One static diagnostic: Solid's code where one exists (CN-1b), the spec rule it enforces, and the nearest declaration's line. */
export type Diagnostic = { code: string; rule: string; line: number; msg: string; file?: string };

/** The checker refused the program (08 CN-1a: every static diagnostic is an error). */
export class CheckError extends RuleError {
  diagnostics: Diagnostic[];
  constructor(diagnostics: Diagnostic[]) {
    super(diagnostics[0].rule, diagnostics.map(d => `${d.code} (${d.rule}) ${d.file ? `${d.file}:` : "line "}${d.line}: ${d.msg}`).join("\n  "));
    this.diagnostics = diagnostics;
  }
}
