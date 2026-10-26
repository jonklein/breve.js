# Milestones

Each milestone ends in a **demo that doubles as an acceptance test**. A milestone is done when its demo runs, its headless tests pass, and the spec sections it touches are updated to match reality. See `SPEC.md` for definitions and `CLAUDE.md` for working conventions.

The order was: a playable thin slice first (M0), then harden and widen. The creature demo is a test of the platform, not its center.

## Where we are

About 120 tests pass (stdlib 5, experiment 9, core 99, server 5). Every milestone has its acceptance demo running; what is pending is mostly the second-tier items listed under each one.

| | Milestone | Status | Demo |
|---|---|---|---|
| M0 | Playable slice | **Done** | `boids` |
| M1 | Kernel hardening | **Done**, with two gaps (relation tables, 1M-cell tick time) | `life2d`, `life3d` |
| M2 | Sim as a value | **Done**, no multi-worker pool | Sweep / Watch, `neural` |
| M3 | Controllers and inspector | **Done** | `ants`, `herding` |
| M4 | Experiment layer | **Done** | `boids`, `creature`, `ants`, `morphology` experiments |
| M5 | Abstract worlds | **Done** | `epidemic`, `epidemic-grid`, `market` |
| M6 | Bodies and physics | **Done** | `creature`, `urdf-bot`, `morphology` |
| M7 | Learning and language models | **Done** (WebGPU untested) | `llm-wanderers`, `neural`, assistant |
| M8 | Site and editing polish | **Done** | home page, site nav, gallery, share links, tree editor |
| Later | Sandboxing, scrubber, GPU layers, remote training | Not started | |

Also built, outside the original list:

- A standard library in its own package (`packages/stdlib`) with generated docs, and an in-app Docs tab.
- `spawn`, `init`, fences with `onLeave`, and `self.reset()`; inferred state types (number, boolean, string); several entity sets per scene; controllers chosen by named export.
- `breve.run(selector, script, config)`, an embeddable build (`packages/embed`, `packages/view`), and `?embed` for the workbench. The boids demo is live on the kleininen project page.
- Headless tooling: `npm run run -- <example>`, `npm run urdf -- robot.urdf`, `npm run docs`.

## M0 — Playable slice — Done

3D boids with the real shape of the experience: scene data, a script, live editing, a 3D view.

- [x] Columnar store with generation-checked ids; seeded RNG; fixed timestep and phase order
- [x] Scene JSON with a JSON Schema and readable errors
- [x] Script controllers with a neighbor sensor (spatial hash)
- [x] Three.js renderer as a pure reader of world state; orbit camera
- [x] Workbench: scene and script editors, param sliders, live charts, transport, hot reload without reset, errors keep the last good run going
- [x] Sim runs in a Web Worker
- [x] Determinism test

## M1 — Kernel hardening — Done, with gaps

- [x] Lattice with implicit adjacency; spatial hash index
- [x] Declared metrics feeding auto-generated charts
- [x] Snapshot and restore of columns, RNG state and controller state; fork shares neighbor tables
- [x] Whole-grid `update` rules (`Field` operations) for big grids
- [x] Benchmarks in `docs/perf.md`; snapshot ~3 ms, fork ~40 ms, hash ~8 ms for 1,000,000 cells
- [x] Life playable in the workbench with the same mechanism as boids

Added to finish the milestone:

- [ ] A 1000×1000 Life tick is above the 30 ms target (112 → 62 ms on the test box after this work; see `docs/perf.md` for what was done and what is left: buffer reuse, fused chains, WASM, GPU). `Field` gained closure-free whole-field operations (`add`, `eq`, `and`, `where`, ...) along the way.
- [x] General relation tables: named, directed, attributed edges with CSR neighbor lookup, owned by the `Sim` (`sim.relations`), included in snapshot, fork and hash. Scripts reach them as `ctx.relations`; `via` sensors read them (M5).
- [x] Object columns (`'obj'`) for arbitrary structured-cloneable values: deep-copied by snapshots, hashed as canonical JSON, flagged as the slow escape hatch.

## M2 — Sim as a value — Done, no worker pool

- [x] `Sim.create / step / snapshot / restore / fork / dispose`, fork with an edited scene
- [x] `SimGroup`: sweeps, forks, parent-mediated messages with a replayable log
- [x] Shared renderer with scissored tiles; per-tile metric lines; click a tile to continue from it
- [x] Per-agent strided state (`ctx.mlp`, `examples/neural`), forked mid-run with identical branches
- [x] Fork determinism tests

Added to finish the milestone:

