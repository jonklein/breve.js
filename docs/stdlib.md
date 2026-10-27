# Standard library

Everything here is available to scripts without importing anything. It lives in its own package
(`packages/stdlib`), apart from the simulation engine, and this page is generated from its source comments.

Scripts reach it through the values they are given: `self` and `neighbors` in `act`, `ctx` for helpers
(`ctx.vec(x, y, z)`, `ctx.mlp([...])`), and the field arguments of a lattice `update`.
For the scene format and the script contract, see the Scene and script reference.

## Positioned

Anything with a place and a heading: what a group of agents needs to answer questions about itself.

### `Positioned.position`

```ts
readonly position: Vec3
```

### `Positioned.velocity`

```ts
readonly velocity: Vec3
```

## AgentView

What a script sees of one free agent (`self`, and each member of `neighbors`). Every agent has a position
and a velocity without declaring anything; any extra `state` fields from the scene appear as properties too.

### `AgentView.position`

```ts
readonly position: Vec3
```

Where the agent is, as a vector.

### `AgentView.velocity`

```ts
readonly velocity: Vec3
```

Where it is heading and how fast, as a vector.

### `AgentView.x`

```ts
readonly x: number
```

The x coordinate of the position.

### `AgentView.y`

```ts
readonly y: number
```

The y coordinate (up).

### `AgentView.z`

```ts
readonly z: number
```

The z coordinate.

### `AgentView.vx`

```ts
readonly vx: number
```

The x part of the velocity.

### `AgentView.vy`

```ts
readonly vy: number
```

The y part of the velocity.

### `AgentView.vz`

```ts
readonly vz: number
```

The z part of the velocity.

### `AgentView.patch`

```ts
readonly patch: unknown | null
```

The cell of the first lattice layer under the agent, or null outside the grid.

### `AgentView.patchAt`

```ts
patchAt(offset: Vec3 | readonly [number, number, number]): unknown | null
```

The cell at an offset (a vector) from the agent, or null off the grid: `self.patchAt(heading.times(3))`.

## Agents

A group of agents that can be asked questions all at once:
`neighbors.velocity` is a list of every neighbor's velocity.
A group made by a sensor remembers who is looking (`origin`), so `offset` and `within` are relative to them.

### `Agents.origin`

```ts
origin: Positioned | null
```

### `Agents.position`

```ts
get position(): Vecs
```

Everyone's position.

### `Agents.velocity`

```ts
get velocity(): Vecs
```

Everyone's velocity.

### `Agents.offset`

```ts
get offset(): Vecs
```

For each agent, the vector from the one looking at them to them.

### `Agents.distance`

```ts
get distance(): number[]
```

For each agent, how far away they are from the one looking.

### `Agents.within`

```ts
within(radius: number): Agents<A>
```

Only the agents closer than `radius`.

### `Agents.nearest`

```ts
nearest(): A | null
```

The closest agent, or null if the group is empty.

### `Agents.isEmpty`

```ts
isEmpty(): boolean
```

## Bounds

Keeping entities inside a box, for scripts that want it. The engine does not: an entity with no edge handling flies on forever.
`ctx.world.size` is the scene's `bounds.size`, the half-width of the box around the origin.

### `Bounds.soft`

```ts
static soft(position: VecLike, size: number, options:
```

A gentle push back toward the middle, as an acceleration to add to the steering. It is zero inside the box except for the outer
`margin` (a share of the half-width, default 0.15) and grows with how far past that line an entity is, on each axis:
`steer: yourSteering.plus(ctx.bounds.soft(self.position, ctx.world.size))`. `strength` is per second (default 4); `flat` leaves
the vertical axis alone, for entities that live on the ground plane.

### `Bounds.bounce`

```ts
static bounce(position: VecLike, velocity: VecLike, size: number):
```

Where to put an entity that has gone past a wall, and the velocity it leaves with, bouncing off each wall it crossed; `null` while it
is inside. Return the result as `place`: `const hit = ctx.bounds.bounce(self.position, self.velocity, ctx.world.size)`, then `return { steer, place: hit }` (`null`, while inside, does nothing).

