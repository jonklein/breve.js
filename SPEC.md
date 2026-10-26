# breve (next generation) — design spec

Status: draft v0.1. Working name "breve"; positioning is open (see Open questions).

## 1. Vision

An open-ended, browser-based platform for building and tinkering with multi-agent simulated worlds. Inspirations: StarLogo, Karl Sims' creatures, Yaeger's Polyworld, and the original breve simulation environment (2000).

It is **not** a reimplementation of the original. It keeps the original's goals and drops its decisions (custom language, hand-rolled physics, code-only morphologies, sine-wave-plus-evolution as the default).

### Goals

1. **Tinkerability is the product.** Edit something, see the result within about a second. No build step. Sensible defaults for everything, so a blank world already runs, renders and is inspectable.
2. **One world model for many kinds of sim.** 3D continuous physics, cellular automata, spatial resource patches, abstract networks and economies are all configurations of the same model, not separate engines.
3. **Structure is data, behavior is code, anything that thinks is a controller.** Worlds, bodies and experiments are JSON that people and LLMs can edit safely. Behavior is JavaScript or a learned model, attached as a controller.
4. **Many sims are normal.** Running a grid of variants, forking a run, or planning inside a sim by simulating forward are first-class, not bolt-ons.
5. **Open-ended.** No single learning or search paradigm is privileged. Evolution is one library among many.
6. **Modern building blocks.** Use off-the-shelf physics, rendering, inference and graph tools. Do not write a physics engine.

### Non-goals

- A custom scripting language.
- A bespoke physics engine or renderer.
- Built-in evolutionary computation in the core. (It ships as an example library.)
- Server-side infrastructure. The default is local-only, bring-your-own keys for any hosted model.
- Photorealism or game-engine features.

## 2. Principles

- **Determinism.** Seeded RNG, fixed timestep, and a defined phase order. The same scene plus seed plus logged controller outputs reproduces the same run.
- **Headless first.** The sim core never touches the DOM or a renderer. Rendering is a reader of world state.
- **Serializable state.** Any sim can be snapshotted, restored, forked and replayed.
- **Sim is a value.** No global singleton world. Create many, hold them, pass them around.
- **Thin adapters.** Physics, inference and rendering sit behind small interfaces over existing libraries, so the abstraction never hides the underlying tool.
- **Schema everywhere.** Every data format has a JSON Schema. That gives validation, editor autocomplete, inspector UI and constrained LLM output.
- **Honest about non-determinism.** If something can't be reproduced (an LLM call, a remote controller), the platform records it and flags it. It never silently breaks replay.

## 3. World model

```
World = Entities + Components + Relations + Systems + Controllers + Clock
```

| Primitive | Description |
|---|---|
| **Entity** | An integer id (with a generation counter). Nothing else. |
| **Component** | Typed data attached to entities: `transform`, `body`, `energy`, `cash`, anything. Declared by schema. |
| **Relation** | A typed, first-class connection between entities (`neighbor_of`, `trades_with`, `parent_of`). |
| **System** | A rule that runs each tick over entities and relations. Code. |
| **Controller** | Maps an entity's observations to actions. See section 6. |
| **Clock** | Fixed timestep, seeded RNG, phase order. |

### 3.1 Space

There is no "mode." Every entity may have a `transform`, and 3D continuous space is the default. Other kinds of sim are configurations:

- **Patch.** An entity, usually a cube-shaped region at a position, carrying resource or state components and neighbor relations. A patch is an ordinary entity.
- **Cellular automaton / lattice.** A set of patch entities with implicit lattice adjacency.
- **Network.** Entities with explicit relations. The `transform` is display-only.
- **Economy / abstract.** Entities with data components and controllers, no body, possibly no renderer.

Two flags make this uniform:

1. **Neighbor source.** Neighbors are either **derived** (a spatial query: within radius `r`, or lattice adjacency) or **declared** (explicit edges). Neighbor sensors take a `via` parameter naming the source (`"space"`, `"lattice"`, or a relation name). A controller does not need to know which it has.
2. **Transform meaning.** A transform is either `"physical"` (used by physics and spatial sensing) or `"layout"` (render-only, such as a force-directed graph layout). Same component, different semantics. In the implementation this is decided by the kind of set rather than by a flag: free agents and bodies are physical, and a network's positions are always layout (its links, not its distances, define neighbors). A flag would only matter for a set that could be either, and there is none yet.

### 3.2 Tick phases

Each tick runs these phases in order. This is part of the contract, so interactions are predictable:

1. **Sense**: sensors write observations.
2. **Decide**: controllers produce actions (async controllers hold their last action).
3. **Act**: actions are applied to entities and actuators.
4. **Rules**: user systems run, including patch and relation updates (diffusion, decay, sources).
5. **Physics**: the physics adapter steps.
6. **Record**: metrics and recorders sample the world.

