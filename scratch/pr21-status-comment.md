Status: tracking `main`.

A canary of this frontend against `fdbcad92` (Solid rc.21) shows only two kinds of change:
- **Source contexts** (O-4 / RG-7c, #26): 8 frontend tests used them. Next update drops that support and refuses the form, pointing to "provide write actions instead".
- **S-store-8** fails in upstream's own suite on rc.21 here, presumably what #31 regrades.

Everything else, including the tracker demo, the stale-write example and the boundary contracts, passes unchanged. I'll repin this branch to current `main` shortly.

Separately, a differential fuzzer for this frontend (paired TSX/RX programs on five backends) found a case where the RX interpreter and the compiler disagree; I'll file it as its own issue.