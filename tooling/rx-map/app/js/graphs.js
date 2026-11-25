// The graphs the map has drawn, by number. A graph is big and never changes once drawn, so the program holds its
// number in a source, not the graph: a `source` with an object in it is a Solid store, which would proxy every node
// and edge (and the model's own annotations on them) for nothing.
import { servedGraph } from "./env.js";

const graphs = [servedGraph()];
/** Keeps a graph; its number. */
export const putGraph = g => graphs.push(g) - 1;
/** The graph kept under `n`. */
export const graphAt = n => graphs[n];