Boundary behavior for lattices and bounded regions is declared per scene: `clamp`, `wrap` or `absorb`. Sampling of patch values is `nearest` or `interpolated`, chosen per channel.

## 4. Storage model

All entity state is stored **columnar** (structure-of-arrays). This is a core decision because snapshot, fork, worker transfer, rendering and determinism depend on it. It is expensive to retrofit.

### 4.1 Layout

- Entities with the same component set share an **archetype table** of typed-array columns. An entity is an index into its table.
- Component schemas declare typed fields: scalar numbers (`f32`, `f64`, `i32`, `u8`...), fixed vectors, enums, entity refs, strings and arbitrary JSON.
- In the implemented scene format, a set's state fields are not declared in the scene: they are what the script's `init` returns (a typed array from `initAll` picks a small number type on very large grids). See `docs/decisions/x-and-xall.md`.
- Spawn and despawn use dense arrays with swap-remove or a free list. Ids carry a generation counter so a stale reference cannot silently address a different entity.
- A table may declare a **shape** (for example `[1000, 1000]`). Then adjacency is implicit index arithmetic and costs no storage. This is how a million-cell Life lattice is cheap. "A patch is an entity" remains true at the API level.
- A spatial hash index can be built over a table's transform columns.
- Relations are first-class tables: explicit edge columns (CSR layout for fast neighbor iteration), or an implicit rule such as `lattice-4`.

### 4.2 Per-entity data that is not a small scalar

| Kind | Examples | Storage |
|---|---|---|
| Small fixed-size per entity | position, energy, goal vector | Plain columns |
| Large numeric per entity | NN weights, RNN hidden state | Strided column `[N × P]`, or ragged column with an offsets array |
| Shared, mostly immutable | pretrained model, body template | **Asset store**, content-addressed, referenced by id; copy-on-write on mutation |
| Free-form | strings, nested JSON, LLM memory | **Object column**: slower to snapshot, not GPU-eligible, flagged in the inspector |
| Runtime resources | ONNX session, GPU buffer, websocket | Not state. Owned by controllers, rebuilt on restore |

The rule: **anything that affects behavior must be in snapshot-able storage, or its controller must be declared non-deterministic.**

### 4.3 Access API

Two levels, both required:

- **Handles** for readable scripts: `self.energy -= 1`, implemented as getters and setters over columns.
- **Raw column access** for systems and hot loops: `const { energy } = table.columns`.

The handle layer is part of the platform and must be tested carefully. If scripts are hard to read, the tinkerability goal fails.

**Collective operations** (a favorite feature of the original) are part of the handle layer. A group of entities, such as the result of a neighbor sensor, answers questions as a whole, so scripts need few loops:

```js
neighbors.velocity.average()          // one vector: the group's mean velocity
neighbors.offset.average()            // toward the middle of the group
neighbors.within(2).offset.sum()      // only the close ones
```

Groups expose plural accessors (`position`, `velocity`, `offset`, `distance`), filters (`within`, `nearest`), and return vector lists (`Vecs`) with element-wise math (`plus`, `minus`, `times`, `normalized`) and reductions (`sum`, `average`) that are safe on empty lists. Vectors (`Vec3`) are immutable with chainable methods. This layer allocates, so hot loops that need speed use raw columns. A measured baseline: boids at 1000 agents takes about 15 ms per tick in this style, so lazy or column-backed views are a known follow-up.

### 4.4 Snapshot, fork, replay

- Snapshot is a copy of the columns, the asset references, controller state and the RNG state.
- Fork is a snapshot restored into a new Sim. Immutable assets are shared by reference.
- Replay uses the seed, the initial snapshot or scene, and the recorded outputs of every non-deterministic controller.

## 5. Scenes, bodies and data formats

Everything structural is JSON with a JSON Schema.

### 5.1 Scene

A scene declares params, entity sets (with component data or generators), relations, patch layers, controller bindings, and references to bodies and assets. Scripts add only systems (rules). Sharing a sim means sharing a scene plus a few small scripts.

Params declared in the scene get auto-generated UI controls. Metrics declared in the scene get auto-generated charts.

### 5.2 Bodies (morphologies)

A body is a JSON document, **not code**:

- **parts**: shape, size, mass, material
- **joints**: type, axis, limits, motor
- **sensors and actuators**: attached to parts or joints; their declarations define the controller's observation and action schema
- **optional annotations**: which fields are mutable and their ranges; recursive structure (a node refers to another node with a recursion limit) is expressible in data

