import { registerHooks, createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Resolve npm packages from the installed export. RX imports still use the clean tree.
const parentURL = pathToFileURL("/var/folders/k4/g2_9q0g52437sbcp5m856r6m0000gn/T/rx-canary.N1oZoN/frontend/package.json").href;
const requireFromInstall = createRequire(parentURL);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const bare = !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.includes(":");
    if (context.conditions.includes("require")) {
      if (specifier === "solid-js/package.json" && !context.parentURL?.includes("/frontend/")) return { url: pathToFileURL(requireFromInstall.resolve(specifier)).href, shortCircuit: true };
      return nextResolve(specifier, context);
    }
    return nextResolve(specifier, bare ? { ...context, parentURL } : context);
  }
});
