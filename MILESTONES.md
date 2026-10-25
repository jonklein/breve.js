# Milestones

Each milestone ends in a **demo that doubles as an acceptance test**. A milestone is done when its demo runs, its headless tests pass, and the spec sections it touches are updated to match reality. See `SPEC.md` for definitions and `CLAUDE.md` for working conventions.

The order is: a playable thin slice first (M0), then harden and widen. The creature demo is a test of the platform, not its center. It comes late on purpose, after the Sim abstraction and storage model are proven. Physics is deferred because boids and most abstract sims do not need it.

## M0 — Playable slice

Goal: something you can open in a browser and play with, end to end, as early as possible. 3D boids, with the real shape of the experience: scene data, a script, live editing, a 3D view. The quality bar is "fun to poke at," not feature-complete.

Scope (deliberately thin, but built on the real architecture, not throwaway code):

- Minimal columnar store: one archetype table, typed-array columns, generation-checked ids, handle and raw-column access. No lattice, relations or object columns yet.
- Seeded RNG, fixed timestep, the phase order from `SPEC.md` (sense, decide, act, rules, physics stubbed, record).
- Scene JSON (params, one agent entity set, one script controller) with a JSON Schema and readable validation errors.
- Script controller: a plain JS function per agent, with a neighbor sensor (spatial query, brute force or simple grid hash).
- Minimal 3D renderer (Three.js or similar) as a pure reader of world state. Instanced agents, orbit camera.
- Workbench v0, in the browser: editable `scene.json` and `flock.js` panes, params as auto-generated sliders, a live metric chart (polarization), transport (play, pause, step, reset). Edits hot-reload without resetting the run; a parse or script error keeps the last good state running and shows the error.
- Sim core runs in a Worker from day one (even though it is one sim), with the render buffers passed across. This avoids a rewrite at M2.
- Build tooling: `tsc` for core packages, Vite for the workbench only (see `CLAUDE.md`).

Acceptance (you can click on it):

- `npm run dev` opens a page showing a few hundred boids flocking in 3D.
- Dragging a slider changes behavior live. Editing `flock.js` and saving changes behavior live without a reset.
- A bad edit shows an error and the sim keeps running.
- Determinism test: same scene and seed give identical column bytes after N ticks across two runs.

Not in M0: lattices, relations, Sim snapshot and fork, multiple sims, bodies, physics, neural controllers, LLM features.

## M1 — Kernel hardening

Status: done except relation tables and the object-column fallback (moved to M5, where the first relation-based sims need them). Snapshot/restore/fork work for agent and lattice worlds; physics scenes cannot be snapshotted yet. A 1000×1000 Life tick is ~80 ms, over the 30 ms placeholder (see `docs/perf.md`).

Make the M0 kernel match the spec, now that the experience exists to test it against.

- Lattice shape (implicit adjacency), relation tables, spatial hash index, object-column fallback.
- Declared metrics as a first-class concept feeding auto-generated charts.
- Snapshot and restore of columns, RNG state and controller state.
- Storage benchmarks recorded in `docs/perf.md`.

Acceptance:

- **Life as patches:** a 1000×1000 lattice runs, snapshots and forks headless within budget (target: snapshot or fork under 50 ms, step under 30 ms on a recent laptop; treat these as placeholders until measured).
- Life is playable in the workbench using the same scene and script mechanism as boids.
- Snapshot round-trip test: restore gives identical column bytes.

## M2 — Sim as a value

Status: done except a multi-worker pool. `SimGroup` (core) holds sims, forks, sweeps and routes parent-mediated messages with a replayable log; the workbench has a Sweep mode (tiled view on one shared renderer, per-tile metric lines, click a tile to continue from it). One worker runs the whole group with a per-frame time budget. Per-agent state arrays and `ctx.mlp` cover the strided-weights acceptance (`examples/neural`).

- `Sim.create / step / run / snapshot / fork / dispose`, worker-hosted, headless by default.
- Worker pool and budget-aware scheduler.
- Parent channel and logged messages.
- Shared WebGL renderer with scissored tiles for multiple sims.
- Workbench v0: editable `scene.json`, hot reload without reset, validity status, transport.

Acceptance:
- **12-sim parameter sweep** of the boids scene with tiled viewing, live metrics, click-to-fork into a single view (matches the reference mockup).
- Fork determinism: fork a sim mid-run; both branches given identical inputs produce identical trajectories.
- 100 agents each with a small MLP controller (declared state: strided weights and hidden state), forked mid-run, branches identical. This exercises strided columns and controller state together.

## M3 — Controllers and inspector

Status: done. Several entity sets per scene, controllers by named export (`type`), `ctx.blend` composition, keyboard-driven controllers flagged non-deterministic (`examples/herding`), the ants acceptance (`examples/ants`), and a click-to-inspect panel with a controller swap menu. Not done: per-entity (rather than per-set) controller choice.

