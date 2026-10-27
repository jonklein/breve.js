# Plan: GPU-only whole-set rules (`actAll` compiled once, run on the GPU)

**Status:** proposed, nothing built. Needs a few decisions (end of this file) before step 1.

**Goal.** A lattice rule written once, as an expression, that compiles to a GPU compute shader and runs there every tick with no per-tick JavaScript. The first demo is a giant 2D Life (4096×4096 and up). The CPU `life2d` stays as it is.

## Why this is closer than it looks

`Field` already records a graph of operations (`bin`, `where`, `clamp`, neighbor reads) and runs it later in cache-sized blocks. `life2d` is already a pure array program: no loops, no closures. So the GPU version is a second *backend* for the same graph, not a new language. Two things are missing: (1) the graph is built fresh every tick by running the script, and (2) it contains JavaScript closures (`map`, `zip`) that cannot be compiled.

## Design

### 1. Call once, not every tick
A new hook that runs **once** (at build, and again only when the scene or script changes) and returns the next state as an expression:

```js
export const kernel = {            // name to be decided
  step({ alive, age }, p, k) {
    const crowd = alive.neighborSum()
    const next = crowd.eq(3).or(alive.and(crowd.eq(2)))
    return { alive: next, age: next.where(age.add(1), 0) }
  },
}
```

The `Field`s it receives are *symbolic*: they hold no numbers, only a place in the graph. `p.density` is also symbolic, a **uniform**, so a slider changes a number on the GPU and nothing is recompiled. Anything that cannot be traced is a clear error at build time ("`zip` takes a JavaScript function; on the GPU use `add`, `mul`, `where`..."), not a wrong answer later. Because the script is called once, branching on a parameter (`if (p.x > 3)`) is impossible by design; `where` is the replacement.

### 2. The graph is data (an IR)
Tracing produces a small, JSON-serializable expression graph. That gives us, for free: a JSON Schema and fixtures (rule 5), a readable dump in the workbench ("this is what your rule compiled to"), snapshot and fork of the *program*, and one thing every backend consumes:

| backend | what it does | when |
|---|---|---|
| `interpret` | walks the graph per cell on the CPU | the reference; every test compares against it |
| `cpu` | today's block evaluator | default; the fallback when there is no GPU |
| `webgpu` | emits WGSL, one fused compute pass per tick | the new fast path |

### 3. Compilation to WGSL (the "hyper-optimization" part)
Passes over the graph, all pure functions that can be unit-tested without a GPU:
1. **Fuse** a whole rule into one dispatch: every intermediate lives in registers, nothing is written back between operations.
2. **Common subexpressions** (`crowd` above is computed once).
3. **Stencils as tiles.** `neighborSum` on a lattice becomes loads from a workgroup-shared tile with a halo, not 8 separate global reads. `edges: 'wrap'` or `'dead'` is a compile-time choice of how the halo is filled.
4. **Dead-state elimination.** `age` is only needed for display: if no display or metric reads it, it is not stored.
5. **Pattern kernels (stretch).** If the graph is a "Life-like" rule (a neighbor count run through equality tests), emit a **bit-packed** kernel: 32 cells per word, neighbor counts by bitwise adders. That is roughly 30 to 100 times less memory traffic than one float per cell, and it is what makes 16k×16k feasible.
6. **Several generations per dispatch** (stretch): for a fixed number of steps `k`, load a tile with a halo of `k` cells and step it `k` times in shared memory before writing.

### 4. State, snapshots and the "columnar" rule
State stays in typed-array columns as the source of truth, but while a GPU rule runs, the live copy is a GPU buffer. The columns are refreshed **on demand** (a snapshot, a metric, `inspect`, a hash) by an asynchronous readback. Consequences, stated up front:
- `Sim.snapshot()` and `fork()` are synchronous today; the GPU path needs an async variant, or the world must say "flush first". This touches the core and needs your decision (below).
- A scene using the GPU rule is **flagged** (rule 4): replay is exact for integer rules like Life (the same on any machine), but float rules may differ in the last bit between GPUs. The IR interpreter is the byte-exact reference.
- Determinism test: run twice, read back, compare bytes. Also: GPU result equals `interpret` result for random graphs (property test) and for Life, bit for bit.

