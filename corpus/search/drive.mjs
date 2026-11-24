// Input 0 is the box. Button 0 is Clear, always.
// Result buttons follow, in result order, once that answer is showing.
// Empty query answers Alloy, Alpine, Amber. "a" is five hits. "al" is two.
// "z" is none. "b" is Bolt. "c" is Cedar, Cinder. "tool" is Atlas, Bolt.
// Clear re-asks the empty query. Do not type again before resolving.
export const steps = [
  { resolve: true },
  { click: 1 },
  { input: 0, value: "a" },
  { resolve: true },
  { click: 1 },
  { click: 3 },
  { input: 0, value: "al" },
  { resolve: true },
  { click: 1 },
  { click: 0 },
  { resolve: true },
  { input: 0, value: "z" },
  { resolve: true },
  { input: 0, value: "b" },
  { resolve: true },
  { click: 1 },
  { input: 0, value: "c" },
  { resolve: true },
  { click: 2 },
  { click: 0 },
  { resolve: true },
  { input: 0, value: "tool" },
  { resolve: true },
  { click: 1 },
  { click: 2 },
  { click: 0 },
  { resolve: true },
]
