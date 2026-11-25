# Lazy component modules

RX has no specified component code-splitting form yet. Keep it out of
the implementation until the import signature and server behavior are
specified together.

Recommendation: put lazy on the component import, not at every render
site. For example, a future `import lazy { Analytics } from "./Analytics.rx"`
would use the same static component signature as an eager import.
The first active application requests the chunk and is pending under the
existing `loading`; the chunk's rejection uses `errored`. Rendering an
inactive branch must not fetch the chunk. Cache the chunk per loader,
not a mounted component instance. Once loaded, instance ownership and
disposal work exactly like eager application.

Decide how the server resolves and preloads that same chunk for hydration,
and how a retry re-asks a rejected import, before shipping the syntax.
For now, keep the component eager and defer the expensive data question.
