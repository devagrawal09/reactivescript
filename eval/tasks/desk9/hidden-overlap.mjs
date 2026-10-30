// Round 7, chain step 4: every step's hidden-overlap tests so far, deduplicated by name. Never shown to the agent.
import s0 from "../labels/hidden-overlap.mjs";
import s1 from "../count/hidden-overlap.mjs";
import s2 from "../related/hidden-overlap.mjs";
import s3 from "../rows/hidden-overlap.mjs";

const seen = new Set();
export default [...s0, ...s1, ...s2, ...s3].filter(t => !seen.has(t.name) && seen.add(t.name));
