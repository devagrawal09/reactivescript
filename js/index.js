// @reactivescript/js: the helpers a .ts module wraps its exports in, so `rx-dts` generates their .d.rx facts
// (spec/09 MO-11). Each is the identity today. All of them go through one internal hook, so later work (dev
// checks, call recording) adds behaviour without changing the surface.

let hook = null;

/** @internal Install the hook every helper calls: `h(kind, fn, meta)` returns the function to export. Returns the previous hook. */
export function __setHook(h) {
  const previous = hook;
  hook = h ?? null;
  return previous;
}

/*#__NO_SIDE_EFFECTS__*/
export function pure(fn) {
  return hook === null ? fn : hook("pure", fn, undefined);
}

/*#__NO_SIDE_EFFECTS__*/
export function rejects(errors, fn) {
  return hook === null ? fn : hook("rejects", fn, errors);
}

/*#__NO_SIDE_EFFECTS__*/
export function ref(spec, fn) {
  return hook === null ? fn : hook("ref", fn, spec);
}

/*#__NO_SIDE_EFFECTS__*/
export function instantiates(fn) {
  return hook === null ? fn : hook("instantiates", fn, undefined);
}

/*#__NO_SIDE_EFFECTS__*/
export function server(fn) {
  return hook === null ? fn : hook("server", fn, undefined);
}

/*#__NO_SIDE_EFFECTS__*/
export function client(fn) {
  return hook === null ? fn : hook("client", fn, undefined);
}