## Rgb

A color as red, green and blue between 0 and 1.

## Colors

Colors for `display`: a number turned into a color, or a whole field of numbers into a color per cell.

### `Colors.hex`

```ts
static hex(c: string): Rgb
```

`'#4f86f7'` or `'#48f'` as red, green and blue between 0 and 1. Anything else is white.

### `Colors.hsl`

```ts
static hsl(h: number, s: number, l: number): Rgb
```

Hue, saturation and lightness, each between 0 and 1 (hue goes around the color wheel).

### `Colors.gradient`

```ts
static gradient(stops: string[], t: number): Rgb
```

Where `t` (0 to 1) falls along a list of colors, blending between neighbors: `Colors.gradient(['#4f86f7', '#7be495'], age / 20)`.

### `Colors.gradientField`

```ts
static gradientField(stops: string[], t: Field | ArrayLike<number>):
```

`gradient` for a whole field at once: a color for every cell, for `displayAll`.

## NeighborTable

For each cell, the rows of its neighbors: `count[row]` of them, starting at `start[row]` in `nbr` (a network, where degrees
differ), or at `row * stride` when there is no `start` (a lattice, where every cell has room for the same number).

### `NeighborTable.nbr`

```ts
nbr: Int32Array
```

### `NeighborTable.count`

```ts
count: Uint8Array | Uint16Array | Int32Array
```

### `NeighborTable.stride`

```ts
stride: number
```

### `NeighborTable.start`

```ts
start?: Int32Array
```

## Field

One state field of a whole lattice, as a single value: `alive.neighborSum()` is the number of live
neighbors of every cell at once. Fields are immutable; every operation makes a new one. This is the
fast way to write a lattice rule: no loop over cells in the script, and no object per cell.

Arithmetic (`add`, `eq`, `and`, `where`, `map`, `zip`, ...) is lazy: it records what to compute, and the values are worked out
in one pass over small blocks the first time they are needed (by `data`, `sum`, a neighbor operation, or the engine storing
the result). A chain like `crowd.eq(3).or(alive.and(crowd.eq(2)))` therefore reads and writes memory once, not once per step.

### `Field._values`

```ts
_values: Data | null
```

@internal the computed values, once there are any

### `Field._expr`

```ts
_expr: Node | null
```

@internal what to compute, until then

### `Field.length`

```ts
readonly length: number
```

### `Field.data`

```ts
get data(): Data
```

The values, one per cell. The first call on a pending field computes them (all at once, in blocks).

### `Field.neighborSum`

```ts
neighborSum(): Field
```

For each cell, the total of this field over its neighbors.

### `Field.neighborCount`

```ts
neighborCount(): Field
```

For each cell, how many neighbors it has.

### `Field.neighborAverage`

```ts
neighborAverage(): Field
```

For each cell, the average of its neighbors (0 for a cell with none).

### `Field.neighborMax`

```ts
neighborMax(): Field
```

For each cell, the biggest value among its neighbors.

### `Field.add`

```ts
add(o: number | Field): Field
```

Arithmetic on whole fields, with no function call per cell. Each takes a number or another field of the same size and
makes a new field: `crowd.eq(3)`, `alive.mul(2).add(crowd)`. Comparisons give 1 where true and 0 where not, so they
combine with `and`, `or`, `not` and `where`.

### `Field.sub`

```ts
sub(o: number | Field): Field
```

### `Field.mul`

```ts
mul(o: number | Field): Field
```

### `Field.div`

```ts
div(o: number | Field): Field
```

### `Field.min`

```ts
min(o: number | Field): Field
```

### `Field.max`

```ts
max(o: number | Field): Field
```

### `Field.eq`

```ts
eq(o: number | Field): Field
```

1 where this equals `o`, else 0.

### `Field.ne`

```ts
ne(o: number | Field): Field
```

### `Field.lt`

