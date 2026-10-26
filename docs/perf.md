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

What is left, per tick: `neighborSum` ~22 ms, the Life rule's chain of comparisons ~25 ms, the age update ~10 ms, and ~5 ms writing
the results back. Field arithmetic is **lazy and fused**: `crowd.eq(3).or(alive.and(crowd.eq(2)))` records what to compute and
works it out in one pass over 2,048-cell blocks of `Float32Array` (one array type per loop, no index masks), so a chain no longer
allocates a 4 MB array per step (about 8 MB of outputs a tick instead of 24 MB at a million cells, which matters for browser
garbage-collection pauses). It did **not** make the tick faster, and the profile says why: on the test box a simple scalar loop
costs about 3 ns a cell (`neighborSum`'s 8 million reads take 22 ms), so a million-cell tick is CPU-bound, not memory-bound.
The remaining ways down are doing less per cell or more per instruction: WebAssembly SIMD kernels for the elementwise passes
(about 4 cells per instruction), a faster neighbor gather for regular lattices, or computing on the GPU. The 30 ms target is
likely out of reach in plain JavaScript on this box; on the laptop the original numbers came from, the same code should be
roughly 1.5 to 2 times faster. Per-cell `decide` rules cost about 3 µs/cell (3D Life, 8,000 cells, ~24 ms),
so they suit grids up to roughly 50,000 cells.

Per-cell handles are only built when a `decide` rule or a lattice metric asks for them; a metric such as
`cells.alive.sum()` on a million cells therefore builds a million handle objects once and is slow. Prefer `update`.
