# Scene and script reference

A project is two files: `scene.json` (data: what exists and how it looks) and one script (behavior: how things decide what to do). The workbench shows both, runs them live, and hot-reloads edits. This file is also what the LLM assistant is given, so keep it accurate.

## scene.json

```jsonc
{
  "name": "boids",
  "seed": 7,                              // required. Same seed + same scene = same run.
  "clock": { "rate": 60 },                // optional. Ticks per second (default 60, max 240).
  "bounds": { "size": 30, "mode": "soft" },   // free agents only. Half-width of the cube. mode: "soft" | "clamp"
  "world": {                              // optional, visual only
    "sky": { "top": "#0b1226", "horizon": "#2a4a7a" },   // or one color: "sky": "#112233"
    "grid": true,
    "boundsColor": "#3a4658",
    "agentColor": "heading",              // "heading" colors by direction, or one hex color
    "shadows": true                       // cast shadows (default: on for physics scenes with terrain, off otherwise)
  },
  "terrain": { "size": 80, "resolution": 64, "amplitude": 0.6, "frequency": 0.07 },   // creatures only: bumpy ground, see "Entity set: creatures"
  "physics": { "gravity": 9.81, "substeps": 4 },   // creatures only, optional
  "params": {                             // required. Each object-form param gets a slider.
    "cohesion": { "value": 0.8, "min": 0, "max": 3, "step": 0.05, "label": "optional label" },
    "count": 300                          // a bare number is allowed (no slider range given)
  },
  "entities": [ /* exactly one entity set for now */ ],
  "metrics": ["polarization"]             // names of functions exported as `metrics` by the script
}
```

Colors are hex only: `#rgb` or `#rrggbb`. Anywhere a number is expected in an entity, you can write `"$name"` to use the param called `name`, so sliders drive the simulation live.

### Entity set: free agents

```jsonc
{
  "name": "boid",
  "count": "$count",                      // number of agents (max 5000)
  "controller": "flock.js",               // the script's file name (display only)
  "sensors": [{ "type": "neighbors", "radius": "$radius" }],
  "motion": { "maxSpeed": "$maxSpeed", "minSpeed": "$minSpeed", "maxAccel": 30 }
}
```

Agents live in continuous 3D space. Each tick every agent's `decide` is called and returns a steering acceleration; the engine integrates it, enforces the speed limits, and applies the bounds.

### Entity set: lattice of cells

```jsonc
{
  "name": "cell",
  "lattice": {
    "size": [20, 20, 20],                 // integers, each 1..128
    "spacing": 1.2,                       // distance between cell centers
    "edges": "wrap",                      // "wrap" (opposite edges touch) or "dead" (nothing beyond the edge)
    "neighborhood": "moore",              // "moore" (26 neighbors) or "von-neumann" (6)
    "show": "alive",                      // state field whose non-zero cells are drawn
    "color": "age",                       // optional state field that tints cells
    "colorMax": 20,                       // value that maps to the end of the color range (low = red, high = green)
    "fade": 0                             // optional: ease cells in and out over this fraction of a tick (0 = instant, 1 = a whole tick)
  },
  "state": { "alive": "u8", "age": "u8" },   // per-cell fields. Types: "u8" (0..255), "i32", "f32"
  "fill": { "field": "alive", "density": "$density", "within": 1 },  // random start: density of cells, within the central fraction (default 1 = everywhere)
  "controller": "life.js"
}
```

Grid shape, fill, and seed only take effect when the simulation is reset. Params (rule numbers, etc.) apply live.

### Entity set: creatures (physics bodies)

Articulated bodies simulated by a physics engine (Rapier) and walking on bumpy terrain. A **body** is data, not code: rigid parts joined by joints with motors. Use `count` (not `lattice`) plus `body`. Creatures collide with the terrain and, by default, with each other (`physics.collide: false` lets them walk through one another); a creature never collides with its own parts.

