# Primitive projections of rows across an await

Keep AC-1g. A primitive is a stable snapshot, but that doesn't mean it is
still authoritative. A copied position, status, or count stays just as
stale as the row would. TypeScript cannot tell an identity from those
fields. The existing boundary separates the user's requested input from
data the action reads to reconstruct the response.

Extract a stable id at the call (`undo(entry.id)`, `action undo(id: string)`
or `number`), then look it up in the current answer in a functional
write. If the response doesn't provide enough information to update the
answer, refresh it instead. Don't add a primitive-projection exemption
or a special id annotation without evidence that this call form fails.
