// Live mode's plumbing (map.html's host, receive, connectHost, viewState, __RX_VIEW__, popOut, joinOpener,
// attachDirect): where messages to the host go, where the host's messages come in, and the pop-out window.
//
// A host is an in-page fake (`window.__RX_FAKE__`, with post / subscribe), the parent window (a dock's iframe), or,
// in a pop-out, the app page's bridge (`__RX__.connect`) or the map that opened it. Messages in go to the `receive`
// the page hands to `startLive` (live.rx's dispatch), then on to every pop-out this map feeds.
import { isLive, isRecording, isPopout, pristine, bodyClass, fakeSeed, servedGraph } from "./env.js";
import { replay } from "./replay.js";
import { startFake } from "./fakehost.js";
import { previewsOf, setLiveHooks } from "./livestate.js";
import { toast } from "./fx.js";
import { sfx } from "./sound.js";
import { playApply, scheduleSwap, cancelSwap } from "./swap.js";

const popups = new Set();   // pop-out windows this map relays to: { win, receive }
let opener = null;          // in a pop-out: the link to the map that opened it (or to the app's bridge)
let receiveFn = () => {};
let stateFn = null;         // the committed live state (startLive's `on.state`, a read of live.rx's store)
let currentGraph = null;
let fakeUnsub = null;

/** Sends a message to the host. */
export function post(m) {
  if (isRecording()) return;
  const msg = { source: "rx-map", v: 1, ...m };
  try {
    if (opener) opener.post(msg);
    else if (window.__RX_FAKE__?.post) window.__RX_FAKE__.post(msg);
    else if (window.parent && window.parent !== window) window.parent.postMessage(msg, "*");
  } catch {}
}
const hello = () => post({ type: "hello", want: ["live", "timeline", "travel", "hmr"] });

function receive(d) {
  if (!isLive() || !d || d.source !== "rx-map" || !(d.v === undefined || d.v === 1)) return;
  if (typeof d.type !== "string" || d.type.startsWith("~")) return;
  try { receiveFn(d); } catch (e) { console.error(e); }
  // the same stream goes on to every pop-out; a closed one is dropped
  for (const p of popups) { try { if (p.win.closed) popups.delete(p); else p.receive(d); } catch { popups.delete(p); } }
}

/** The graph the map draws now (kept up to date by live.rx): `__RX_VIEW__.graph()`, a pop-out's start. */
export function setCurrentGraph(g) { currentGraph = g; }

// What a view holds, as messages: a pop-out starts from it (as of the last commit; plain copies, not store proxies:
// the pop-out puts them in a store of its own)
function viewState() {
  const S = stateFn ? JSON.parse(JSON.stringify(stateFn())) : null;
  if (!S) return { graph: null, timeline: null, snapshot: null };
  const tl = S.tl;
  return {
    graph: S.hmr.swapped ? currentGraph : null,
    timeline: { source: "rx-map", v: 1, type: "timeline", head: tl.head, viewing: tl.viewing, capacity: tl.capacity, steps: tl.steps, flushes: S.flushes },
    snapshot: { source: "rx-map", v: 1, type: "snapshot",
      values: Object.entries(S.values).filter(([, v]) => v.preview !== undefined).map(([key, v]) => ({ key, preview: v.preview })),
      flights: Object.keys(S.flying).map(key => ({ key, since: tl.flights.findLast(f => f.key === key && f.end == null)?.start ?? 0 })),
      boundaries: Object.entries(S.boundaries).map(([region, b]) => ({ region, state: b.state, ...(b.error ? { error: b.error } : {}) })) },
  };
}

// `window.__RX_VIEW__`: for tests, tools and pop-outs. Set when this module loads (a pop-out checks its opener for it).
window.__RX_VIEW__ = {
  receive, connect: () => connectHost(),
  // what the map shows as of the last commit (a test waits for it: Solid commits on a microtask)
  values: () => (stateFn ? previewsOf(stateFn()) : {}),
  graph: () => currentGraph,
  // a pop-out attaches here: it gets every host message, and its own messages go to this map's host
  attach(win, rcv) {
    const p = { win, receive: rcv };
    popups.add(p);
    return { post: m => { if (m?.type !== "hello") post(m); }, state: viewState, detach: () => popups.delete(p) };
  },
};

function connectHost() {
  fakeUnsub?.();
  const f = window.__RX_FAKE__;
  if (f?.subscribe) fakeUnsub = f.subscribe(receive);
  hello();
}

/**
 * Starts live mode: `on.receive(msg)` gets every host message; `on.state()` reads the committed live state; in a
 * pop-out, `on.graph(g)` loads a graph and `on.connected(ok)` reports the feed. Returns the stop.
 */
