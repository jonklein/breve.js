# One naming rule: `x` per entity, `xAll` for the whole set

The hooks are `init`, `act`, `think` and `display`. `act` was `decide`; the old name still works. It was renamed because "decide" sounds like the deliberate step while it is the every-tick reflex, and `think` is the slow one. `act` returns steering and state changes; `think` is the slow, asynchronous rule whose results feed `act` (the plan is for `think` to return state updates, like `act`, instead of a hidden `self.decision`). Labels for how slow answers land: `async` (the sim keeps running) and `wait` (each tick waits), instead of "realtime" and "lockstep".

**Context.** A controller has several hooks, and two of them already come in two forms that were named differently: `act` (per entity) and `update` (a whole lattice or network at once), and `think` (per entity) and `thinkAll` (a whole set at once, for batched model calls). Two more hooks were planned, `init` and `display`, and would have needed the same split. Free agents had no whole-set form at all.

**Decision.** Every hook has a per-entity form `x(...)` and may have a whole-set form `xAll(...)`.
- `x` is the readable form: it gets one entity (`self`, `neighbors`) and returns that entity's result. It costs about 3 microseconds an entity, so it suits up to tens of thousands of entities.
- `xAll` is the optimized form: it gets the whole set as fields (columns) and returns whole fields. It has **limits** in exchange for speed: only single-number state (no text or arrays), only whole-field arithmetic (`Field` operations such as `neighborSum`, `eq`, `where`; `map` and `zip` run a function per cell and give up the speed), and no per-entity effects (steering, trades, spawning, resets). Those limits are what make it a fixed graph of array operations, so the same rule could later run on a GPU. `Field` arithmetic is already lazy (a graph evaluated in blocks); only `map` and `zip` are opaque to a GPU.
- A script gives one form or the other for a hook. If both exist, `xAll` wins.
- Same timing rule in both: every entity reads the old state and the new state lands at the end of the tick.

| per entity | whole set | status |
|---|---|---|
| `init` | `initAll` | done for lattices, networks and free agents (`initAll` for lattices and networks) |
| `act` (was `decide`) | `actAll` (was `decideAll`, before that `update`) | `actAll` for lattices and networks; the old names stay as aliases. Free agents: not yet |
| `think` | `thinkAll` | done (batched model calls); returns state |
| `display` | `displayAll` | done for lattice cells, network nodes and free agents (`displayAll`: lattices and networks); `visible` only on lattice cells |

## State comes from `init`

A set's state is the fields its `init` returns, with kind and length taken from the value (number, boolean, text, array of numbers). The scene needs no `state` block and no type words. To find the fields before the columns exist, the sim calls `init` (or `initAll` with a count of 1) once on a throwaway random generator, so the run's own random numbers are untouched. An explicit `state` in the scene still works and wins; it is also the way to ask for a small number type (`"u8"`) on a very large grid, where eight bytes a cell would cost memory. If a script edit changes which fields `init` returns, the workbench restarts the sim. Rejected: running `act` once to learn the output shape, because `act` reads `self.alive` before it has ever returned anything, and a `0` cannot be told from `false`.

`think` follows the same idea: it returns state. An object whose keys are all state fields is written to them (logged and replayed as before); any other result is kept as `self.decision`, the older way.

## Configuration and code

The scene is the setup and the knobs (what sets exist, how many, the world, `params`, metrics, models). The script is what each thing is (`init`), does (`act`, `think`) and looks like (`display`). Test: if a person would tweak it while it runs, sweep it or search over it, it is configuration (usually a `param`); if it changes what an entity is or does, it is code. The old scene fields `state`, `fill`, `lattice.show/color/colorMax/palette` and `network.color/colorMax/palette` still work for scripts that give no `init` or `display`.

**Consequences.** One rule to learn and to put in the docs and the assistant's prompt. `update` is deprecated but kept so existing scripts keep running. A "this set is big, use `xAll`" hint can be given by the workbench for any hook.
