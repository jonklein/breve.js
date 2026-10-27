# The engine provides mechanisms; behavior lives in scripts and the stdlib

Status: decided. Date: 2026-10-26.

## Context

Over time the core had picked up behaviors nobody asked for: a "fell over" detector (`down`, `downFor`), a world fence with an `onLeave` hook and an automatic reset to a random start, a distance counter (`travelled`), and a built-in oscillator (`drive` on joints, `self.gait`) that swung legs without any script. I then used one of them (respawn) to justify a physics-adapter design choice as if it were a requirement. The project's goal is the opposite: simulations are driven by simulation code, and the engine stays small and free of hardcoded behavior.

## Decision

The core provides mechanisms only: bodies, joints, motors that chase a target, contacts, positions, state columns, a way to move an entity. Anything that decides what an entity should do or notices a condition is a script, or a helper the script calls from the stdlib.

Removed from the core (no aliases; the parser says where each one went):
- Creatures: `drive` on joints, the entity's `oscillator`, `self.gait`, `self.down`, `self.downFor`, `self.travelled`, `self.outside`, `self.reset()`, the `fence` and the `onLeave` hook. The body's default `motor` now fills in any joint that says `"motor": {}`.
- Agents: `fence`, `onLeave`, `self.outside`, `self.reset()`, and the world's soft and clamped bounds (`bounds.mode`). `bounds.size` stays as the drawn box and as `ctx.world.size`; keeping entities inside is the script's job with the stdlib's `Bounds` (`ctx.bounds.soft`, `ctx.bounds.bounce`).

Added as mechanisms:
- `place`, returned from `act` (like `steer` and `state`; a value, not a call), for creatures (`{ x, z, yaw }`, stands a fresh body on the ground there) and agents (`{ position, velocity }`); state is kept, the move happens at the end of the tick. Where to and why is the script's call.
- State for creatures: `init` returns it, `act` may return `state`, `self.name` reads it, and it shows up in `creatures` groups for metrics. Shared with agents through `state-columns.ts`.

Added to the stdlib: `Gait` (`wave`, `targets`, `advance`), reached as `ctx.gait`. The creature examples keep their step cycle, flipped-over timer and distance walked in their own state.

## Consequences

- The creature examples now read as the whole story: the script swings the legs, steers, stands a fallen creature up and counts distance. More code in the example, none hidden in the engine.
- Behavior changes slightly: a respawn picks its spot from the script's seeded random, not the engine's, and "down" is judged from `self.up.y` (and height where a script wants it), since the engine no longer reads the terrain for it.
- The agent examples that relied on the old soft or clamped bounds (boids, neural, ants, herding, llm-wanderers, vlm-scouts, onnx-policy, remote-policy) now ask for them in their scripts. Wall handling now happens inside the entity's own step (soft pushes join the steering, bounces take effect at the end of the tick), so trajectories differ slightly from before.
- Possible next layer: ready-made controllers in the stdlib that scripts extend (a walker, a flocker) built from these helpers.