```ts
lt(o: number | Field): Field
```

### `Field.le`

```ts
le(o: number | Field): Field
```

### `Field.gt`

```ts
gt(o: number | Field): Field
```

### `Field.ge`

```ts
ge(o: number | Field): Field
```

### `Field.and`

```ts
and(o: number | Field): Field
```

1 where both are non-zero.

### `Field.or`

```ts
or(o: number | Field): Field
```

1 where either is non-zero.

### `Field.not`

```ts
not(): Field
```

1 where this is 0, else 0.

### `Field.where`

```ts
where(a: number | Field, b: number | Field): Field
```

`a` where this field is non-zero, `b` where it is zero: `crowd.eq(3).where(1, 0)`, `alive.where(age.add(1), 0)`.

### `Field.clamp`

```ts
clamp(lo: number, hi: number): Field
```

Every value held between `lo` and `hi`.

### `Field.map`

```ts
map(fn: (v: number, i: number) => number): Field
```

A new field with `fn(value, index)` applied to every cell.

### `Field.zip`

```ts
zip(other: Field, fn: (a: number, b: number, i: number) => number): Field
```

Combine two fields cell by cell: `alive.zip(crowd, (a, n) => ...)`.

### `Field.sum`

```ts
sum(): number
```

### `Field.average`

```ts
average(): number
```

## FluidPart

What `Fluid.forces` needs to know about a part: the fields of an entry of a creature's `self.parts`.

### `FluidPart.shape`

```ts
shape: string
```

`box`, `sphere`, `capsule` or `cylinder`.

### `FluidPart.size`

```ts
size: number[]
```

The shape's own measurements: box `[w, h, d]`, sphere `[r]`, capsule and cylinder `[length, r]`.

### `FluidPart.mass`

```ts
mass: number
```

Kilograms. Used only to keep drag from over-correcting in one step.

### `FluidPart.position`

```ts
position:
```

### `FluidPart.rotation`

```ts
rotation:
```

How the shape is turned in the world.

### `FluidPart.velocity`

```ts
velocity:
```

Linear velocity of the part's center, and its angular velocity, in the world frame.

### `FluidPart.angularVelocity`

```ts
angularVelocity:
```

## FluidMedium

The water and the air around a creature. Every field is optional.

### `FluidMedium.level`

```ts
level?: number
```

Height of the water surface (world y). Default 0. Use `-Infinity` for no water, `Infinity` for everything under it.

### `FluidMedium.density`

```ts
density?: number
```

Kilograms per cubic meter of water. Default 1000.

### `FluidMedium.airDensity`

```ts
airDensity?: number
```

Kilograms per cubic meter of the air above the surface. Default 1.2.

### `FluidMedium.gravity`

```ts
gravity?: number
```

Meters per second squared, the pull that buoyancy answers. Default 9.81, the engine's own.

### `FluidMedium.drag`

```ts
drag?: number
```

How strongly a shape resists moving through the fluid, as a multiplier on the default coefficient of 1. 0 turns drag off. Default 1.

### `FluidMedium.angularDrag`

```ts
angularDrag?: number
```

The same for spinning. Default 1.

### `FluidMedium.current`

```ts
current?: VecLike | ((p:
```

The velocity of the water itself (a current), as a vector or a function of position. Default still water. Air is taken to be still.

### `FluidMedium.buoyancyHeight`

```ts
buoyancyHeight?: number
```

Meters above a part's center, along the part's own up (local y), where its lift acts. A positive number makes a creature right itself like a boat with its weight low; 0 (the default) lifts at the center, so it never rights itself.

### `FluidMedium.dt`

```ts
dt?: number
```

Seconds per tick; drag is capped so a step can slow a part to rest but never reverse it. Default 1/60.

## FluidPush

The force and torque on one part, in the world frame, ready to return from `act` as `{ forces }`.

## Fluid

