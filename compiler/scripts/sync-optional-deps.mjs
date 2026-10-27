// The platform packages (npm/*) at this package's version, and this package's optionalDependencies on them: what
// `npm run version` leaves before a release is published (.github/workflows/compiler.yml).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const read = f => JSON.parse(readFileSync(f, "utf8"));
const write = (f, j) => writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
const pkg = read("package.json");
for (const dir of readdirSync("npm")) {
  const p = read(`npm/${dir}/package.json`);
  p.version = pkg.version;
  write(`npm/${dir}/package.json`, p);
  pkg.optionalDependencies[p.name] = pkg.version;
}
write("package.json", pkg);
