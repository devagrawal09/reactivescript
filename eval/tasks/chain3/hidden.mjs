// Round 7, chain step 3: every step's hidden tests so far, deduplicated by name. Never shown to the agent.
import s0 from "../labels/hidden.mjs";
import s1 from "../count/hidden.mjs";
import s2 from "../related/hidden.mjs";

const seen = new Set();
export default [...s0, ...s1, ...s2].filter(t => !seen.has(t.name) && seen.add(t.name));
