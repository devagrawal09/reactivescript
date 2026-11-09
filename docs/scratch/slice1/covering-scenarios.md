# Scenario coverage (partial audit)

**S-action-1** (Program lines 5–18; Frames lines 22–29): nearest overlap. It has plain sources, an optimistic write, an action awaiting `fetch("checkout")`, caught rejection, and text holes. It is not a full match: no optimistic source seeded from another source, no derived equation, no button handler, and also has `finally`/extra writes. Frame format is `instant | action | frame`; mount, handler, rejection -> `2 items / failed: declined / 100`. Alternate resolve variant: lines 31–41.

**Not matches:** S-action-2 has two awaits (Program lines 7–9); S-await-1 has multiple view awaits (Program lines 14–16) and no optimistic write. I found no single scenario verified to exercise only the requested slice.

## File format

A scenario has a title and optional Rules preface, `## Program` with one fenced RX source block, and `## Frames` with a Markdown table: `instant`, `action`, `frame`. Each ordered row gives a mount/handler/host outcome and expected rendered string. JSON-neutral form: `{program: string, frames: [{instant, action, frame}]}`; preserving scripted outcomes as structured events is useful (`resolve`/`reject`, call key, payload). For example, S-action-1 calls `fetch("checkout")` and rows script `reject "checkout" "declined"` (lines 11, 24–25). Flight identity is by call argument (`checkout`). Rejection is delivered at `await`, thrown into the action and handled by its inner catch (lines 28–29).