- Controller interface and state contract; sensors and actuators declared as data.
- Script, Human and Oscillator controllers.
- Controller composition (wrapping).
- Agent inspector: click an entity, view and edit components, see attached controller and its declared state.
- Non-determinism flagging in the UI.

Acceptance:
- **StarLogo-style ants:** foraging with a pheromone patch layer, a script controller, and a patch (entity) layer with diffusion and decay rules.
- Swapping an agent's controller at runtime changes its behavior with no scene edits beyond the binding.

## M4 — Experiment layer

- `Strategy` interface, experiment JSON, metrics collection and ranking.
- Strategies: grid sweep, random search, plus one more of a different family (for example CMA-ES) to show the interface is not biased to one method.
- Experiment results viewer and export.

Acceptance:
- The 12-sim sweep from M2 is now driven by an experiment file, not hand code.
- Three strategies run against the same scene with no changes to core code.

## M5 — Abstract worlds

Status: done except `via` sensors and `transform.meaning` (a network's links are its neighbors, and the layout is display-only, which covered the demos). Networks (small-world, random, scale-free, ring, complete, explicit), a force layout through d3-force-3d behind a thin adapter, atomic `exchange` trades, a graph view, multi-series charts, `npm run run -- <example>` for headless runs. Epidemic and grid-epidemic share one script file.

- Declared relations (explicit edges), `via` neighbor sensors, `transform.meaning = "layout"`.
- Graph view with layout; chart views.
- Headless-only operation with no renderer.

Acceptance:
- **Epidemic on a network** (SIR) with a controller for node behavior.
- **A simple market:** agents with cash and inventory trading over relations, metrics charted, no spatial component.
- The same neighbor-sensor controller works unchanged on a lattice and on a graph.

## M6 — Bodies and physics

Status: mostly done. Added since the first slice: snapshot, restore and fork of physics state, `$param` expressions in body geometry (morphology search), a URDF importer (box/sphere/cylinder, revolute/continuous/fixed, no rotated frames) with `examples/urdf-bot`. Not done: the MuJoCo comparison, MJCF, glTF, annotated mutation/crossover utilities (a search over geometry params covers morphology for now).

First slice: The spike chose Rapier (`docs/decisions/physics.md`); body schema, physics adapter, terrain, oscillator drive and the `creature` example exist (a walker loaded from scene JSON stands, walks under the oscillator and renders). Not done: MuJoCo comparison, URDF/MJCF importers, glTF, mutation utilities, snapshot/fork of physics state.

- **Physics spike first.** One 4-legged articulated body defined as JSON, with motors, simulated in both Rapier and MuJoCo WASM. Compare stability, determinism across runs and browsers, steps per second at 1 and 100 bodies, bundle size, and joint motor quality. Output: a short recommendation in `docs/decisions/physics.md` and a draft physics adapter interface. The adapter interface is designed from this result, not before.
- Body JSON schema, part/joint/sensor/actuator declarations.
- Physics adapter implemented for the engine chosen in the spike.
- URDF and MJCF importers (into our schema), glTF for visuals.
- Annotated mutation and crossover utilities.

Acceptance:
- A walker loaded entirely from a JSON body file stands, moves under an oscillator controller, and renders.
- At least one imported URDF or MJCF robot loads and renders.
- Replicate runs of the same seed are identical.

## M7 — Learning and language models

Status: partly done. `think()` with `ctx.ask`, lockstep and realtime modes, a decision log with exact replay, the `/api/decide` endpoint and `examples/llm-wanderers`; the authoring assistant (validated diffs, accept/reject/undo) from earlier; per-agent MLP weights as columns (`ctx.mlp`, `examples/neural`); a morphology search through the experiment layer (`examples/morphology`). Not done: ONNX/WebGPU inference, Hugging Face model loading, camera sensors for a VLM controller.

- Neural controller: ONNX/WebGPU, weights as columns or assets, batched inference for populations.
- Hugging Face Hub model loading into the asset store.
- LLM and VLM controllers with lockstep/realtime modes and decision logging.
- LLM authoring pane: prompt in, validated JSON diff or script out, accept or reject, undo.

Acceptance:
- **Creatures in about 20 lines plus a JSON body file:** a morphology search using the experiment layer and the annotated mutation utilities.
- A VLM controller drives an agent from a camera sensor, and replay from the decision log reproduces the run without calling the model.
- An authoring prompt such as "make the predators slower" produces a validated scene diff that applies cleanly.

## Later

- Gallery and URL-encoded sharing, sandboxed untrusted sims (QuickJS), additional importers, timeline scrubber, GPU-resident dense patch layers, remote controllers for Python training.