### 5. Random numbers
Counter-based hash (`k.hash(cell, salt)`, from tick, cell index, seed and a name). It is pure, so the same code works on the CPU, the GPU and in parallel. `initAll` for a giant grid also wants to run on the GPU (filling 16M cells from JavaScript is slower than the first 100 ticks).

### 6. Drawing
The current renderer draws one instanced mesh per cell. That cannot do millions of cells. A GPU lattice needs an **image path**: the field becomes a texture on a quad (lit or flat), read straight from the GPU buffer with a tiny colour pass (`displayAll` compiled the same way as the rule). Phase 1 can read back a downsampled image to the main thread (workers own the device), Phase 2 shares the device with the renderer. Zoom and pan matter here: 16M cells on a screen is mostly detail you can only see by zooming.

### 7. Where WebGPU can run, and how it is tested
Checked in this sandbox: headless Chromium with `--enable-unsafe-webgpu` gets a software (SwiftShader) adapter and a 128 MB storage-buffer limit, so GPU kernels can be tested in CI against the interpreter (slowly, small grids). The buffer limit is the real ceiling: 128 MB is 16M cells at 8 bytes, or 1 billion bit-packed cells; real GPUs allow more. The core stays DOM-free (rule 2): the WGSL generator and the IR live in the core or stdlib as pure code; only a small `webgpu` adapter (like the physics adapters) touches `navigator.gpu`, registered by the host.

## Steps (each ends with a demo and tests)

1. **IR and tracer** (core or stdlib, no GPU): symbolic `Field`, uniforms for params, the `interpret` backend, schema and fixtures. Demo: Life traced and run on the interpreter equals today's `life2d` tick for tick.
2. **Pure WGSL generator** with the fusion and CSE passes, unit-tested by snapshot (the text it produces) and by running the shader in headless Chromium against `interpret`.
3. **WebGPU backend and lattice world integration**: buffers, ping-pong, uniforms, async readback, the snapshot/flag decisions above. Demo: `life2d` rule at 1024² on the GPU.
4. **Image display path** and the demo scene **"Giant Life (GPU)"**: 4096² to start, with zoom and pan, a population metric computed on the GPU (reduction), and `life2d` kept as the CPU version.
5. **Bit-packed Life kernel** and multi-step fusion; record numbers in `docs/perf.md` next to the CPU table (about 80 ms a tick at 1000² today).
6. **Then** generalize: gray-scott (a float stencil with a Laplacian) as the second example, `shift(dx, dy)` and a weighted stencil as general neighbor ops, and agents on the GPU only if the first part lands well (neighbor search is a different problem).

## Decisions needed

1. **Hook name.** The naming rule is `x` / `xAll`. This one is a different kind of thing (called once, returns a program). Options: `kernel` (the thing it is), `actKernel`, or `compileAll`. Recommendation: `kernel`, with `step` and `look` inside it.
2. **Async snapshot.** Make `snapshot`/`fork`/`hash` able to await a GPU flush (a small, contained change to `Sim`), or make GPU sets "not forkable" for now. Recommendation: async flush, since forking a running sim is a core promise.
3. **Pure randomness.** Add `ctx.hash` for everyone (also fixes the audit finding in `functional-audit.md`), or only inside kernels. Recommendation: for everyone.
4. **Dependency.** WebGPU is a browser API, so none is needed, plus a headless-browser test using the Playwright we already have. A WGSL validator (naga via a tiny wasm package) would be nice for fast unit tests but is optional.
5. **Scope of "GPU only".** Do we want a scene to be able to *require* the GPU (error without it), or fall back to the CPU backend with a notice? Recommendation: fall back, since the CPU backend runs the same graph.
