// Views are JSX; Solid's own compiler (@solidjs/compiler, from the next branch) lowers them for each target, so the
// DOM, the server and the test renderer run exactly the code shape Solid's compiler emits — hydration keys, marker
// regions, scoped holes, fragment memos (spec 10, Implementation). The reactive declarations around them are __rt calls.
import { transform } from "@solidjs/compiler";
import { fileURLToPath } from "node:url";
export type Target = "universal" | "dom" | "ssr";
export const STRING_RENDERER = fileURLToPath(new URL("./string-renderer.ts", import.meta.url));
/** Each module's JSX → JavaScript for `target` (dom and ssr with hydration; universal over the test renderer). */
export function lowerViews(files: Map<string, string>, target: Target): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, code] of files) {
    const r = transform(code, { filename: name.replace(/\.mjs$/, ".jsx"), generate: target, hydratable: target !== "universal", moduleName: target === "universal" ? STRING_RENDERER : "@solidjs/web" });
    out.set(name, r.code);
  }
  return out;
}
