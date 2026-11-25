#!/usr/bin/env node
// rx-dts: the .d.rx rows of a TypeScript module, generated from it (spec/09 MO-11).
//   rx-dts <file.ts | stem>      print the generated declaration; errors to stderr, exit 1 if any
//   rx-dts --json <file | stem>  print the record { from, text, errors, files } (`null`: no TS module)
//   rx-dts --record <stem>       the same, cached in <nearest node_modules>/.cache/rx-dts/ while the stamps
//                                (mtime, size) of the record's files match: how `rxc` asks (contract §5)
// TypeScript loads only when a record is generated, so a cache hit is a few file stats.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const usage = "usage: rx-dts <file.ts | stem> | --json <file.ts | stem> | --record <stem>";
const args = process.argv.slice(2);
const posix = p => p.replace(/\\/g, "/");
const abs = p => posix(path.resolve(p));
const TS_EXT = /\.(d\.ts|d\.mts|d\.cts|ts|tsx|mts|cts)$/;
const JS_EXT = /\.(js|mjs|cjs|jsx)$/;

function fail(message) {
  process.stderr.write(`rx-dts: ${message}\n`);
  process.exit(2);
}

const flag = args[0]?.startsWith("--") ? args[0] : null;
const target = flag ? args[1] : args[0];
if (!target || args.length > (flag ? 2 : 1) || (flag && !["--json", "--record"].includes(flag))) fail(usage);

try {
  if (flag === "--record") await record(abs(target));
  else {
    const declarations = await load();
    const r = recordOf(declarations, target);
    if (flag === "--json") process.stdout.write(JSON.stringify(r) + "\n");
    else {
      if (!r) fail(`no TypeScript module for ${target}`);
      process.stdout.write(r.text);
      for (const e of r.errors) process.stderr.write(`${e.file}:${e.line}:${e.column}: error ${e.code} ${e.message}\n`);
      if (r.errors.length) process.exitCode = 1;
    }
  }
} catch (e) {
  fail(e?.message ?? String(e));
}

async function load() {
  const { createDeclarations } = await import("../dts.mjs");
  return createDeclarations();
}

// a path with a TS extension that exists is that file; anything else is a stem (`.js` dropped, as MO-8a)
function recordOf(declarations, arg) {
  const file = abs(arg);
  if (TS_EXT.test(file) && isFile(file)) return declarations.file(file);
  return declarations.record(file.replace(JS_EXT, ""));
}

function isFile(f) {
  try { return fs.statSync(f).isFile(); } catch { return false; }
}

function stamps(files) {
  return files.map(f => {
    try { const s = fs.statSync(f); return [f, s.mtimeMs, s.size]; } catch { return [f, -1, -1]; }
  });
}

function cacheDir(stem) {
  for (let d = path.dirname(stem); ; d = path.dirname(d)) {
    const nm = path.join(d, "node_modules");
    try { if (fs.statSync(nm).isDirectory()) return path.join(nm, ".cache", "rx-dts"); } catch {}
    if (d === path.dirname(d)) return null;
  }
}

async function record(stem) {
  const { findModule } = await import("../dts.mjs");
  const T = findModule(stem, isFile);
  if (!T) { process.stdout.write("null\n"); return; }
  const dir = cacheDir(stem);
  const file = dir && path.join(dir, `${createHash("sha1").update(stem).digest("hex")}.json`);
  if (file) {
    try {
      const cached = JSON.parse(fs.readFileSync(file, "utf8"));
      const now = stamps(cached.stamps.map(s => s[0]));
      if (cached.record?.from === T && now.every((s, i) => s[1] === cached.stamps[i][1] && s[2] === cached.stamps[i][2])) {
        process.stdout.write(JSON.stringify(cached.record) + "\n");
        return;
      }
    } catch {}
  }
  const declarations = await load();
  const r = declarations.record(stem);
  process.stdout.write(JSON.stringify(r) + "\n");
  if (file && r) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ record: r, stamps: stamps(r.files) }));
      fs.renameSync(tmp, file);
    } catch {}
  }
}