Buoyancy and drag for creatures in water and air. The engine has no fluid; this works out the push a fluid would give each
part, and a script returns it from `act` as `forces` (the push lasts one tick, so ask again every tick):
`return { joints, forces: Fluid.forces(self.parts, { level: 0 }) }`.

A part below `level` floats with a force of `density * gravity * volume`, scaled by how much of it is under (judged from its
height in the world, so a tilted box is handled); with a mass of `density * volume` it hangs in the water, lighter floats, denser sinks.
Moving through the fluid costs a force against the motion, quadratic in speed and different along each of the part's own axes
(a flat paddle pushed face-on resists far more than edge-on, which is what makes fins and tails swim). Fluid above the surface
is air with its own, thin, density. Simplified on purpose: no waves, no added mass, buoyancy acts at the center of the part.

### `Fluid.forces`

```ts
static forces(parts: Record<string, FluidPart>, medium: FluidMedium =
```

The push on every part, by part name: `{ torso: { force, torque }, tail: { ... } }`.

### `Fluid.push`

```ts
static push(p: FluidPart, medium: FluidMedium =
```

The push on one part.

## RunArgs

What a program is given for one run.

### `RunArgs.params`

```ts
params: Record<string, number>
```

### `RunArgs.tick`

```ts
tick: number
```

### `RunArgs.seed`

```ts
seed: number
```

The scene's seed, for `hash`.

## ImageRequest

### `ImageRequest.width`

```ts
width: number
```

### `ImageRequest.height`

```ts
height: number
```

### `ImageRequest.window`

```ts
window: [number, number, number, number]
```

Which part of the grid to draw: left, top, right and bottom edges in cells (the whole grid is `[0, 0, width, height]`).

### `ImageRequest.layer`

```ts
layer?: number
```

Which layer of a 3D lattice (default 0).

### `ImageRequest.background`

```ts
background?: [number, number, number]
```

The color of anything not visible or outside the grid, each 0 to 1.

## FormulaLattice

The state of one lattice, held by a backend.

### `FormulaLattice.cells`

```ts
readonly cells: number
```

### `FormulaLattice.check`

```ts
check(programs: Program[]): Promise<string[]>
```

Compile these programs now and say what is wrong with them (readable messages, or none). Nothing else needs to be called first.

### `FormulaLattice.init`

```ts
init(program: Program, run: RunArgs): void
```

Fill the state from a program that reads no state (`initFormula`).

### `FormulaLattice.step`

```ts
step(program: Program, run: RunArgs): void
```

One tick: every cell reads the old state, and the program's results become the new state.

### `FormulaLattice.upload`

```ts
upload(state: Record<string, ArrayLike<number>>): void
```

Replace the state (after a restore, or an edit from outside).

### `FormulaLattice.download`

```ts
download(): Promise<Record<string, Float32Array>>
```

The state, one value per cell for each field.

### `FormulaLattice.totals`

```ts
totals(program: Program, run: RunArgs): Promise<Record<string, number>>
```

The program's totals (`program.reduce`) over the current state.

### `FormulaLattice.image`

```ts
image(program: Program, request: ImageRequest, run: RunArgs): Promise<Uint8Array>
```

A picture of the state: the program's `visible`, `r`, `g`, `b` for the cell under each pixel. RGBA, 4 bytes a pixel, row by row from the top.

### `FormulaLattice.dispose`

```ts
dispose(): void
```

## FormulaBackend

### `FormulaBackend.name`

```ts
readonly name: string
```

### `FormulaBackend.lattice`

```ts
lattice(grid: Grid, fields: string[]): FormulaLattice
```

A lattice of this shape; `fields` is the order the state is kept in.

## WgslModule

### `WgslModule.code`

```ts
code: string
```

### `WgslModule.layout`

```ts
layout: string[]
```

The state, as ONE storage buffer of f32 holding every field in `layout`, one after another (field `i` starts at `i * cells`).
The shader reads buffer `src` (binding 1) and writes buffer `dst` (binding 2), which has the same layout: it computes the fields
the program returns and copies the others through, so after a step `dst` is the whole new state and the two buffers swap roles.
(One buffer each, because many fields as separate buffers run into the per-stage limit of 8 on most devices.)