- [ ] A pool of workers and a budget-aware scheduler across them. One worker runs a whole group today, under a per-frame time budget.

## M3 — Controllers and inspector — Done, two small gaps

- [x] Several entity sets per scene; controllers by named export (`type`); `every`; cross-set sensors; agents read and add to the cells under them
- [x] Script and Human (keyboard) controllers; `ctx.blend` for composition; `self.reset()` and fences
- [x] Inspector: click to view and edit an entity; swap a set's controller from a menu
- [x] **Ants** with a pheromone layer, and swapping a controller at runtime with only the binding edited (tested)
- [x] Non-determinism flag in core (`spec.nondeterministic`, `sim.nondeterministic()`); keyboard input is logged (`sim.inputLog`)

Added to finish the milestone:

- [x] The workbench shows "⚠ not repeatable" (with the reason on hover) for sets driven by a person or a model, and clears it while a decision log is replayed.
- [x] Controller per entity: a text state field called `controller` names the script export an agent runs; the inspector menu sets it for the clicked entity.
- [ ] Oscillator as a standalone controller for agents (the creature oscillator is built into joint drives).

## M4 — Experiment layer — Done

- [x] `Strategy` interface; `experiment.json` with a schema and readable errors
- [x] Grid, random and CMA-ES strategies; ranking; replicates over seeds
- [x] Experiment tab: run in its own worker, ranked table, apply best, CSV export, Watch as tiles
- [x] The 12-sim sweep is driven by an experiment file; three strategies run against the same scene with no core changes
- [x] Morphology search through `$param` expressions in body geometry

Added to finish the milestone:

- [ ] Run candidates in parallel across workers (needs the M2 pool).
- [ ] Export results as JSON as well as CSV.

## M5 — Abstract worlds — Done

- [x] Networks: small-world, random, scale-free, ring, complete, explicit; force layout through d3-force-3d behind a thin adapter; graph view
- [x] Atomic `exchange` trades between linked nodes
- [x] Multi-series charts
- [x] **Epidemic** (SIR) on a network, and the **same script file** running on a grid
- [x] **Market**: traders with cash and goods trading over links
- [x] Headless run with no renderer (`npm run run -- epidemic`)

Added to finish the milestone:

- [x] `via` neighbor sensors over named relations (agents; networks already read their links as neighbors).
- [x] `transform.meaning`: settled by the kind of set (networks are layout-only by construction); `SPEC.md` now says so.
- [x] `update` (whole-network field rules) for networks, with neighbor operations that follow the links (CSR table, hubs of any degree).

## M6 — Bodies and physics — Done

- [x] Rapier (deterministic build) behind an adapter; the choice is in `docs/decisions/physics.md`
- [x] JSON bodies with parts, joints, motors, an oscillator drive; templates and `attach`; geometry as arithmetic on params
- [x] Terrain, creature collisions, shadows, fences and reset
- [x] Snapshot, restore and fork of physics state; identical replicate runs
- [x] URDF importer (box, sphere, cylinder; revolute, continuous, fixed) with `examples/urdf-bot`

Added to finish the milestone:

- [x] The MuJoCo WASM comparison (`scripts/mujoco-spike.mjs`, results in `docs/decisions/physics.md`): about 5 times faster per tick, but a straightforward translation of the creature does not hold its walk, so the gait claim is unconfirmed and Rapier stays.
- [x] MJCF importer (`importMjcf`, `npm run mjcf -- model.xml`): nested bodies, box/sphere/capsule/cylinder geoms (sized or `fromto`), hinge/ball/free joints with ranges, euler/quat/axisangle, mass or density. No slide joints, meshes or several joints on one body (reported).
- [x] glTF for visuals: a part's `visual` names a glTF/GLB model drawn instead of its primitive (all meshes merged; physics keeps the primitive). `examples/creature-gltf` swaps the torso box for a beetle model (made by `make_beetle.py`, no libraries). Textures and materials are not used (the part's color tints it), and URDF `<mesh>` is still not imported.
- [x] Rotated links in URDF: parts take a `rotation`, and the importer composes `rpy` frames down the link tree (shapes, child positions and joint axes follow).
- [x] Annotated mutation and crossover utilities (`mutate`, `crossover`, `randomGenome` in `@breve/experiment`): they read the min, max and step the scene gives each param, so they work on body geometry params as well as any other. They stay out of core.

## M7 — Learning and language models — Done

- [x] `think()` with `ctx.ask`: lockstep and realtime modes, a decision log, exact replay without calling the model (`examples/llm-wanderers`, `/api/decide`)
- [x] Authoring assistant: prompt in, validated scene and script changes out, accept or reject, undo
- [x] Per-agent neural network weights as columns (`ctx.mlp`)
- [x] A morphology search with the experiment layer

