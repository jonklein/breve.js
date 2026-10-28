# Audit: behavior that lives in the engine but belongs to the simulation

## Context
The rule is that the engine provides mechanisms and everything a person could reasonably want to differ lives in the scene or the
script, visibly, with no behavior that changes by itself with the environment. The trigger for this audit: dragging a GPU lattice
panned instead of orbiting, because the viewport switched control schemes when a frame happened to be of kind `field`, which depends
on WebGPU being present. Fixed by `world.camera.mode` (see "Done"). This lists what else breaks the rule, ranked by how much it
surprises a person. Each entry says where it is, what happens now, and the setting that would replace it.

## Done in this change
- **Camera controls switched by implementation detail** (`workbench/src/viewport.ts`). Now `world.camera.mode: "orbit" | "plane"`,
  default `orbit`; it behaves the same with or without WebGPU. The three GPU-lattice examples say `"plane"`.

## A. Silent magic that changes results (fix first)
1. **GPU or CPU is chosen by the environment** (`core/src/lattice-world.ts`, `gpu-lattice-world.ts`). A flat formula lattice runs on
   the card when WebGPU exists and on the processor otherwise; the only override is `"compute": "cpu"`. Results can differ in the last
   bits, the frames differ in kind, and the set may be "not repeatable". Wanted: `"compute": "auto" | "cpu" | "gpu"` with `auto`
   documented as the default and `gpu` failing loudly when there is no card.
2. **Rapier body damping** (`core/src/physics/rapier.ts:73`): every body gets linear damping 0.05 and angular damping 0.3, never
   mentioned in the scene. It is an invisible drag that fights `Fluid` (drag counted twice) and slows anything that coasts. Wanted:
   `physics.linearDamping` / `physics.angularDamping` (default 0 would change old results, so default to today's numbers and say so).
3. **Contact material fixed** (`rapier.ts:58, 279`): terrain friction 1, part friction default 1, restitution 0 always, 8 solver
   iterations, bodies can never sleep. Wanted: `physics.restitution`, `terrain.friction`, `physics.solverIterations`, `physics.sleep`
   (a part's own `friction` already exists).
4. **Creature spawn ignores `spawn.at[1]`** (`core/src/rigid-world.ts:239-247`): y is always the ground under the point plus 0.05,
   and with no `spawn` they scatter over 60% of the terrain with a random yaw. Hit while building the swimmers (the fish had to be
   lifted through part positions). Wanted: honor `at[1]` as a height above ground, and `spawn.yaw`.
5. **Silent count caps**: 200 creatures (`rigid-world.ts:23`, and again in `view/src/rigid-view.ts`), 5000 agents
   (`agent-world.ts:89`), 100000 network nodes (`network-world.ts:48`). Asking for more quietly gives fewer. Wanted: a validation
   error that names the cap (and the caps as documented limits), or lifting them.
6. **Fixed time step** (`DT = 1/60` in `agent-world.ts`, `rigid-world.ts`, `sim.ts`): `clock.rate` only changes how fast ticks are played
   back; `ctx.dt` and every integration use 1/60. Wanted: `clock.dt` (seconds per tick), so rate and step are two honest settings.
7. **Creature ground placement** (`rigid-world.ts:233`): `place` and respawn put the body on the highest of five terrain samples
   plus 0.05. Wanted: a `place` option for height (and the 0.05 and sampling named as defaults).

## B. Behavior chosen by the kind of scene (should be explicit)
8. **Shadows default on for physics scenes, off otherwise** (`world-view.ts:331`). `shadows` can override, but the default depends on
   scene kind. Fine to keep if stated; better one default.
9. **Physics scenes hide the bounds box and floor grid** (`world-view.ts:441-446`) regardless of `frame` and `grid`. Wanted: the
   settings are honored, with the defaults per kind written into the preset or the scene.
10. **Click selects an entity and opens the inspector** (`workbench/src/viewport.ts`), and now press-and-drag moves entities and
    markers. Both are viewer features; wanted: a scene-level `interaction: { inspect, drag }` (so a demo can lock its layout).
11. **`follow` tracks the first body of the first creature** (`world-view.ts`, `follow`). Wanted: `camera.follow` naming a set and row
    (or a marker), and its damping (0.12 is hardcoded).
12. **Camera always looks at the origin and orbits it** (`world-view.ts` `placeCamera`; `controls.target.set(0,0,0)`). Wanted:
    `camera.target`, and zoom limits.
13. **Quality steps down by itself when frames are slow** (`world-view.ts:386-391`), and `?quality=` on the URL. A visual-only effect,
    but nothing in the scene says so. Wanted: `world.effects.adaptive` (default true) so a recording can pin it.

## C. Default look baked into the renderer
14. **Agents are colored by heading unless told otherwise** (`view/src/layers.ts:122`, a 0.35+0.65 ramp over the direction), and
    creature parts without a color take a golden-ratio hue by index (`rigid-view.ts:124`). Wanted: a named `colorBy` default
    (`"heading" | "index" | "none"`) in the scene so the default is a visible setting.
15. **Default shapes and sizes**: cell color `#4f86f7`, node color `#4dff88`, lattice `spacing` 1.2, selection highlight white at 1.8x,
    network default `layout: force` and `radius: 20`, think `every: 60`, bounds `size: 30`. All are settable except the selection
    highlight; the defaults should be listed in `docs/script-api.md` in one table.
16. **Water, markers, floor** are scene-driven now; the water plane is 2000 units wide and fixed at opacity 0.45 unless set.

## D. Limits that protect the machine (keep, but say so and let the scene raise them)
17. `MAX_CPU_CELLS` 8,388,608 (the error already says so), GPU picture side `MAX_SIDE` 1024 (`gpu-lattice-world.ts:26`),
    `FRAME_BUDGET_MS` 12 in the worker (`sim.worker.ts:323`), `MAX_GRID_AXIS` 32 for the neighbor grid. These are performance knobs
    and not behavior, but the picture side changes what you see; wanted: `lattice.view.maxSide`.

## E. Looks fine
Agent integration limits (`motion.maxSpeed`, `minSpeed`, `maxAccel`, `plane`) are all scene settings; world bounds are the script's
job (stdlib `Bounds`); joint limits and motors are in the body; gravity, substeps, collisions and engine are in `physics`.

## Proposed order
A1, A2, A4, A5 first (they change results or lose data silently), then A3, A6, B9, B11, B12, then the rest. Each is a small scene
field plus a schema test and a line in `docs/script-api.md`. A1, A2 and A6 change defaults' meaning, so they keep today's numbers as
the defaults and print them in the docs, so no existing scene changes behavior.