Importers convert **URDF** and **MJCF** into this schema, and **glTF** provides visuals. These are importers into our schema, not full support for those formats.

Mutation and crossover utilities operate generically on any annotated JSON body. They are utilities that strategies may call, not a platform concept. See section 8.

### 5.3 LLM editing

Because scenes and bodies are schema-validated JSON, an LLM edits them as validated diffs ("give it longer legs"). This is far more reliable than editing code. LLM-authored scripts use the same public API a human would.

## 6. Controllers

A controller maps observations to actions for one entity. Controllers are independent classes, any entity can have any controller, and users can write their own.

```ts
interface Controller {
  spec(): { observe: Schema; act: Schema; state?: Schema }
  reset(ctx: Context): void
  act(obs: Obs, ctx: Context): Action | Promise<Action>
  display?(obs: { self }, params, ctx): Display   // how this entity looks; read-only, never affects the sim
  snapshot?(): Uint8Array      // escape hatch for opaque state
  restore?(b: Uint8Array): void
}
```

Sensors and actuators are declared as data on entities and bodies. Their declarations define the observation and action schema, so a controller can be validated against an entity before it runs.

### 6.0 Display

**Naming rule (docs/decisions/x-and-xall.md).** Every controller hook has a per-entity form `x` and may have a whole-set form `xAll` that trades generality for speed (whole fields in and out, `Field` arithmetic, single-number state, no per-entity effects; a fixed graph of array operations that could later run on a GPU): `act`/`actAll`, `think`/`thinkAll`, `init`/`initAll`, `display`/`displayAll`. `update` is the old name of `actAll`.

How an entity looks is part of its controller, next to how it decides: `export default { act(...) { return state }, display(...) { return look } }`. `display` is a pure function of the entity's state (and params and the tick) that returns display properties such as `color`, `scale`, and `opacity`. It cannot change the simulation, so it cannot affect determinism, forking, or replay, and it may be evaluated at render rate and only for visible entities. The results are stored as an optional `display` component (columns) that the renderer reads like any other state. When a controller has no `display`, everything is drawn in a default color (or the set's `color`). Easing between display values (a fade) is a renderer option applied to the `display` columns, reusable for any entity kind. Aggregate measurements about the whole world stay separate (the exported `metrics`), because they belong to the world, not to one entity. `display` receives only `self` by default (cheap); anything that depends on the surroundings should be computed in `act` and stored as state.

### 6.1 Built-in controller types

- **Script**: a plain JS function.
- **Oscillator**: a sine/CPG controller (the breve classic).
- **Neural**: ONNX / WebGPU, with weights as strided columns or shared assets. Models can be loaded from the Hugging Face Hub.
- **LLM** and **VLM**: the VLM receives a camera sensor's rendered frame as observation. Allowed everywhere, not recommended for high-rate control.
- **Human**: keyboard or gamepad.
- **Remote**: websocket, so external (for example Python RL) trainers can drive a sim.

### 6.2 Async controllers

Async controllers decide at their own rate and the last action is held between decisions. Two modes:

- **lockstep**: sim time waits for the answer. Deterministic, slow.
- **realtime**: the sim keeps running. Non-deterministic, but every decision is logged by the parent so the run can be replayed deterministically.

### 6.3 Composition

A controller can wrap other controllers using the same interface, for example an LLM controller emitting a `goal` that a small neural controller turns into motor commands. The core has no notion of "tiers."

### 6.4 State contract

Controller state is either declared in `spec().state` (stored in columns, free snapshot/fork/replay) or provided via `snapshot()`/`restore()`. A controller that has undeclared behavior-affecting state must mark itself non-deterministic. The platform flags such sims in the UI ("forking won't reproduce controller X") and does not fail silently. Runtime resources (sessions, GPU buffers) are rebuilt from asset ids after restore.

## 7. Sim as a value

```ts
const sim = await Sim.create(scene, { overrides, seed })
sim.step(n)
sim.run({ until })
sim.metrics()
sim.snapshot()
sim.fork()
sim.send(msg) / sim.onMessage(fn)   // parent channel only
sim.dispose()
```

A Sim is created from a scene plus overrides plus a seed. It runs headless in a Worker by default.

### 7.1 Relationships between sims

- **Batch**: many sims created from variants of one scene, run in a worker pool. A grid of 12 is `variants.map(v => Sim.create(scene, v))`.
- **Fork**: snapshot a running sim and branch it (counterfactuals, replicates from shared state, checkpoint-restart).
- **Embedded**: a controller forks the world it lives in and runs it forward to plan (model-predictive control, an LLM "imagining" outcomes).
- **Tree**: sims have at most one parent. A parent can be the experiment runner, a script, or an entity in another sim.