### `WgslModule.cells`

```ts
cells: number
```

### `WgslModule.outputs`

```ts
outputs: string[]
```

The fields the program computes (the rest of `layout` is copied through).

### `WgslModule.uniform`

```ts
uniform:
```

The uniform buffer (binding 0): bytes 0-3 are the tick (u32), 4-7 the seed (u32), then at `paramsOffset` one f32 per parameter in the
order of `params`. `size` is the buffer size to create.

### `WgslModule.workgroupSize`

```ts
workgroupSize: [number, number, number]
```

### `WgslModule.dispatch`

```ts
dispatch: [number, number, number]
```

How many workgroups to dispatch in each direction.

## toWgsl

`fields` is the whole state of the set, in the order the buffer holds it (default: the fields the program reads, then any it
returns that it did not read).

## WgslImageModule

A shader that draws a window of the grid into a picture.

### `WgslImageModule.code`

```ts
code: string
```

### `WgslImageModule.layout`

```ts
layout: string[]
```

### `WgslImageModule.cells`

```ts
cells: number
```

### `WgslImageModule.uniform`

```ts
uniform:
```

Uniform buffer (binding 0), in bytes: tick u32 at 0, seed u32 at 4, width u32 at 8, height u32 at 12, then four f32 at 16: the window's
left, top, right and bottom edges in cells (a cell is one unit; the left edge of cell 0 is 0), then three f32 at 32: the background
color (0 to 1) shown where a cell is not visible, a f32 at 44: the layer (z) to draw, then one f32 per parameter at `paramsOffset`.

### `WgslImageModule.workgroupSize`

```ts
workgroupSize: [number, number, number]
```

State is read from `src` (binding 1, the layout above); pixels are written to `pixels` (binding 2), one u32 each (red in the lowest byte, alpha 255).

### `WgslImageModule.dispatchFor`

```ts
dispatchFor(width: number, height: number): [number, number, number]
```

Workgroups to dispatch for a picture of this size.

## toWgslImage

The look of a lattice as a picture: each pixel finds the cell under it and works out `visible`, `r`, `g`, `b` (the program's outputs, colors
between 0 and 1) there. Zooming and panning only change the window, so a huge grid is drawn at the size of the screen, never cell by cell.

## WgslReduceModule

A shader that totals expressions over the whole grid (metrics): one partial total per workgroup, which the host adds up.

### `WgslReduceModule.code`

```ts
code: string
```

### `WgslReduceModule.layout`

```ts
layout: string[]
```

### `WgslReduceModule.cells`

```ts
cells: number
```

### `WgslReduceModule.totals`

```ts
totals:
```

What each total is, in the order the partials are stored.

### `WgslReduceModule.uniform`

```ts
uniform:
```

### `WgslReduceModule.workgroupSize`

```ts
workgroupSize: [number, number, number]
```

### `WgslReduceModule.dispatch`

```ts
dispatch: [number, number, number]
```

### `WgslReduceModule.groups`

```ts
groups: number
```

Workgroups per total: `partials` (binding 2, f32) holds `totals.length * groups` numbers, the first total's groups first.

## toWgslReduce

## UnOp

## BinOp

## NeighborOp

## Node

One step of a program. Operands are indexes of earlier nodes.

## ReduceOp

A total over every cell, for metrics: `alive.sum()`.

## Program

### `Program.nodes`

```ts
nodes: Node[]
```

### `Program.out`

```ts
out: Record<string, number>
```

Which node holds each result field.

### `Program.reduce`

```ts
reduce?: Record<string,
```

Single numbers worked out from a node over every cell (metrics only): `{ population: { op: 'sum', node: 3 } }`.

### `Program.fields`

```ts
fields: string[]
```

The state fields the program reads and the parameters it was given a name for.

### `Program.params`

```ts
params: string[]
```

## Grid

