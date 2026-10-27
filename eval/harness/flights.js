// The fake backend both arms call. Every API call is a flight that stays in the air until the test lands or fails it,
// so a test decides the order answers arrive in. A flight's key is its function's name and its arguments, formatted
// as the scenarios format them: strings bare, everything else as JSON (`search:ap`, `assign:3,ann`).
// Two calls with the same key while both are in the air are one question: landing the key answers both.

const fmt = v => (typeof v === "string" ? v : JSON.stringify(v));
const flights = [];
let seq = 0;

export function flight(name, args) {
  const key = `${name}:${args.map(fmt).join(",")}`;
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  flights.push({ key, seq: seq++, settled: false, resolve, reject });
  return promise;
}

const open = key => flights.filter(f => !f.settled && f.key === key);
const control = {
  /** keys of the flights still in the air, oldest first */
  pending: () => [...new Set(flights.filter(f => !f.settled).map(f => f.key))],
  /** every key ever asked, oldest first, repeats included */
  asked: () => flights.map(f => f.key),
  land(key, value) {
    const fs = open(key);
    if (!fs.length) throw new Error(`no flight in the air for ${key}; in the air: ${control.pending().join(" | ") || "none"}`);
    for (const f of fs) { f.settled = true; f.resolve(structuredClone(value)); }
  },
  fail(key, message) {
    const fs = open(key);
    if (!fs.length) throw new Error(`no flight in the air for ${key}; in the air: ${control.pending().join(" | ") || "none"}`);
    for (const f of fs) { f.settled = true; f.reject(new Error(message)); }
  },
};
globalThis.__flights = control;
