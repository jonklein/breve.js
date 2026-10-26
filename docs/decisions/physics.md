# Physics engine

Status: decided (Rapier, deterministic build). Date: 2026-10-25. Milestone 6, first slice.

## Context

SPEC section 9 asks for a spike before choosing a physics engine: one four-legged JSON body with motors, compared on stability, determinism, speed and bundle size. The adapter interface is to be designed from the result. This record covers the spike we actually ran (Rapier only) and the first creature demo built on it (`examples/creature`).

## Options

1. **Rapier** (`@dimforge/rapier3d-deterministic-compat`, v0.21). Rust compiled to wasm, with a build that guarantees bit-identical results across machines and browsers. The `-compat` flavour embeds the wasm as base64 inside the JS, so Vite and node need no wasm plugin or `?url` import (CLAUDE.md forbids both).
2. **MuJoCo WASM.** Probably better for articulated, motor-driven locomotion (soft contacts, reduced-coordinate joints, tuned actuator models). **Not built or measured here.** Its WASM maturity is still unverified, and it has no determinism guarantee across browsers that we know of.
3. Writing our own: ruled out by CLAUDE.md rule 6.

## Decision

Use Rapier's deterministic build behind a small adapter (`packages/core/src/physics/types.ts`). The adapter speaks our data (a JSON body, a heightfield), not Rapier's types, so MuJoCo could be added by building MJCF from the same body JSON. The interface is `PhysicsEngine.createWorld` -> `PhysicsWorld` (terrain, `addArticulation`, `step`, `hash`) -> `Articulation` (`readPoses`, `readAngles`, `setMotors`). Only `physics/rapier.ts` imports Rapier. The engine is loaded lazily: `Sim.create(scene, script)` does `await import('./physics/rapier')` only for scenes with a `body`, so boids and life never load it. `new Sim(scene)` still works for them.

New dependency: `@dimforge/rapier3d-deterministic-compat`, the only physics library that is small, maintained, permissively licensed (Apache-2.0), deterministic by construction and usable from node and a browser worker without build configuration.

## What was measured

Machine: the dev laptop (Apple silicon), node 23 for tests and benches. Reproduce with `node --import tsx packages/core/bench/physics.bench.ts`. The creature has 9 parts and 8 motorized hinges, standing on a 64x64 heightfield. Numbers include the whole sim tick (oscillator, `decide`, motors, physics, pose readback), not just `world.step`.

| | 1 creature | 20 creatures |
|---|---|---|
| 4 substeps per tick (default) | about 2500 ticks/s (0.4 ms) | about 180 ticks/s (5.6 ms) |
| 2 substeps per tick | about 5400 ticks/s | about 320 ticks/s |

So 20 creatures run about 3x faster than real time at the 60 Hz default. A tick costs roughly 0.27 ms per creature at 4 substeps; the cost is almost linear in creature count (the creatures do not collide with each other, which keeps the broad phase cheap). 100 creatures would be about 28 ms per tick, which is below real time: expect to lower the count or substeps there. **Browser speed was not measured** (no browser use in this spike); wasm in a worker is usually within 1.5x of node.

**Determinism.** Two runs in one process with the same scene and seed have identical state hashes (poses, velocities of every body, plus the column hash, RNG state and tick) after 1000 ticks with 8 creatures. Two separate node processes print the same hash (`200e432a:27563e29:3c136f03:1000`). The tests in `packages/core/test/physics.test.ts` check the in-process case and that a different seed or a different script output changes the hash. **Cross-browser determinism is promised by the deterministic build but not verified here.** It also depends on our own code not using non-deterministic math: we only use `Math.sin`/`cos`/`atan2`, which can differ in the last bit between JS engines (V8 vs JavaScriptCore). That affects the oscillator targets and spawn orientation, so bit-identical replay across browsers is **not guaranteed yet**. A fixed-polynomial sine would close that gap if we need it.

**Bundle.** `rapier.mjs` is 4.4 MB raw (3.1 MB of it the wasm, base64-encoded), about 1.7 MB gzip, shipped as a separate lazy chunk (`vite build` shows `rapier-*.js`, 4.37 MB). The main bundle and the worker are unchanged for non-physics scenes (worker 157 kB). Loading and creating the first world takes about 120 ms in node.

**Motion quality.** With force-based hinge motors (torque per radian, set per joint from the body JSON), a trot made of a sine on each hip and a phase-shifted sine on each knee gives a steady walk of about 0.6 to 1 m/s on terrain with +/-0.6 m hills. It is not robust everywhere:

