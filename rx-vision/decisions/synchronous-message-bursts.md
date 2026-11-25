# Synchronous message bursts

**Recommendation: keep W-4 and use one functional write per message.**
When several messages arrive in one instant, W-6 makes updater arguments
compose in arrival order. Read the committed result in reactive code or
an effect; a host or a test that needs that result should wait for the
commit. Keep a local and pass it explicitly if another action needs a value
computed earlier in the same run. Neither pattern promises a synchronous
read across independent host callbacks.

For the map, separate message normalization and external effects from the
state reducer. Prefer a pure reducer that returns its next state (or
RX path writes where they suffice). Don't use the updater for transport,
sound, or other effects. If the host API truly promises a result before
returning, a host-owned mirror is a boundary decision, not a second RX
read model.

- **Read your writes:** would change W-4 / Solid F-10, the meaning of
  snapshot reads, and action/hold behavior. Don't do it locally.
- **Flush per message:** loses batching and can change which writes hold
  together; W-3 does not let imperative code split the instant.
  `onFlush` (EF-8) schedules new work but does not wait on a hold, so it
  isn't a general guarantee of committed state.
- **Expose a pending-write read:** adds a second reading model and needs
  rules for holds, guesses, failed actions, and dependency tracking.
  Revisit only if consumers genuinely need more than the W-6 reducer
  and the eventual committed frame.