The shape of the grid a program runs on. The same program runs on any grid.

### `Grid.size`

```ts
size: [number, number, number]
```

### `Grid.wrap`

```ts
wrap: boolean
```

### `Grid.neighborhood`

```ts
neighborhood?: 'moore' | 'von-neumann'
```

## saltOf

A number for a name, so `k.hash('birth')` and `k.hash('death')` give different streams.

## hash01

A number in [0, 1) for this cell, tick, scene seed and salt. The same on every machine, in any evaluation order.

## Expr

A field inside a formula: the value of every cell, as an expression. It has the operations of `Field` that can be compiled
(arithmetic, comparisons, `where`, `clamp`, the neighbor operations); the ones that take a JavaScript function cannot be.

### `Expr.add`

```ts
add(o: number | Expr): Expr
```

@internal

### `Expr.sub`

```ts
sub(o: number | Expr): Expr
```

### `Expr.mul`

```ts
mul(o: number | Expr): Expr
```

### `Expr.div`

```ts
div(o: number | Expr): Expr
```

### `Expr.min`

```ts
min(o: number | Expr): Expr
```

### `Expr.max`

```ts
max(o: number | Expr): Expr
```

### `Expr.eq`

```ts
eq(o: number | Expr): Expr
```

### `Expr.ne`

```ts
ne(o: number | Expr): Expr
```

### `Expr.lt`

```ts
lt(o: number | Expr): Expr
```

### `Expr.le`

```ts
le(o: number | Expr): Expr
```

### `Expr.gt`

```ts
gt(o: number | Expr): Expr
```

### `Expr.ge`

```ts
ge(o: number | Expr): Expr
```

### `Expr.and`

```ts
and(o: number | Expr): Expr
```

### `Expr.or`

```ts
or(o: number | Expr): Expr
```

### `Expr.not`

```ts
not(): Expr
```

### `Expr.abs`

```ts
abs(): Expr
```

### `Expr.neg`

```ts
neg(): Expr
```

The same number with its sign flipped (there is no unary minus on an expression).

### `Expr.sqrt`

```ts
sqrt(): Expr
```

### `Expr.floor`

```ts
floor(): Expr
```

### `Expr.sin`

```ts
sin(): Expr
```

### `Expr.cos`

```ts
cos(): Expr
```

### `Expr.where`

```ts
where(a: number | Expr, b: number | Expr): Expr
```

### `Expr.clamp`

```ts
clamp(lo: number, hi: number): Expr
```

### `Expr.neighborSum`

```ts
neighborSum(): Expr
```

### `Expr.neighborCount`

```ts
neighborCount(): Expr
```

How many neighbors each cell has (the same for every cell on a grid that wraps; fewer at the edge of one that does not).

### `Expr.neighborAverage`

```ts
neighborAverage(): Expr
```

### `Expr.neighborMax`

```ts
neighborMax(): Expr
```

### `Expr.map`

```ts
map(): never
```

### `Expr.zip`

```ts
zip(): never
```

### `Expr.sum`

```ts
sum(): Total
```

A total over every cell. Only a metric may ask for one (a rule describes each cell, not all of them).

### `Expr.average`

```ts
average(): Total
```

### `Expr.data`

```ts
get data(): never
```

### `Expr.valueOf`

```ts
valueOf(): never
```

### `Expr.toString`

```ts
toString(): string
```

## FormulaContext

What a formula can ask for besides its fields and parameters.

### `FormulaContext.random`

```ts
random(name?: string): Expr
```

One random number in [0, 1) for the whole grid (the same value in every cell, new each tick), for things that happen at one place:
`k.random('blob-3').mul(k.size[0])` is where blob 3 goes. The same on every run and machine.

### `FormulaContext.hash`

```ts
hash(name?: string): Expr
```

A number in [0, 1) that is different for every cell and tick, and the same on every run and machine. `name` makes separate streams.

### `FormulaContext.x`

```ts
x: Expr
```

Which column, row and layer the cell is in.