- Gait is sensitive to the phase relation between hip and knee. The same legs walk forward, backward or barely at all depending on `kneeLag` (that is why it is a slider). Acceleration-based motors (Rapier's default) let the torso collapse at the gains we tried, since their torque scales with the light leg's inertia, so the adapter uses the force-based model.
- Some random starts, or hard steering, make a creature fall over. The world puts a creature back on its feet (respawns it) after 3 s flat or flipped, or if it falls off the terrain. It happens occasionally, mostly after sharp turns.
- Motor gains and solver iterations matter: at 2 substeps it is stiffer and noisier; 4 substeps (default) were clearly better in the search.
- Creatures do not collide with each other (collision groups), only with the terrain, so stacking and crowding are not modelled.

If creature motion quality turns out to be the bottleneck for evolution or learning (instability, energy-inefficient gaits, contact jitter), **MuJoCo WASM is the alternative to try**: same body JSON, a new adapter file, same tests. Do not build it until motion quality is shown to be the actual limit.

## MuJoCo WASM spike (measured 2026-10-26)

The comparison the first spike skipped. `scripts/mujoco-spike.mjs` (needs `npm install --no-save @mujoco/mujoco`, the official DeepMind build, v3.17; not a dependency of this repo) turns the same creature body into MJCF (y-up to z-up, position actuators with the body's own gains, the same oscillator law, no steering script) and runs both engines on a flat floor. Same Linux test box for both, 600 ticks of 4 physics steps, node 22.

| | Rapier (product) | MuJoCo WASM (naive translation) |
|---|---|---|
| 1 creature, ms per tick | 0.5 to 0.9 | 0.08 to 0.14 |
| 20 creatures, ms per tick | 6.3 to 7.3 | 1.3 to 1.5 |
| Same state twice in one process | yes (hash equal) | yes (hash equal) |
| Walks 10 s without falling | yes: 10.4 m, 20 of 20 upright | **no**: moves ~1.2 m/s for two or three seconds, then buckles and lies flat |
| WebAssembly size | about 3.1 MB (4.4 MB base64 in the bundle, 1.7 MB gzip) | 10.9 MB (plus a 0.3 MB loader) |

What this does and does not show:
- **Speed:** MuJoCo steps this body about 5 times faster per tick. That is a real advantage if scenes ever need hundreds of creatures.
- **Gait:** the claim that MuJoCo is better for locomotion is **not confirmed**. With a straightforward translation (implicit-fast integrator for the motors, joint damping standing in for Rapier's body damping) the creature does not hold its walk. The Rapier setup was tuned over the whole product's development (substeps, force-based motors, collision groups), and MuJoCo would need its own tuning (contact softness, actuator and armature settings) before a fair gait comparison is possible. The spike shows the cost of switching is tuning, not translation.
- **Determinism:** both repeat in one process. MuJoCo makes no cross-machine promise that we know of; Rapier's deterministic build does. That, and the snapshot/restore/fork that now work for Rapier worlds, favor staying.
- **Size:** MuJoCo's WebAssembly is about three and a half times larger, loaded only for scenes with bodies either way.

**Decision stands: Rapier.** MuJoCo remains a possible second adapter (the importer, `npm run mjcf`, already reads MJCF, and this script is a body-to-MJCF exporter that could grow into an adapter) if scene sizes outgrow Rapier.

## Consequences

- Physics state lives in wasm memory, not in columns. What is in columns (torso pose, velocity, distance travelled, oscillator phase, down counter) is derived or small. **Snapshot/fork of a physics sim is therefore not implemented**: Rapier supports `takeSnapshot()` / `restoreSnapshot()`, which should be wired into `Sim.snapshot` when M1/M2 land. Until then, `World.hash()` is the determinism check and `Sim.dispose()` frees the wasm world.
- `Sim.create` is async and the worker's `rebuild()` awaits it. Editing the body, terrain, physics block or seed in the scene respawns the creatures; count, params and script apply live.
- The terrain is an implementation of `HeightfieldDef` (size, n, heights) built from the scene seed with Perlin noise (`noise.ts`, `terrain.ts`). The render mesh uses the same samples, so the surface matches the collider except for the choice of triangle diagonals (at most a few centimetres).
- Physics substeps (default 4) and gravity are scene data (`physics` block).
- Since this record was written: snapshot, restore and fork of physics worlds; URDF and MJCF importers; part rotation; glTF visuals; mutation utilities (see MILESTONES.md). Still open: driving joints other than hinges (ball and fixed joints exist but cannot be driven).
