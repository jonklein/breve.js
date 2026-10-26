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
| M3 | Controllers and inspector | **Done**, one small gap (non-determinism flag not shown in the UI) | `ants`, `herding` |
| M4 | Experiment layer | **Done** | `boids`, `creature`, `ants`, `morphology` experiments |
| M5 | Abstract worlds | **Done**, minus `transform.meaning` | `epidemic`, `epidemic-grid`, `market` |
| M6 | Bodies and physics | **Mostly done** (no MuJoCo, MJCF, glTF, mutation utilities) | `creature`, `urdf-bot`, `morphology` |
| M7 | Learning and language models | **Partly done** (no ONNX, Hugging Face, VLM) | `llm-wanderers`, `neural`, assistant |
| M8 | Site and editing polish | **Planned** | home page, site nav, JSON tree editor, gallery |
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

Pending:

- [ ] A 1000×1000 Life tick is ~80 ms against the 30 ms target. Ways to close it are listed in `docs/perf.md` (fused field operations, WASM, GPU).
- [x] General relation tables: named, directed, attributed edges with CSR neighbor lookup, owned by the `Sim` (`sim.relations`), included in snapshot, fork and hash. Scripts reach them as `ctx.relations`; `via` sensors read them (M5).
- [x] Object columns (`'obj'`) for arbitrary structured-cloneable values: deep-copied by snapshots, hashed as canonical JSON, flagged as the slow escape hatch.

## M2 — Sim as a value — Done, no worker pool

- [x] `Sim.create / step / snapshot / restore / fork / dispose`, fork with an edited scene
- [x] `SimGroup`: sweeps, forks, parent-mediated messages with a replayable log
- [x] Shared renderer with scissored tiles; per-tile metric lines; click a tile to continue from it
- [x] Per-agent strided state (`ctx.mlp`, `examples/neural`), forked mid-run with identical branches
- [x] Fork determinism tests

Pending:

- [ ] A pool of workers and a budget-aware scheduler across them. One worker runs a whole group today, under a per-frame time budget.

## M3 — Controllers and inspector — Done, two small gaps

- [x] Several entity sets per scene; controllers by named export (`type`); `every`; cross-set sensors; agents read and add to the cells under them
- [x] Script and Human (keyboard) controllers; `ctx.blend` for composition; `self.reset()` and fences
- [x] Inspector: click to view and edit an entity; swap a set's controller from a menu
- [x] **Ants** with a pheromone layer, and swapping a controller at runtime with only the binding edited (tested)
- [x] Non-determinism flag in core (`spec.nondeterministic`, `sim.nondeterministic()`); keyboard input is logged (`sim.inputLog`)

Pending:

- [ ] Show the non-determinism flag in the workbench UI.
- [x] Controller per entity: a text state field called `controller` names the script export an agent runs; the inspector menu sets it for the clicked entity.
- [ ] Oscillator as a standalone controller for agents (the creature oscillator is built into joint drives).

## M4 — Experiment layer — Done

- [x] `Strategy` interface; `experiment.json` with a schema and readable errors
- [x] Grid, random and CMA-ES strategies; ranking; replicates over seeds
- [x] Experiment tab: run in its own worker, ranked table, apply best, CSV export, Watch as tiles
- [x] The 12-sim sweep is driven by an experiment file; three strategies run against the same scene with no core changes
- [x] Morphology search through `$param` expressions in body geometry

Pending:

- [ ] Run candidates in parallel across workers (needs the M2 pool).
- [ ] Export results as JSON as well as CSV.

## M5 — Abstract worlds — Done, no `via` sensors

- [x] Networks: small-world, random, scale-free, ring, complete, explicit; force layout through d3-force-3d behind a thin adapter; graph view
- [x] Atomic `exchange` trades between linked nodes
- [x] Multi-series charts
- [x] **Epidemic** (SIR) on a network, and the **same script file** running on a grid
- [x] **Market**: traders with cash and goods trading over links
- [x] Headless run with no renderer (`npm run run -- epidemic`)

Pending:

- [x] `via` neighbor sensors over named relations (agents; networks already read their links as neighbors).
- [ ] `transform.meaning = "layout"`.
- [ ] `update` (whole-network field rules) for networks; only per-node `decide` works there today.

## M6 — Bodies and physics — Mostly done

- [x] Rapier (deterministic build) behind an adapter; the choice is in `docs/decisions/physics.md`
- [x] JSON bodies with parts, joints, motors, an oscillator drive; templates and `attach`; geometry as arithmetic on params
- [x] Terrain, creature collisions, shadows, fences and reset
- [x] Snapshot, restore and fork of physics state; identical replicate runs
- [x] URDF importer (box, sphere, cylinder; revolute, continuous, fixed) with `examples/urdf-bot`

Pending:

- [ ] The MuJoCo WASM comparison from the original spike.
- [x] MJCF importer (`importMjcf`, `npm run mjcf -- model.xml`): nested bodies, box/sphere/capsule/cylinder geoms (sized or `fromto`), hinge/ball/free joints with ranges, euler/quat/axisangle, mass or density. No slide joints, meshes or several joints on one body (reported).
- [ ] glTF for visuals.
- [x] Rotated links in URDF: parts take a `rotation`, and the importer composes `rpy` frames down the link tree (shapes, child positions and joint axes follow).
- [x] Annotated mutation and crossover utilities (`mutate`, `crossover`, `randomGenome` in `@breve/experiment`): they read the min, max and step the scene gives each param, so they work on body geometry params as well as any other. They stay out of core.

## M7 — Learning and language models — Partly done

- [x] `think()` with `ctx.ask`: lockstep and realtime modes, a decision log, exact replay without calling the model (`examples/llm-wanderers`, `/api/decide`)
- [x] Authoring assistant: prompt in, validated scene and script changes out, accept or reject, undo
- [x] Per-agent neural network weights as columns (`ctx.mlp`)
- [x] A morphology search with the experiment layer

Pending:

- [ ] ONNX or WebGPU inference, and batched inference for populations.
- [ ] Loading models from the Hugging Face Hub into an asset store.
- [ ] A camera sensor so a VLM can drive an agent.
- [x] Workbench controls for lockstep mode and for saving and replaying a decision log (a bar above the view when a set thinks; checked in a headless browser with a stubbed model).

## M8 — Site and editing polish — Planned

The workbench is currently the whole app. This milestone gives breve a front door and makes configs easier to edit without hand-writing JSON.

- [ ] **Home page**, separate from the simulations page (the workbench). It introduces breve and embeds a few live demos (aim for three, for example boids, ants and the epidemic) using `breve.run`, with links into each one in the workbench. It should load fast: the demos start when scrolled into view and pause when off screen.
- [ ] **Standard project site navigation**: Home, Simulations (the workbench), Gallery, Docs, About, and a link to the source. The workbench header and the Docs tab share it, and `?embed` hides it.
- [ ] **JSON tree editor for the config**: edit `scene.json` (and `experiment.json`) as a collapsible tree with typed fields, number inputs, color pickers, dropdowns drawn from the schema, add/remove for lists and objects, and inline validation errors. It sits beside the text editor as a second view of the same text, so either can be used and edits keep the file's formatting.
- [ ] **Gallery view**: browse all examples as cards with a live thumbnail or screenshot, title, description and tags; open one in the workbench, fork it, or copy a link. It also lists your own projects (stored in the browser for now) and is where URL-encoded sharing starts: a shareable link that carries a scene and script.

Acceptance: the home page shows three working demos and links to everything above; every config field in the examples can be edited from the tree editor without touching the text, and the text still validates; the gallery lists every example and opens any of them in one click.

## Later (not started)

- Server-side project storage and accounts; projects live in browser storage only today.
- Sandboxed untrusted sims (QuickJS).
- Timeline scrubber.
- GPU-resident dense patch layers.
- Remote controllers for Python training.

## Housekeeping

- Pushed to GitHub on branch `next` of `jonklein/breve.js`; the newest commits are local until pushed.
- `docs/script-api.md` and the generated `docs/stdlib.md` are the assistant's reference; a test keeps `stdlib.md` in sync with the code.