### 7.2 Messaging

Messaging is **parent-mediated**. A sim has one outward channel to its parent and never addresses a sibling. Messages are plain data, delivered at tick boundaries, and logged by the parent so replay is possible. Island models and shared markets across sims are built by a parent script routing messages.

### 7.3 Scheduling

A budget-aware scheduler manages the worker pool. Rendering is optional for every sim.

## 8. Experiment layer

Evolution is not special. One generic loop covers every search or sweep strategy:

```
propose → run → observe → decide what to run next
```

Grid sweeps, random search, Bayesian optimization, CMA-ES, genetic algorithms, MAP-Elites, RL training, an LLM acting as proposer, and a human clicking around are all implementations of one `Strategy` interface:

```ts
interface Strategy {
  propose(history: Result[]): Variant[]        // variants are scene overrides
  done(history: Result[]): boolean
}
```

The core provides only the mechanics strategies share: scenes as data (so a variant is just overrides), deterministic seeds, headless execution, metrics and recorders, snapshots and forks, asset ids for weights.

An experiment is itself JSON:

```json
{
  "scene": "boids",
  "seed": 7,
  "base": { "count": 40, "speed": 2 },
  "sweep": { "cohesion": [0.1, 0.5, 0.9], "separation": [0.2, 0.6, 1.0] },
  "metric": "polarization",
  "steps": 600
}
```

Ship several strategies as example libraries (sweep, random, one evolutionary, one other such as CMA-ES) to prove the interface does not favor any one method. Generic mutation/crossover utilities over annotated JSON live in a utility package, not in the core.

## 9. Physics

Physics sits behind an adapter interface. Candidates: **Rapier** (small, fast, runs well in the browser) and **MuJoCo WASM** (likely stronger for articulated, motor-driven locomotion, which is the creature case). Maturity of the MuJoCo WASM build is unverified.

**Update:** the first slice chose Rapier (deterministic build) and the adapter interface lives in `packages/core/src/physics/types.ts`; see `docs/decisions/physics.md`. MuJoCo WASM was not compared.

**Decision gate (original):** a short spike (first task of milestone 6) puts one 4-legged JSON body with motors through both engines and compares stability, determinism, performance and bundle size. The adapter interface is designed from the result, not before.

Physics is optional per entity. Entities without a `body` component are not physical.

## 10. Rendering and interface

- **Renderer is a pure reader** of world state. Sims run headless in workers and send position and attribute buffers (transferable or shared) to the renderer.
- **One shared WebGL context** draws the main view and all multiverse tiles using scissored viewports. Browsers cap live WebGL contexts at roughly 16, so per-tile canvases would break on bigger sweeps. Focused tiles render at full rate; others at a lower rate. Non-spatial views (charts, graph layouts) can use 2D canvases.
- **One sim, many views**: a 3D view, a graph view and a chart can all be attached to the same world.

### 10.1 Workbench UI

Reference mockup behavior (see the design discussion):

- Left: editable data (`scene.json` or `experiment.json`) with validity status, and the controller script beneath. Edits hot-reload without resetting state where possible; a parse error keeps the last good state running.
- Right: viewport for one sim, or a tiled "multiverse" for a batch, each tile labeled with its overrides and a live metric, the best outlined.
- Click a tile to fork it into a single-sim view, with its parameters written into the scene.
- Bottom: transport (play, pause, step, reset), tick, and hints.
- Later: agent inspector (click an agent, view and edit state), timeline scrubber (rewind, fork at time), LLM authoring pane (prompt in, validated diff out, accept or reject).

## 11. Sandboxing

User and LLM-authored scripts run in a Worker. For sharing untrusted sims, a QuickJS-WASM sandbox is an option. Scripts get only the public API. No network access from scripts except through declared Remote or LLM controllers, which use keys the user supplies.

## 12. Technology choices (initial)

- **Language:** TypeScript for the core; plain JS for user scripts.
- **Rendering:** Three.js or similar behind the renderer interface (decision at milestone 1).
- **Graph display:** graphology + a layout library.
- **Inference:** ONNX Runtime Web and/or transformers.js, WebGPU where available.
- **Physics:** see section 9.
- **Packaging:** monorepo, core package with no DOM dependencies.

## 13. Open questions

1. Rapier vs MuJoCo WASM (resolved by the physics spike in milestone 6).
2. Naming and positioning: "breve 2", or a new thing that nods to breve?
3. Sharing: URL-encoded sims at first, or a gallery later? Hosting is out of scope initially.
4. Which LLM and VLM providers to support first (bring-your-own key).
5. Whether to provide a TypeScript layer that generates scene JSON, or keep JSON only.
6. Performance targets for agent counts in 3D physics sims.
