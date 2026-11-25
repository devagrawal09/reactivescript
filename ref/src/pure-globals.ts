// SV-7a: the same allowlist the Rust compiler checks.
import allowed from "../../spec/pure-globals.json" with { type: "json" };

export function pureGlobal(name: string, member?: string): boolean {
  return Object.hasOwn(allowed, name) && (member === undefined || allowed[name as keyof typeof allowed].includes(member));
}

export function pureGlobalValue(name: string): unknown {
  return (globalThis as Record<string, unknown>)[name];
}