export function startLive(on) {
  if (!isLive()) return () => {};
  receiveFn = on.receive;
  stateFn = on.state;
  setLiveHooks({ post, apply: (M, hmr) => { playApply(M, hmr); scheduleSwap(on.swap); }, cancelSwap });
  bodyClass("live", true);
  const stops = [];
  if (isRecording()) {
    let active = true;
    replay(receive, () => active);
    stops.push(() => { active = false; });
  } else if (isPopout()) {
    // (its title, "rx-map · pop-out · …", is main.rx's: it follows the graph drawn)
    // after the program has mounted: what joinOpener hands in is written as messages
    let stop = () => {};
    queueMicrotask(() => { stop = joinOpener(on); });
    stops.push(() => stop());
  } else {
    if (fakeSeed() != null) stops.push(startFake(servedGraph(), fakeSeed()));
    const onMessage = ev => { if (ev.source !== window) receive(ev.data); };
    addEventListener("message", onMessage);
    stops.push(() => removeEventListener("message", onMessage));
    queueMicrotask(connectHost);
  }
  return () => { for (const s of stops) s(); fakeUnsub?.(); fakeUnsub = null; receiveFn = () => {}; stateFn = null; };
}

// ---- pop-out: the same live map in a window of its own ------------------------------------------------------
let popWin = null;   // the pop-out this map opened, while it is open
/** Opens (or focuses) the pop-out window, written from the page as it was served. */
export function popOut() {
  if (isRecording()) return;
  if (popWin && !popWin.closed) { popWin.focus(); return; }
  const w = window.open("", "rx-map-popout", "width=1280,height=820");
  if (!w) { toast(`<span class="micro">pop-out</span> the browser blocked the window`); return; }
  popWin = w;
  try { w.document.open(); w.document.write(pristine()); w.document.close(); }
  catch (e) { popWin = null; toast(`<span class="micro">pop-out</span> could not write the window: ${String(e?.message ?? e).replace(/[<&]/g, c => (c === "<" ? "&lt;" : "&amp;"))}`); return; }
  sfx("toggle");
}

// A pop-out talks to the app page itself when it can (`__RX__.connect` from @reactivescript/map/live, in the page that
// holds the dock), so it keeps streaming when the dock's iframe goes away and reconnects after the app reloads. Without
// it (fake mode, an older bridge) it is fed through the map that opened it.
const rxOf = w => { try { return w && !w.closed ? w.__RX__ ?? null : null; } catch { return null; } };
const sig = x => JSON.stringify([x.modules, x.nodes.map(n => n.key)]);
function joinOpener(on) {
  const o = window.opener;
  let appWin = null, rxRef = null, bridgeLink = null, connected = true;
  const timers = [];
  const setConnected = ok => {
    if (connected === ok) return;
    connected = ok;
    bodyClass("disconnected", !ok);
    on.connected(ok);
    toast(ok ? `<span class="micro">pop-out</span> connected to the app again` : `<span class="micro">pop-out</span> disconnected: the app stopped sending (closed, reloading or navigated away)`, ok ? 2400 : 5000);
  };
  const attachDirect = () => {
    try { bridgeLink?.close(); } catch {}
    const rx = rxOf(appWin);
    rxRef = rx;
    const l = rx.connect(m => receive(m));
    bridgeLink = l;
    opener = { post: m => l.send(m) };
    // after a reload the app may run new code: take its graph if it is not the one drawn
    try {
      const g = l.graph();
      if (g?.nodes && (!currentGraph || sig(g) !== sig(currentGraph))) on.graph(JSON.parse(JSON.stringify(g)));
    } catch {}
    receiveFn({ source: "rx-map", v: 1, type: "reset" });
    hello();
  };
  try { const p = o.parent; appWin = p && p !== o ? p : null; } catch { appWin = null; }
  if (appWin && rxOf(appWin)?.connect) {
    attachDirect();
    const close = () => { try { bridgeLink?.close(); } catch {} };
    addEventListener("pagehide", close);
    timers.push(setInterval(() => {
      const rx = rxOf(appWin);
      if (!rx?.connect) return setConnected(false);
      if (rx !== rxRef) attachDirect();   // the app reloaded: a new bridge, a new hello
      setConnected(true);
    }, 1000));
    return () => { timers.forEach(clearInterval); removeEventListener("pagehide", close); close(); };
  }
  try {
    opener = o.__RX_VIEW__.attach(window, receive);
    const st = opener.state();
    const catchUp = () => {
      receiveFn(st.timeline);
      receiveFn({ type: "~flushes", n: st.timeline?.flushes ?? 0 });
      receiveFn(st.snapshot);
    };
    // a new graph is drawn first: its keys are what the messages are read against
    if (st.graph) { on.graph(JSON.parse(JSON.stringify(st.graph))); setTimeout(catchUp, 0); }
    else catchUp();
    const detach = () => { try { opener?.detach(); } catch {} };
    addEventListener("pagehide", detach);
    // the map that opened this one can go away (its dock closed): say so, and stop
    const watch = setInterval(() => {
      let gone = true;
      try { gone = o.closed || !o.__RX_VIEW__; } catch {}
      if (gone) { clearInterval(watch); opener = null; bodyClass("orphan", true); setConnected(false); }
    }, 1000);
    timers.push(watch);
    return () => { timers.forEach(clearInterval); removeEventListener("pagehide", detach); detach(); };
  } catch (e) { console.error(e); return () => {}; }
}

/** `select(id, scroll)` and `popOut()` on the page's window (tests and tools call them, as on map.html). */
export function exposeGlobals(select, pop) {
  const was = { select: window.select, popOut: window.popOut };
  window.select = select; window.popOut = pop;
  return () => { window.select = was.select; window.popOut = was.popOut; };
}
