// Round 7, chain step 2: every step's hidden-overlap tests so far, deduplicated by name. Never shown to the agent.
import s0 from "../labels/hidden-overlap.mjs";
import s1 from "../count/hidden-overlap.mjs";

const seen = new Set();
export default [...s0, ...s1].filter(t => !seen.has(t.name) && seen.add(t.name));