### `FormulaContext.y`

```ts
y: Expr
```

### `FormulaContext.z`

```ts
z: Expr
```

### `FormulaContext.index`

```ts
index: Expr
```

The cell's number, in storage order.

### `FormulaContext.tick`

```ts
tick: Expr
```

### `FormulaContext.size`

```ts
size: [number, number, number]
```

The grid's size in cells (columns, rows, layers), as plain numbers. A formula that uses it is made again for a grid of another size.

### `FormulaContext.data`

```ts
data: any
```

The scene's `data`, as plain JSON, read when the formula is written. A formula that uses it is made again when the data changes.

### `FormulaContext.gradient`

```ts
gradient(stops: string[], t: Expr | number):
```

A color along a list of hex stops, for `t` between 0 and 1: `const { r, g, b } = k.gradient(['#0b1230', '#2fb8bd', '#f6efc4'], v.mul(3))`.

## FormulaSite

What a formula may know about the place it will run, besides its fields and parameters.

### `FormulaSite.size`

```ts
size?: [number, number, number]
```

### `FormulaSite.data`

```ts
data?: unknown
```

## Formula

## trace

Run a formula once and record what it computes. `fields` names the state fields it can read, `params` the parameters
(these become values the program is given each tick, so a slider moves without anything being compiled again).

## Total

A single number worked out over every cell: what a metric returns when it is written with field methods.

## traceMetrics

Metrics for a set whose state lives on a graphics card: the function is run once with expressions for the fields (`cells.alive`),
and each total it returns (`cells.alive.sum()`, `.average()`) becomes a reduction the card works out. `metrics` maps a name to its
function, as in a script's `export const metrics`; a metric that returns anything but a total is left out and named in `skipped`.

## neighborOffsets

The offsets of a cell's neighbors, in the order `LatticeWorld` visits them (sums of floats depend on the order).

## RunInput

### `RunInput.state`

```ts
state: Record<string, ArrayLike<number>>
```

Every state field the program reads, one value per cell.

### `RunInput.params`

```ts
params?: Record<string, number>
```

### `RunInput.tick`

```ts
tick?: number
```

### `RunInput.seed`

```ts
seed?: number
```

The scene's seed, for `hash`.

## interpret

Run a program on the CPU for every cell and return its result fields. Each node is worked out over the whole grid before the next.

## interpretTotals

The program's totals (`program.reduce`), worked out on the CPU. Sums add in 64-bit, like `Field.sum`.

## validateProgram

Checks a program that came from somewhere else (a file, a worker). Returns readable problems, or none if it is well formed.

## GaitJoint

One joint's rhythm: its target angle swings around `offset` by `amplitude` radians, `phase` of a cycle ahead and `lag` of a cycle behind.

### `GaitJoint.amplitude`

```ts
amplitude?: number
```

Radians. How far the joint swings either side of `offset`. Default 0.

### `GaitJoint.offset`

```ts
offset?: number
```

Radians. The angle the joint swings around. Default 0.

### `GaitJoint.phase`

```ts
phase?: number
```

Fraction of a cycle (0.5 is half a cycle ahead or behind). Default 0.

### `GaitJoint.lag`

```ts
lag?: number
```

Cycles this joint trails behind, on top of `phase` (a knee that bends a quarter cycle after its hip). Default 0.

## Gait

Rhythmic joint targets, the way a walker's legs keep time: a sine for each joint, started at different points of one shared cycle.
A creature's script keeps the cycle position in its state, advances it each tick with `Gait.advance`, and returns
`{ joints: Gait.targets(legs, cycle) }`. Nothing here is built into the engine: a joint with no target from the script rests at 0.

### `Gait.wave`

```ts
static wave(cycle: number, joint: GaitJoint): number
```

The target angle for one joint at `cycle` (0 to 1): `offset + amplitude * sin(2 pi (cycle + phase - lag))`.

### `Gait.targets`

```ts
static targets(joints: Record<string, GaitJoint>, cycle: number): Record<string, number>
```

