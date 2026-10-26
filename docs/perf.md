# Performance notes

Numbers are from one laptop (Apple silicon, Node 22), recorded to spot regressions, not to promise anything.
Re-run with `node --import tsx scripts/bench-life.mjs [side]`.

## Life on a 1000×1000 grid (1,000,000 cells), whole-grid rule (`examples/life2d`)

| Operation | Time |
|---|---|
| build (storage + neighbor tables + random fill) | ~160 ms |
| one tick | ~80 ms |
| snapshot | ~3 ms |
| restore | ~1 ms |
| fork (shares neighbor tables, copies columns) | ~30–60 ms |
| hash | ~8 ms |

The M1 placeholder target was a tick under 30 ms; it is not met yet. Measured on a slower Linux box (same script,
`scripts/bench-life.mjs`), a tick went from ~112 ms to ~62 ms in two steps:

1. Writing a rule's result back into the columns no longer calls a function per cell (~110 → ~77 ms).
2. `Field` has closure-free whole-field operations (`add`, `eq`, `and`, `or`, `where`, `clamp`, ...), and `examples/life2d`
   uses them instead of two `zip` closures (~77 → ~62 ms). A test checks that both ways of writing the rule give the same
   state, tick for tick.

What is left, per tick: `neighborSum` ~22 ms, then about 5-10 ms for each of the six or so whole-field operations. Those are
memory-bound: each one allocates and fills a fresh 4 MB array. Ways to close the rest of the gap, in order of effort: reuse
buffers for temporaries, fuse common chains (for example `crowd.eq(3).or(alive.and(crowd.eq(2)))` as one pass), run the rule in
WASM, or compute on the GPU. Per-cell `decide` rules cost about 3 µs/cell (3D Life, 8,000 cells, ~24 ms),
so they suit grids up to roughly 50,000 cells.

Per-cell handles are only built when a `decide` rule or a lattice metric asks for them; a metric such as
`cells.alive.sum()` on a million cells therefore builds a million handle objects once and is slow. Prefer `update`.
