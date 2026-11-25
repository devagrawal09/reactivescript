# Draft updaters

**Recommendation: don't add a `draft` parameter. Declare the updater `fn` and call it from the action.**

A functional write `live := s => reduce(s, m)` applies `reduce` to the draft Solid hands it (W-6). The function mutates that argument. `pure fn` says it doesn't, so that declaration is a lie. `fn` is io, which is the honest row: it is not safe to call from reactive scope (R-io-2, ST-3b). An action is imperative, and the updater arrow there inherits that scope, so `fn reduce` checks. Checked: `action go(m) { live := s => reduce(s, m) }` with `export fn reduce(s: any, m: any): void` is clean.

A `draft` parameter (`fn reduce(draft s, m)`) would say "mutates this argument and nothing else" and would be callable from a reactive expression. That is a new row word. ST-3 already has the draft, and it does not escape its body. The call site that exists is enough. Revisit only if a reactive expression must apply a mutating updater, which the rules currently refuse on purpose.
