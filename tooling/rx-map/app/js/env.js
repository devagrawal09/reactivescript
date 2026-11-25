// What the page was served with and where it runs: the graph, live / fake / pop-out, diff, the media queries. Read
// once at start (the program's seeds), plus a few DOM bridges the views can't express (classes on <body>).

// the page as it was served, before anything ran: a pop-out window is written from it. Taken when this module is
// evaluated, which is before the program mounts (boot.js imports it first).
let PRISTINE = "";
export function capturePristine() { if (!PRISTINE) PRISTINE = "<!doctype html>\n" + document.documentElement.outerHTML; }
capturePristine();
export const pristine = () => PRISTINE;

const BOOT = globalThis.__RX_MAP_BOOT__ ?? { graph: null, live: false, fake: null };
const query = new URLSearchParams(location.search);
const TRACE = BOOT.trace?.rxTrace === 1 ? BOOT.trace : null;
const COVERAGE_LIVE = !TRACE && query.get("coverage") === "live";
// a pop-out: this page written into a window opened by a map, which relays its host's messages
const POPOUT = window.name === "rx-map-popout" && (() => { try { return !!window.opener?.__RX_VIEW__?.attach; } catch { return false; } })();
// `?fake=<seed>` (or pageHTML(graph, { fake })) runs the fake host in the page
const FAKE_SEED = POPOUT || TRACE ? null : (() => { const q = query.get("fake"); return q != null ? Number(q) || 1 : BOOT.fake; })();
const LIVE = !!BOOT.live || FAKE_SEED != null || POPOUT || COVERAGE_LIVE || !!TRACE;

/** The graph the page was served with. */
export const servedGraph = () => BOOT.graph;
export const servedCoverage = () => BOOT.coverage?.rxCoverage === 1 ? BOOT.coverage : null;
export const coverageLive = () => COVERAGE_LIVE;
export const servedTrace = () => TRACE;
export const isRecording = () => TRACE != null;
export const isLive = () => LIVE;
export const isPopout = () => POPOUT;
export const fakeSeed = () => FAKE_SEED;
export const isDiff = () => !!BOOT.graph?.diff;
/** The title the page was made with (pageHTML puts it in <title>). */
export const pageTitle = () => document.title.replace(/^rx-map · /, "");

const RMQ = matchMedia("(prefers-reduced-motion: reduce)");
export const reducedMotion = () => RMQ.matches;
const COMPACT = matchMedia("(max-height: 520px), (max-width: 900px)");
export const compactNow = () => COMPACT.matches;
/** Calls `f(compact)` when the compact media query flips; returns the unsubscribe. */
export function onCompactChange(f) { const h = () => f(COMPACT.matches); COMPACT.addEventListener("change", h); return () => COMPACT.removeEventListener("change", h); }

/** A class on <body> (the stylesheet keys whole modes off it: focus, flat, diff, live, fake, viewing, …). */
export function bodyClass(name, on) { document.body.classList.toggle(name, !!on); }
export function setDocTitle(t) { document.title = t; }

/** The location hash, decoded, without its `#`; and a listener for its changes. */
export const hash = () => { try { return decodeURIComponent(location.hash.slice(1)); } catch { return location.hash.slice(1); } };
export function onHashChange(f) { const h = () => f(hash()); addEventListener("hashchange", h); return () => removeEventListener("hashchange", h); }

// ---- localStorage: every key the map keeps (rx-map:hidden, rx-map:panel, rx-map:panel:diff, rx-map:sound) -------
export function loadJSON(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } }
export function saveJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
export function loadText(key) { try { return localStorage.getItem(key); } catch { return null; } }
export function saveText(key, value) { try { localStorage.setItem(key, value); } catch {} }
