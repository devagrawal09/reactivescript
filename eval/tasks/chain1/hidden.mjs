// Round 7, chain step 1: every step's hidden tests so far, deduplicated by name. Never shown to the agent.
import s0 from "../labels/hidden.mjs";

const seen = new Set();
export default [...s0].filter(t => !seen.has(t.name) && seen.add(t.name));
