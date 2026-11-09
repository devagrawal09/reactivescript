// The renderer module compiled code imports in a plan-fuzz leg (Solid's universal transform's `moduleName`, and the RX
// lowering's STRING_RENDERER): the helpers of the leg's recording host (host.ts), created before any compiled module is
// imported, plus Solid's control flow, as the reference string renderer exports them.
const host = (globalThis as { __planFuzzHost?: { R: Record<string, unknown> } }).__planFuzzHost;
if (!host) throw new Error('the plan-fuzz host is created before compiled code is imported');
export const { render, effect, memo, createComponent, createElement, createTextNode, insertNode, insert, spread, setProp, mergeProps, applyRef, ref } = host.R as Record<string, any>;
export { Show, For, Switch, Match, Loading, Errored, Repeat, Reveal } from 'solid-js';