```jsonc
{
  "terrain": {                            // optional. Perlin-noise hills made from the scene seed. Every field has a default.
    "size": 60,                           // edge length of the square ground, centered on the origin (default 60)
    "resolution": 48,                     // cells per side, 2..256 (default 48)
    "amplitude": 1,                       // height of the hills in world units, keep it small (default 1)
    "frequency": 0.07,                    // hills per world unit: 0.07 is one hill every ~14 units (default 0.07)
    "octaves": 3,                         // layers of finer detail, 1..6 (default 3)
    "color": "#4f7a46",                   // visual only
    "texture": "static"                   // visual only: "static" (fine speckle, the default), "grid" (a one-unit grid with heavier lines every five, handy for judging speed) or "none"
  },
  "physics": {                            // optional
    "gravity": 9.81,
    "substeps": 4,                        // physics steps per tick: more is steadier but slower
    "collide": true,                      // creatures bump into each other (default true)
    "respawn": { "after": 3, "fallBelow": 20 }   // put a creature back on its feet after lying flipped or collapsed for 3 s, or once it is 20 units under the world. false turns this off
  },
  "entities": [{
    "name": "walker",
    "count": "$count",                    // number of creatures (max 200)
    "controller": "creature.js",
    "oscillator": { "frequency": "$frequency" },   // the built-in rhythm generator, in cycles per second
    "body": {
      "motor": { "stiffness": "$strength", "damping": 8 },   // default motor for every joint that has a drive
      "parts": [                          // the FIRST part is the root (torso). Other parts can be listed here too.
        { "name": "torso", "shape": "box", "size": [0.9, 0.25, 0.45], "mass": 4, "position": [0, 0.62, 0] }
      ],
      "templates": {                      // a reusable piece, written once in its own coordinates (0,0,0 = where it attaches)
        "leg": {
          "args": { "phase": 0 },         // "@phase" below is filled in by each attach
          "parts": [
            { "name": "upper", "shape": "capsule", "size": [0.25, 0.06], "mass": 0.4, "position": [0, -0.125, 0] },
            { "name": "lower", "shape": "capsule", "size": [0.25, 0.05], "mass": 0.3, "position": [0, -0.375, 0] }
          ],
          "joints": [                     // parent "^" means the part this copy is attached to
            { "name": "hip", "parent": "^", "child": "upper", "anchor": [0, 0, 0], "limits": [-0.9, 0.9],
              "drive": { "amplitude": "$stride", "phase": "@phase" } },
            { "name": "knee", "parent": "upper", "child": "lower", "anchor": [0, -0.25, 0], "limits": [-1.6, 0.1],
              "drive": { "amplitude": "$lift", "offset": -0.9, "phase": "@phase", "lag": "$kneeLag" } }
          ]
        }
      },
      "attach": [                         // four legs: the same template in four places
        { "template": "leg", "name": "FL", "at": [0.32, -0.07, -0.27], "args": { "phase": 0 } },
        { "template": "leg", "name": "FR", "at": [0.32, -0.07, 0.27], "args": { "phase": "$diagonal" } },
        { "template": "leg", "name": "HL", "at": [-0.32, -0.07, -0.27], "args": { "phase": "$diagonal" } },
        { "template": "leg", "name": "HR", "at": [-0.32, -0.07, 0.27], "args": { "phase": "$hindOffset" } }
      ],
      "sensors": [{ "type": "pose" }, { "type": "joints" }, { "type": "touch" }]
    }
  }]
}
```

