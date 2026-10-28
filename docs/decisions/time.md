# Time: one clock, a pace, and a frame rate

## Context
The engine counted "ticks" and ran them at `clock.rate` per second, with a fixed physical step of 1/60 s hidden inside the engine. A tick meant
a sixtieth of a second for creatures and nothing in particular for Life, so "20 ticks a second" said little, a physical timestep could not be
chosen, and the default (60 a second) was a throttle nobody asked for.

## Decision
- **`time.step`** is how much simulated time `T` one step advances. `T` may be continuous (0.025 s) or discrete (1 generation). It is the
  only setting that changes what is simulated; the integrators, the physics step and `ctx.dt` all read it. Default 1/60.
- **`time.pace`** is simulated time per real second to try to run (a number, or `"max"`, the default). `{ step: 0.025, pace: 10 }` is 400
  steps a second; with `step: 1` the pace is just generations a second.
- **`time.fps`** caps how often the picture is updated (default 60). Each frame runs the steps the pace calls for, within what is left of
  the frame, so frames are never dropped; a machine that cannot keep up advances less and the page shows the achieved pace.
- **`time.unit`** names `T` for labels.
- Scripts read `ctx.time`, `ctx.dt` and `ctx.tick` (the step number, which `every` and `think.every` count).
- The viewer's speed is a multiple of the scene's pace (of one unit of `T` a second when the scene has none) or Max; it is not part of the scene.
- The defaults live in the stdlib (`Defaults.time`), the pacing in core (`stepsPerSecond`, `Pacer`) so the workbench and the embed share it.
- No backwards compatibility: `clock.rate` is gone; every example states its time.

## Consequences
- Physical demos say `pace: 1` (real time); abstract demos say `step: 1` and a pace taken from the old tick rate (`unit` names what a step is).
- A scene with no `pace` runs flat out, which is right for experiments and for anything not meant to be watched.
- The achieved pace, not the requested one, is what the stats line shows.
