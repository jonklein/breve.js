# MuJoCo as an optional physics engine

Status: added as an option to evaluate; Rapier stays the default. Date: 2026-10-26.

## Context

Evolving articulated bodies is a heavy physics use: evolution is throughput-bound, and random jointed bodies are the hard case for a physics solver (see the audit in `creatures.md`: Rapier's impulse joints threw about 3 in 100 random creatures into the air until we added an inertia floor). `physics.md` measured MuJoCo at about five times faster per tick but left its gait and the cost of switching unconfirmed. The ask was to add it so it can be evaluated, kept well isolated and abstracted.

## Decision

- **One adapter interface, many engines.** The engine-neutral interface in `packages/core/src/physics/types.ts` already existed. New: a registry (`registerPhysicsEngine(name, loader)`, `loadPhysicsEngine`) and `physics.engine` in the scene (default `rapier`). Core ships only Rapier, registered by default through a lazy import. Core never imports another engine, so it stays headless and a host that never registers MuJoCo never loads it.
- **A package of its own.** `packages/physics-mujoco` (`@breve/physics-mujoco`) holds all MuJoCo knowledge in two files: `mjcf.ts` (our body as MuJoCo XML, pure text, testable without wasm) and `engine.ts` (the adapter over the wasm). It depends on core's public exports only. New dependency: `@mujoco/mujoco` (the official DeepMind build, Apache-2.0, about 11 MB of wasm, loaded on demand). The workbench registers it in `src/engines.ts` behind a dynamic import.
- **Shared, engine-neutral pieces stay in core**: the inertia floor formulas (`partInertia`, `flooredInertia`) are used by both adapters.
- **Same coordinates.** We keep y up and point MuJoCo's gravity down y instead of swapping axes, so every position, size and axis in a scene's body means the same on both engines.
- **One MuJoCo world per creature.** Adding and removing creatures (respawns, population changes) then never rebuilds the others. Price: creatures never touch each other, so `collide` is ignored (the engine declares this in `limits`). That is fine for evolution (one creature per sub-sim) and for the existing creature demos, where creatures already pass through each other by default in practice.
- **Motors map directly**: a position actuator per motorized hinge, with `kp`, `kv` and a force range updated live from the body's `stiffness`, `damping` and `maxTorque`. `maxSpeed` is applied in the world before the engine, so it works on both.
- **Snapshots** keep positions, velocities, actuator state and the solver's warm start; a restored branch matches the run that carried on (tested).

## Things found along the way

- MuJoCo's heightfield is rows by columns standing in its x-y plane. The mapping to our terrain (`heights[ix * (n + 1) + iz]`) was checked by dropping a slab at five spots and comparing its rest height to the terrain on both engines; an obvious-looking mapping was off by up to 0.27 m.
- `mj_step` leaves body poses one step behind joint positions; the adapter refreshes them (`mj_kinematics`), or a restored state would not match a continued one.
- `mj_getState` / `mj_setState` do not fill ordinary typed arrays in this build; the adapter saves the arrays directly.
- Determinism: repeatable within a process (tested). No cross-machine promise from MuJoCo.

## Evaluation so far (`node --import tsx scripts/engine-compare.mjs`)

100 random evolved bodies with random brains, 300 ticks each, same machine:

| | thrown (over 6 m/s or a metre up) | worst speed | ms per tick |
|---|---|---|---|
| Rapier, no inertia floor | 1 of 100 | 52 m/s | 0.80 |
| MuJoCo, no inertia floor | 0 of 100 | 2.9 m/s | 0.22 |
| Rapier, `minGyration` 0.3 | 0 of 100 | 3.6 m/s | 0.83 |
| MuJoCo, `minGyration` 0.3 | 0 of 100 | 2.9 m/s | 0.19 |

So MuJoCo is about four times faster per tick here and does not need the inertia floor (it adds a small rotor inertia to every hinge itself). On the example four-legged creature MuJoCo also runs without errors; whether it walks as well as Rapier's tuned gait is still unmeasured, and the earlier spike found a naive translation did not hold a trot.

## Consequences and open questions

- Evaluating is a one-line scene change (`"physics": { "engine": "mujoco" }`); `examples/evolved-creatures-mujoco` has it on.
- To decide whether MuJoCo becomes the default for evolution: compare how far evolved creatures get per wall-clock minute, check the creature example's gait with tuned contact settings (`TUNING` in `mjcf.ts` is the one place to adjust), and decide whether losing creature-creature contact and cross-machine bit-identical replay matters for the use.
- Not done: creature collisions on MuJoCo (would need one shared model, rebuilt when creatures come and go), MuJoCo in the embed, joint types beyond hinge, ball and fixed.