- **Templates:** a template is a small body (parts and joints) in its own coordinates, where `[0, 0, 0]` is the attach point. Each `attach` makes a copy: `name` prefixes every part and joint of the copy (`FL` gives parts `FL.upper`, `FL.lower` and joints `FL.hip`, `FL.knee`, which are the names scripts and sensors use), `at` is the attach point relative to the center of the part it hangs from (`to`, default the root part), `yaw` turns the copy about the vertical axis (radians), and `args` fill the template's `"@name"` placeholders (a template's own `args` are the defaults). A joint whose `parent` is `"^"` hangs off the part the copy is attached to. Adding a leg, a tail or an arm is one more `attach` line, and you can still write parts and joints by hand next to templates, or use no templates at all.
- **Default motor:** a joint that has a `drive` but no `motor` gets the body's `motor`, so legs don't each repeat it. A joint can still give its own.
- **Coordinates:** x is forward, y is up, z is the creature's right side. Part `position` and joint `anchor` are in the standing pose, relative to the creature's origin: the ground is y = 0, so feet should end at y = 0. The creature is placed on the terrain and turned to a random heading.
- **Parts:** `shape` is `box` (`size` = `[width, height, depth]`), `sphere` (`[radius]`), `capsule` or `cylinder` (`[length, radius]`, long axis along y; for a capsule `length` is the straight section). `mass` is in kilograms. Optional `color` (hex) and `friction` (default 1). Without a `color`, each creature gets its own hue.
- **Joints:** `parent` and `child` name parts. Parts must form a tree under the first part (every other part is the `child` of exactly one joint). `type` is `hinge` (default; turns around `axis`, default `[0, 0, 1]`), `ball` (turns freely) or `fixed`. Only hinges have `limits` (radians, `[min, max]`), `motor` and `drive`. Angle 0 is the standing pose; a positive hinge angle turns the child around the axis by the right-hand rule (about `[0, 0, 1]`, a positive angle swings a hanging leg forward).
- **Motor:** makes the hinge chase a target angle like a spring with damping: `stiffness` is torque per radian, `damping` torque per radian per second (defaults 100 and 8). Both may be `"$param"`. Too weak and the creature collapses; too strong and it gets jittery.
- **Oscillator drive:** a joint with a `drive` follows `offset + amplitude * sin(2 pi * (t * frequency + phase - lag))`. `amplitude` and `offset` are radians (offset default 0); `phase` and `lag` are fractions of a cycle (0.5 = half a cycle). Each may be a number or a `"$param"`, so every phase gets a slider. `frequency` comes from the entity's `oscillator`. Without a `drive` the motor holds angle 0, unless the script sets it. A trot is: diagonal legs in phase (front-left with hind-right) and the other diagonal half a cycle later, with each knee trailing its hip by a fraction of a cycle (`lag`, about 0.4 in the example; the gait is sensitive to it).
- **Sensors:** declare what `decide` can read. `pose` (always available), `joints` (`self.joints`: hinge angles by joint name), `touch` (`self.touch`: which parts touch the ground by name; default the parts nothing hangs off, or give `"parts": ["FL.lower"]`). Each joint with a `motor` is an actuator.
- Edits to the terrain, physics block, seed, or the body's parts and joints respawn the creatures. `count`, params, motor gains, drives and the script apply live. Unless `physics.respawn` says otherwise, a creature that stays flipped over or flat for 3 seconds, or falls off the terrain, is put back on its feet at a random spot.
- Validation rejects unknown joint or part names, parts not connected to the root, duplicate names, sizes that do not fit the shape, a template or placeholder that does not exist, and unknown `"$param"` names.

## Scripts

A script is an ES module with **no imports**. It must `export default` an object with a `decide` function, and may `export const metrics`.

```js
export default {
  decide({ self, neighbors }, p, ctx) { /* ... */ },
}

export const metrics = {
  population: ({ cells }) => cells.alive.sum(),   // or ({ agents }) => ... for free agents
}
```

- `p` holds the current param values: `p.cohesion`.
- `ctx.random()` is a seeded random number in [0, 1). **Never use `Math.random()` or `Date.now()`**: runs must be repeatable.
- `ctx.tick` is the tick number, `ctx.dt` the time step (1/60), `ctx.vec(x, y, z)` makes a vector.
- `decide` must not change anything. It reads the world and returns what it wants.
- If `decide` throws, the error is shown and the sim keeps running with the last good behavior for that tick.

### Free agents

`decide` receives `self` (the agent) and `neighbors` (a group of nearby agents). It returns `{ steer: vector }`, where the vector is a `Vec3` or `[x, y, z]`.

`self` has `x, y, z`, `vx, vy, vz`, and `position`, `velocity` as vectors.

### Cells

`decide` receives `self` (the cell) and `neighbors` (a group of its neighbor cells). It returns the cell's **new state** as an object with some or all of the state fields, for example `{ alive: 1, age: self.age + 1 }`. Fields you leave out keep their value. Every cell reads the old state and all new states are applied together at the end of the tick. Assigning to `self.alive` inside `decide` throws.

`self` has `x, y, z` (grid coordinates), `position` (a vector), and every state field as a number: `self.alive`.

