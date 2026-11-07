# Spike plan

1. Read rc.21 core and pin behavior with probes.
2. Build a single-threaded graph, split effects, ownership and explicit flush.
3. Add deterministic flights and action continuations, with held writes.
4. Differential programs, seeded generation, reduction, and coverage counts.
5. Run 2000 seeds, record gaps and reduced counterexamples.

Solid rc.21 is the reference, not RX. RX holds/actions notes supply context only. No reference files may be changed. Full M1 includes async; partial results must not be called M1 completion.
