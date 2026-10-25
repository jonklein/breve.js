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

The M1 placeholder target was a tick under 30 ms. A tick is currently about 80 ms: `neighborSum` is ~20 ms, and every
`zip`/`map` is ~12 ms because each calls a JS closure per cell. Ways to close the gap, if it matters, in order of effort:
fuse common patterns into built-in field operations (for example a lookup table `alive.neighborSum().lookup(...)`), run
the rule in WASM, or compute on the GPU. Per-cell `decide` rules cost about 3 µs/cell (3D Life, 8,000 cells, ~24 ms),
so they suit grids up to roughly 50,000 cells.

Per-cell handles are only built when a `decide` rule or a lattice metric asks for them; a metric such as
`cells.alive.sum()` on a million cells therefore builds a million handle objects once and is slow. Prefer `update`.