**Big grids: `update` instead of `decide`.** A script may export `update(fields, params)` instead. It runs once per tick, gets every state field as a whole (`{ alive, age }`) and returns the new fields. Fields have `neighborSum()`, `neighborMax()`, `map(fn)`, `zip(other, fn)`, `sum()` and `average()`; each makes a new field and none changes the original. Use it for grids above about 50,000 cells (a 1000×1000 flat grid works). A lattice with a dimension of 1, like `[200, 200, 1]`, is flat and its cells have no neighbors along that axis.

```js
export default {
  update({ alive }) {
    const crowd = alive.neighborSum()           // live neighbors of every cell
    return { alive: alive.zip(crowd, (a, n) => (a ? n === 2 || n === 3 : n === 3) ? 1 : 0) }
  },
}
```

### Creatures

`decide` receives `self` (the creature) and `neighbors` (always an empty group for now). By default it can return nothing and the oscillator drives the legs. It may return `{ joints: { 'FL.hip': 0.3, ... } }`: target angles in radians by joint name, which replace the oscillator for those joints only (targets are clamped to the joint's `limits`; an unknown name is an error).

`self` has `x, y, z`, `vx, vy, vz`, `position`, `velocity` (vectors), `speed` (horizontal), `travelled` (horizontal distance walked), `forward` (vector the torso faces), `yaw` (heading in radians: 0 faces +x and it grows toward -z, a counter-clockwise turn seen from above), `row` (a stable index), `joints` and `touch` (if the body declares those sensors) and `gait`: what the oscillator wants every motorized joint to do right now, by name. Scale or mix `self.gait` to steer, e.g. longer strides on the right turn the creature left:

```js
const joints = {}
for (const [name, angle] of Object.entries(self.gait)) {
  if (name.endsWith('.hip')) joints[name] = angle * (1 + 0.5 * (name.split('.')[0].endsWith('R') ? turn : -turn))
}
return { joints }
```

A turn factor above about 0.5 makes the example creature fall over. Creature groups in metrics (`creatures`) answer `.position`, `.velocity` (vector lists), `.speed`, `.travelled` (number lists) and `.isEmpty()`.

## Groups: ask a whole group at once

`neighbors` (and `agents` / `cells` in metrics) is a **group**. It is an array, so `length`, `map`, `filter`, `for...of` all work, and it also answers questions as a whole so scripts rarely need loops.

**Free agent groups:** `.position`, `.velocity` (vector lists); `.offset` (vectors from the looking agent to each member, so `.offset.average()` points toward the middle of the group); `.distance` (numbers); `.within(r)` (members closer than r, itself a group); `.nearest()` (one member or null); `.isEmpty()`.

**Cell groups:** one property per state field giving a number list (`neighbors.alive`, `neighbors.age`); `.position`; `.isEmpty()`.

**Number lists** (`Nums`): `.sum()`, `.average()`, `.min()`, `.max()`, `.isEmpty()`. Empty lists give 0.

**Vector lists** (`Vecs`): `.sum()`, `.average()` (both the zero vector when empty), `.plus(v)`, `.minus(v)`, `.times(k)`, `.dividedBy(k)`, `.reversed()`, `.normalized()`, `.limit(max)`, `.lengths()`, `.isEmpty()`. Element-wise operations return a new list, so they chain: `neighbors.velocity.minus(self.velocity).average()`. `.map(fn)` over a vector list returns a vector list, so `.sum()` still works after it.

## Vectors

`Vec3` is immutable; every method returns a new vector so calls chain. `x, y, z`, `plus(v)`, `minus(v)`, `times(k)`, `dividedBy(k)`, `reversed()`, `length()`, `lengthSquared()`, `normalized()` (zero stays zero), `limit(max)`, `dot(v)`, `cross(v)`, `distanceTo(v)`. Arguments that are vectors may also be `[x, y, z]` arrays.

## Metrics

Names listed in the scene's `"metrics"` must exist in the script's exported `metrics` object. Each is a function of `{ agents }`, `{ cells }` or `{ creatures }` that returns one number. They are drawn as live charts.

## Examples

Four complete examples live in `examples/` (a fifth, `life2d`, shows the whole-grid `update` rule): `boids` (free agents, three steering rules in about ten lines), `life3d` (a lattice with Life-style rules) and `creature` (four-legged physics walkers on bumpy terrain: the body is JSON in scene.json, the legs are driven by the oscillator, and the script only steers). They are the best guide to the expected style: short, named steps, comments that explain the idea.
