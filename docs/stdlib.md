# Standard library

Everything here is available to scripts without importing anything. It lives in its own package
(`packages/stdlib`), apart from the simulation engine, and this page is generated from its source comments.

Scripts reach it through the values they are given: `self` and `neighbors` in `decide`, `ctx` for helpers
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

### `Field.length`

```ts
get length(): number
```

### `Field.neighborSum`

```ts
neighborSum(): Field
```

For each cell, the total of this field over its neighbors.

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
