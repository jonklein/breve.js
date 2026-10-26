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
| `act` (was `decide`) | `actAll` (was `decideAll`, before that `update`) | `actAll` for lattices and networks; the old names stay as aliases. Free agents: not yet |
| `think` | `thinkAll` | done (batched model calls) |
| `init` | `initAll` | `init` for free agents; lattices and networks next; `initAll` after |
| `display` | `displayAll` | planned (SPEC.md section on display) |

**Consequences.** One rule to learn and to put in the docs and the assistant's prompt. `update` is deprecated but kept so existing scripts keep running. A "this set is big, use `xAll`" hint can be given by the workbench for any hook.
