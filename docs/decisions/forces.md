# Forces from scripts, and water

## Context
We wanted water creatures. The physics engines have gravity and contacts but no fluid, and the rule is that the engine provides mechanisms and behaviors live in scripts or the standard library.

## Options
1. Build water into the physics adapter (a `medium` setting on the world).
2. Give scripts a general way to push parts, and write water as a stdlib function.

## Decision
Option 2. A creature's `act` may return `forces: { part: { force, torque } }`, applied at the part's center of mass before the substeps and lasting one tick (`Articulation.applyForces`; Rapier and MuJoCo both implement it). A new `parts` sensor gives every part's pose, velocity, shape, size and mass (`Articulation.readVelocities`). The stdlib `Fluid` turns those into buoyancy (by how much of a part is under a level) and anisotropic quadratic drag with a cap so one tick cannot reverse a part. Wind, thrust or magnets use the same door.

`world.water` (and `world.markers`) are drawn only. Either may be a string naming a `data` key, so the script and the picture read one source (and dragging a pole or the surface edits one place); the scene check says which keys exist if a name is wrong.

## Consequences
- Forces are part of the sim state's inputs, so determinism and fork work as for joint targets (the pushes are recomputed from state each tick, and the last pushes are not stored beyond it).
- Drag is explicit-integration: the cap keeps it stable, at the cost of understating very fast motion.
- No waves, added mass or surface tension; buoyancy acts at the center unless `buoyancyHeight` lifts it.
- MuJoCo velocities come from `cvel` (the binding's `mj_objectVelocity` does not fill its output array).

## Dragging
Pressing on an entity or a marker in the workbench starts a drag over a horizontal plane through the point grabbed; the orbit controls stand down for that press (they look at `controls.enabled` when they receive it) and a press that does not move is still a click. A marker drag rewrites its `at` in the scene text (in `data` when `world.markers` names a key, so the script follows live: scene changes reach the running sim without a reset) at most once a frame. An entity drag is a worker message `move` to `Sim.moveEntity` (`World.moveTo`): free agents get a new position; a creature is stood up again at the spot facing the same way, like a script's `place`, so its joints start over. Lattice cells and network nodes cannot be moved.


## Added mass
The water a part must accelerate with it is modeled in `Fluid`, from the textbook values (sphere: half the displaced fluid; flat plate face-on: `pi/4 * density * short^2 * long`, reduced for thickness; cylinder across the flow: what it displaces), along each of the part's own axes. Done explicitly it would be unstable for a light fin in heavy water (added mass over the part's own), so it works from what the part actually did last tick: everything else that acted on it was `m * a - added`, the water's share of that same push is `added / (m + added)`, and the correction is minus that share of it, per axis. That is stable however heavy the water, and a test checks it gives exactly `m / (m + added)` of the speed. The creature's world keeps the past it needs (each part's velocity one tick ago and the `added` force the script returned then, as part of the world's snapshot so forks and replays are exact) and gives it back as `previous` on each part of `self.parts`, so `Fluid` stays stateless and the script keeps nothing. (A stateful `Fluid` object made in `init` would have kept that state outside the snapshot.) Added mass is for moving, not turning. It roughly tripled the swimmers' speed with no change to any coefficient.
