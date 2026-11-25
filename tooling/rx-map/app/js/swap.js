// A module replacement's swap (map.html's runApply timer and swap): the new graph goes in 620 ms after `apply`; each
// token slides from where it was (FLIP); what the map showed live carries over to the new tokens; the selection follows
// its key; the `done` changes that came early roll in after.
import { reducedMotion } from "./env.js";
import { mirror, modIndex } from "./livestate.js";
import { snapshotPositions, flip, settlePlates, orb, hmrApply } from "./fx.js";
import { anchorOf } from "./geometry.js";

let timer = 0;
/** Calls `swap` once the apply animation has played. */
export function scheduleSwap(swap) { clearTimeout(timer); timer = setTimeout(swap, reducedMotion() ? 150 : 620); }
export function cancelSwap() { clearTimeout(timer); timer = 0; }

const chipsNow = M => [...document.querySelectorAll("#board .chip[data-id]")]
  .map(el => ({ id: el.dataset.id, key: M.nodes.get(el.dataset.id)?.key }))
  .filter(x => x.key);

/** The apply phase's look: plates lift, kept tokens glint, reset flip, re-run spin, removed fade, the tray rises. */
export function playApply(M) {
  const h = mirror().hmr, p = h.plan?.plan ?? {};
  const ids = keys => (keys ?? []).flatMap(k => M.keyIds.get(k) ?? []).filter(id => anchorOf(id)?.classList.contains("chip"));
  hmrApply({ plates: (h.plan?.modules ?? []).map(m => modIndex(M.G, m)).filter(i => i >= 0), kept: ids(p.kept), reset: ids(p.reset), rerun: ids(p.rerun), removed: ids(p.removed) });
}

let pending = null;
/**
 * Before the new graph is drawn: where each token is, by key. Returns the key of `selected` (to follow it), or "".
 */
export function beforeSwap(M, selected) {
  const h = mirror().hmr, p = h.plan?.plan ?? {};
  pending = {
    was: snapshotPositions(chipsNow(M)),
    movedFrom: Object.fromEntries((p.moved ?? []).map(m => [m.to, m.from])),
    added: [...(p.added ?? [])],
    modules: [...(h.plan?.modules ?? [])],
    selKey: selected ? M.nodes.get(selected)?.key ?? "" : "",
    hadSel: !!selected,
  };
}

/**
 * After the new graph is drawn (`M` its model): slides, settles, puts the orbs back, and runs `done(changes)` with the
 * early `done` changes. Returns what to select ({ id, hadSel }), or null when no swap was waiting.
 */
export function afterSwap(M, done) {
  if (!pending) return null;
  const { was, movedFrom, added, modules, selKey, hadSel } = pending;
  pending = null;
  settlePlates(modules.map(m => modIndex(M.G, m)).filter(i => i >= 0));
  flip(was, chipsNow(M), movedFrom, added);
  for (const k of Object.keys(mirror().flying)) for (const id of M.keyIds.get(k) ?? []) if (anchorOf(id)?.classList.contains("chip")) orb(id, "start");
  const early = mirror().hmr.pendingDone;
  if (early) setTimeout(() => done(early), reducedMotion() ? 0 : 380);
  return { id: (selKey && M.keyIds.get(selKey)?.[0]) ?? "", hadSel };
}
