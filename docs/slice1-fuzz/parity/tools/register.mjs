// Prod build flags (rollup.config.js) and the .js -> .ts loader for the Solid src copy.
import {register} from 'node:module';globalThis.__DEV__=false;globalThis.__OBSERVE__=false;globalThis.__TEST__=false;register('./hooks.mjs',import.meta.url);
