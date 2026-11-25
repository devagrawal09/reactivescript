# Ordered error dispatch

Round 5 browser repro: `rx-r5-browser` at `55e2048^`, `src/Desk.rx`,
wraps the inbox with a `RateLimited` boundary outside a catch-all
whose fallback renders `<RetryBox message={e.message} … />`. The catch-all
takes the inbox failure first; the generic UI wins. `DEAD_TYPED_BOUNDARY`
intentionally does not reject that shape: the inner fallback is a component
application, and a failure from that fallback can reach the outer boundary.
The user's app already fixes the order in `55e2048`.

Do not assume a rendered fallback cannot fail, and do not add a warning.
A row proof for the fallback could extend the current conservative check,
but it must cover forwarded props/children, imported code and panic cases,
not just the fallback's element tag.

Recommendation: if we redesign the surface, use one boundary with ordered
class arms and at most one catch-all arm, which must be last. Reject arms
after a catch-all structurally. A failure from a selected arm belongs to an
enclosing boundary, not the next arm. Keep nesting for distinct UI regions,
not for dispatching cases of the same failure. Specify that distinction and
the migration before changing syntax.
