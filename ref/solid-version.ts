// Which Solid the runners run on: the next branch built from source at the pinned commit (scripts/solid-next.sh).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
const pin = readFileSync(new URL("./SOLID_NEXT", import.meta.url), "utf8").trim().slice(0, 7);
export const SOLID = `solid-js ${req("solid-js/package.json").version} (next @ ${pin})`;