Targets for many joints at once, by joint name: `Gait.targets({ 'FL.hip': { amplitude: 0.7 }, 'FR.hip': { amplitude: 0.7, phase: 0.5 } }, cycle)`.

### `Gait.advance`

```ts
static advance(cycle: number, frequency: number, dt: number): number
```

The next cycle position after `dt` seconds at `frequency` cycles per second, wrapped to 0..1. Keeping the position (not the time) means changing the frequency never makes the legs jump.

## Mlp

A small fully connected network with tanh layers, for controllers that keep their weights in a state array.
The shape is fixed by `sizes`; the weights live in the agent's state (so they are snapshotted, forked and
mutated like any other column). Layout per layer: `out × in` weights, then `out` biases.

### `Mlp.weightCount`

```ts
readonly weightCount: number
```

### `Mlp.run`

```ts
run(weights: ArrayLike<number>, inputs: ArrayLike<number>): number[]
```

## VecLike

## toVec

## Vec3

An immutable 3D vector. Every operation returns a new one, so scripts can chain freely.

### `Vec3.plus`

```ts
plus(v: VecLike): Vec3
```

### `Vec3.minus`

```ts
minus(v: VecLike): Vec3
```

### `Vec3.times`

```ts
times(k: number): Vec3
```

### `Vec3.dividedBy`

```ts
dividedBy(k: number): Vec3
```

### `Vec3.reversed`

```ts
reversed(): Vec3
```

### `Vec3.length`

```ts
length(): number
```

### `Vec3.lengthSquared`

```ts
lengthSquared(): number
```

### `Vec3.normalized`

```ts
normalized(): Vec3
```

Same direction, length 1. The zero vector stays zero.

### `Vec3.limit`

```ts
limit(max: number): Vec3
```

Same direction, but no longer than `max`.

### `Vec3.dot`

```ts
dot(v: VecLike): number
```

### `Vec3.cross`

```ts
cross(v: VecLike): Vec3
```

### `Vec3.turned`

```ts
turned(angle: number): Vec3
```

Turned by `angle` radians around the vertical axis (positive turns toward -x seen from above, like the physics yaw).

### `Vec3.distanceTo`

```ts
distanceTo(v: VecLike): number
```

### `Vec3.toArray`

```ts
toArray(): [number, number, number]
```

### `Vec3.toString`

```ts
toString(): string
```

## Vecs

A list of vectors that can be used like one vector: `neighbors.velocity.average()`,
`positions.minus(me)`. Operations apply to every element, so scripts rarely need loops.

### `Vecs.plus`

```ts
plus(v: VecLike): Vecs
```

### `Vecs.minus`

```ts
minus(v: VecLike): Vecs
```

### `Vecs.times`

```ts
times(k: number): Vecs
```

### `Vecs.dividedBy`

```ts
dividedBy(k: number): Vecs
```

### `Vecs.reversed`

```ts
reversed(): Vecs
```

### `Vecs.normalized`

```ts
normalized(): Vecs
```

### `Vecs.limit`

```ts
limit(max: number): Vecs
```

### `Vecs.sum`

```ts
sum(): Vec3
```

The sum of all the vectors. An empty list sums to the zero vector.

### `Vecs.average`

```ts
average(): Vec3
```

The average vector. An empty list averages to the zero vector.

### `Vecs.lengths`

```ts
lengths(): Nums
```

How long each vector is, as a list of numbers you can ask `.average()`, `.max()` and so on.

### `Vecs.isEmpty`

```ts
isEmpty(): boolean
```

## Nums

A list of numbers that answers questions as a whole: `neighbors.alive.sum()`.

### `Nums.sum`

```ts
sum(): number
```

### `Nums.average`

```ts
average(): number
```

The average, or 0 for an empty list.

### `Nums.min`

```ts
min(): number
```

### `Nums.max`

```ts
max(): number
```

### `Nums.isEmpty`

```ts
isEmpty(): boolean
```