Added to finish the milestone:

- [x] ONNX inference with batched inference for populations: `models` in the scene, `ctx.model(...)`, `thinkAll` (one call for a whole set), `@breve/inference` over ONNX Runtime Web, replay without the runtime. Checked with a real ONNX file in Node tests and in the browser (`examples/onnx-policy`). WebGPU (`"device": "webgpu"`) is written but untested: no GPU here. See `docs/decisions/inference.md`.
- [x] Loading models from the Hugging Face Hub (`hf:owner/repo/path.onnx`), cached in memory and in the browser's Cache Storage. Hub resolution and caching are tested with a stubbed network (no test downloads from the Hub); once, by hand, `hf:onnxmodelzoo/mnist-12/mnist-12.onnx` downloaded from the real Hub and loaded (a 4-D image model: it loads, but reports no input width, since only `[batch, width]` shapes are described). Private repositories are not supported.
- [x] A camera sensor so a VLM can drive an agent: `"sensors": [{ "type": "camera", "name": "view" }]` gives an egocentric top-down picture drawn from sim state (no renderer), `ctx.ask(..., { images })` shows it to a vision model through the server, and decisions are logged and replayed like any other (`examples/vlm-scouts`). A first-person 3D render would need the renderer and is left out on purpose: the core stays headless.
- [x] Workbench controls for lockstep mode and for saving and replaying a decision log (a bar above the view when a set thinks; checked in a headless browser with a stubbed model).

## M8 — Site and editing polish — Done

The workbench was the whole app; this milestone gives breve a front door and makes configs easier to edit without hand-writing JSON. See `docs/decisions/site.md`.

- [x] **Home page** at `/`, separate from the workbench (now at `/sim/`). It introduces breve and runs three live demos (boids, ants, epidemic) with `breve.run`; each starts when scrolled near and pauses when off screen, and links into the workbench. Old `/?embed#...` links are redirected.
- [x] **Site navigation**: Home, Simulations, Gallery, Docs, About and a link to the source, in one module used by every page, including the workbench header. `?embed` hides it.
- [x] **Gallery** at `/gallery/`: every example as a card with a picture, description and tags; filter by tag; Open, Fork (copies it into your projects) and Copy link; your own projects are listed below.
- [x] **Sharing**: Share in the workbench copies a link that carries the scene, script and experiment (`/sim/#s=...`); opening one saves it as your own project.
- [x] **JSON tree editor for the config** (Tree view button above the editor, for `scene.json` and `experiment.json`): a collapsible tree with number inputs, checkboxes, color pickers, dropdowns for fixed choices, `$param` pickers, add (fields the schema names, or any key) and remove, and inline validation errors. It is a second view of the same text: each edit is a path-based text edit (`setAtPath`, `removeAtPath`, `addAtPath` in core) so the rest of the file keeps its formatting.

Acceptance (met): the home page shows three working demos; the gallery lists every example and opens any in one click; every config field in the examples can be edited from the tree editor without touching the text. Checked two ways: a core test sets, removes and re-adds every value of every example config and asserts the text stays valid JSON, and a headless-browser run confirmed the tree draws a control for every leaf of all 13 example scenes.

## Later (not started)

- Server-side project storage and accounts; projects live in browser storage only today.
- Sandboxed untrusted sims (QuickJS). Until then, projects opened from a share link are held back until you read the script and press Run (a trust prompt, not a sandbox).
- ~~Timeline scrubber~~ done: the workbench records a snapshot every 10 ticks (within a 64 MB budget), a slider under the view goes back to any of them and pauses there, and Play carries on from that point as a new branch (the charts rewind too). Works for physics scenes. Not for sweeps. Moments between snapshots cannot be reached, because stepping forward from a snapshot would not match a run driven by a person or a model.
- GPU-resident dense patch layers.
- ~~Remote controllers for Python training~~ done as a model server: `"models": { "policy": { "url": "ws://localhost:8765" } }` talks to a Python process over a WebSocket (`examples/remote-policy/serve.py`), same batches and logging as ONNX models (`docs/decisions/remote.md`). A trainer that owns the clock and steps the simulator like a Gym environment is not built.

## Housekeeping

- Pushed to GitHub on branch `next` of `jonklein/breve.js`; the newest commits are local until pushed.
- `docs/script-api.md` and the generated `docs/stdlib.md` are the assistant's reference; a test keeps `stdlib.md` in sync with the code.
