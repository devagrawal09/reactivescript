# Independent work and holds

Keep H-2/H-3/H-3a. Independence is a property of what the runs write
and what readers consume, not of the name of an action.

- **Separate runs and state (recommended):** use `onFlush` or independent
  host callbacks, separate progress from the answer, and keep their
  readers separate. This preserves atomic frames and works today.
- **A detached action modifier:** launching separately is useful, but
  it cannot promise never to join. If it writes an already held slot
  or triggers a reader that consumes a staged derivation, it still must
  join. This would duplicate `onFlush` without solving the hard case.
- **A never-join lane:** would need to reject overlapping writes, serve
  old reads, or break atomic visibility. Don't add another action model.

Expose the concrete writer, reader and flight causing the join in tooling.
Revisit only if the separate-state recipe cannot express an actual app.
