// layout.mjs: one layout for every detail level. Boxes are finite, nothing overlaps, tokens sit inside their frames,
// module arrows point up, the result is deterministic, and the level (picked by zoom, with hysteresis) never feeds
// into a position.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, layoutWorld, planTrunks, levelFor, levelThresholds, LEVELS, METRICS } from "../layout.mjs";
import { mergeGraphs } from "../live.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const load = f => JSON.parse(readFileSync(resolve(here, "fixtures", f), "utf8"));
const graphs = {
  users: load("users.json"),
  tracker: load("tracker.json"),
  settings: load("settings.json"),
  big: mergeGraphs(["tracker", "settings", "notes", "cart", "todos", "users"].map(n => load(`${n}.json`))),
};
const lay = (g, o) => layoutWorld(analyze(g), o);
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a, b, e = .5) => a.x >= b.x - e && a.y >= b.y - e && a.x + a.w <= b.x + b.w + e && a.y + a.h <= b.y + b.h + e;
const finite = b => [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0 && b.h > 0;
const json = L => JSON.stringify(L, (k, v) => (v instanceof Map ? [...v] : v));

for (const [name, g] of Object.entries(graphs)) {
  const L = lay(g);
  test(`${name}: every box is finite and positive`, () => {
    assert.ok(Number.isFinite(L.width) && Number.isFinite(L.height) && L.width > 0 && L.height > 0);
    for (const m of [L.plates, L.frames, L.tokens, L.strips]) for (const [id, b] of m) assert.ok(finite(b), `${id}: ${JSON.stringify(b)}`);
    for (const b of [...L.clusters, ...L.reserved, ...L.worldGroups]) assert.ok(finite(b), JSON.stringify(b));
    for (const f of L.frames.values()) assert.ok(finite(f.label), `${f.id} label`);
  });
  test(`${name}: plates and tokens don't overlap`, () => {
    const ps = [...L.plates.values()];
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) assert.ok(!overlap(ps[i], ps[j]), `plates ${ps[i].key} ${ps[j].key}`);
    const ts = [...L.tokens.values()].filter(t => t.role !== "label");
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) assert.ok(!overlap(ts[i], ts[j]), `tokens ${ts[i].id} ${ts[j].id}`);
  });
  test(`${name}: sibling frames don't overlap; frames sit inside their parents, tokens inside their frames`, () => {
    const byParent = new Map();
    for (const f of L.frames.values()) (byParent.get(f.parent) ?? byParent.set(f.parent, []).get(f.parent)).push(f);
    for (const [p, fs] of byParent) {
      for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) assert.ok(!overlap(fs[i], fs[j]), `frames ${fs[i].id} ${fs[j].id}`);
      if (p) for (const f of fs) assert.ok(inside(f, L.frames.get(p)), `${f.id} in ${p}`);
    }
    for (const f of L.frames.values()) if (f.kind === "program") assert.ok(inside(f, L.plates.get(+f.id.split(":")[0])), f.id);
    for (const t of L.tokens.values()) {
      if (t.role === "world") { assert.ok(inside(t, L.plates.get("world")), t.id); continue; }
      const f = L.frames.get(t.region);
      assert.ok(f && inside(t, f), `${t.id} in ${t.region}`);
    }
    for (const [id, s] of L.strips) assert.ok(inside(s, L.frames.get(id)), `strip ${id}`);
  });
  test(`${name}: a module sits below every module it needs, so arrows between modules point up`, () => {
    const A = analyze(g);
    for (const [a, b] of [...A.G.edges].map(e => (e.type === "read" || e.type === "notifies" ? [e.to, e.from] : [e.from, e.to]))) {
      const na = A.nodes.get(a), nb = A.nodes.get(b);
      if (!na || !nb || na.mod === nb.mod || nb.world || na.world) continue;
      const pa = L.plates.get(na.mod), pb = L.plates.get(nb.mod);
      if (A.modLevel(na.mod) === A.modLevel(nb.mod)) continue;   // a cycle between modules: same band
      assert.ok(pa.y >= pb.y + pb.h, `${A.G.modules[na.mod]} below ${A.G.modules[nb.mod]}`);
    }
    const pairs = [...L.plates.keys()].flatMap(a => [...L.plates.keys()].map(b => `${a}>${b}`));
    for (const pts of planTrunks(pairs, L).values()) assert.ok(pts[0][1] > pts.at(-1)[1], "a bundle climbs");
  });
  test(`${name}: deterministic, and independent of the detail level`, () => {
    assert.equal(json(lay(g)), json(L));
    // nothing in the layout takes a level: every level draws into these same boxes. The levels only differ in
    // which tokens they show (`level`), and every token has a box whatever that is.
    for (const t of L.tokens.values()) assert.ok(t.level === 2 || t.level === 3, `${t.id} level ${t.level}`);
    const sites = [...L.tokens.values()].filter(t => t.role === "site");
    assert.ok(sites.every(t => t.level === 3));
  });
  test(`${name}: plates keep their size; areas for view sites and view text are reserved`, () => {
    for (const r of L.reserved) assert.ok(inside(r, L.frames.get(r.region)), r.region);
    for (const [id, s] of L.strips) assert.ok(L.reserved.some(r => r.kind === "strip" && r.region === id && r.x === s.x && r.y === s.y), id);
    for (const t of L.tokens.values()) if (t.role === "site") assert.ok(L.reserved.some(r => r.kind === "sites" && inside(t, r)), `site ${t.id} reserved`);
  });
}

test("the aspect is the only option that moves things; zoom isn't an input", () => {
  const a = lay(graphs.big, { aspect: 1.6 }), b = lay(graphs.big, { aspect: 1.6 });
  assert.equal(json(a), json(b));
  for (const [k, p] of a.plates) assert.deepEqual([p.w, p.h], [b.plates.get(k).w, b.plates.get(k).h]);
});

test("levelFor: a level comes in once its text reads at 11px; hysteresis on the way down", () => {
  const { up, down } = LEVELS;
  assert.ok(METRICS.nameFont * up[1] >= 11 && METRICS.siteFont * up[2] >= 11, "names at L2, view sites at L3, 11px or more");
  assert.ok(down[2] < up[1] && down[3] < up[2] && up[1] < up[2] && down[2] < down[3]);
  assert.equal(levelFor(.1, 3), 1);
  assert.equal(levelFor(1.2, 1), 3);
  // where only the structure level holds from either side: above 1→2, below 3→2
  const mid = (up[1] + Math.min(up[2], down[3])) / 2;
  assert.equal(levelFor(mid, 3), 2);
  assert.equal(levelFor(mid, 1), 2);
  // inside a band, the level holds
  const b2 = (down[2] + up[1]) / 2, b3 = (down[3] + up[2]) / 2;
  assert.equal(levelFor(b2, 2), 2); assert.equal(levelFor(b2, 1), 1);
  assert.equal(levelFor(b3, 3), 3); assert.equal(levelFor(b3, 2), 2);
  // up and down through the thresholds: one change each way
  let l = 1;
  const seq = [.3, b2, up[1] + .01, b2, b3, up[2] + .01, b3, down[3] - .01, b2, down[2] - .01].map(s => (l = levelFor(s, l)));
  assert.deepEqual(seq, [1, 1, 2, 2, 2, 3, 3, 2, 2, 1]);
  assert.deepEqual(levelThresholds({ minText: 11 }), LEVELS);
});
