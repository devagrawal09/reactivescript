# A store as plain data

**Recommendation: don't add a prelude `snapshot`. A handler read is the committed value, still a store. A plain copy is the host's.**

ST-1 makes an object or array a store. A read in a handler, or `() => live` handed to JS, is a snapshot of that value (H-10, E-5): untracked, the committed one, not a deep copy. The object is still the proxy. Solid's `snapshot` unwraps. RX has no such word, and adding one would be a second identity for the same source (readers of the copy would not be readers of the store).

Crossing a window, or writing the value back in as data, is a host concern.
Use a JS helper beside the module. It can call Solid's `snapshot` for a
store or serialize the data for transport. A JSON round trip is only for
JSON-shaped data; it drops or changes values such as `undefined` and `Date`.
Don't change a handler read to return plain data: path identity, equality,
and what a later write notifies all depend on the store (ST-2).

Revisit only if a `.d.rx` needs to say "this function takes data, not a store" and the call site cannot copy. That is a boundary annotation, not a new read mode.
