import { Vec3, Vecs } from './vec'

/** Anything with a place and a heading: what a group of agents needs to answer questions about itself. */
export interface Positioned {
  readonly position: Vec3
  readonly velocity: Vec3
}

/**
 * What a script sees of one free agent (`self`, and each member of `neighbors`). Every agent has a position
 * and a velocity without declaring anything; any extra `state` fields from the scene appear as properties too.
 */
export interface AgentView extends Positioned {
  /** Where the agent is, as a vector. */
  readonly position: Vec3
  /** Where it is heading and how fast, as a vector. */
  readonly velocity: Vec3
  /** The x coordinate of the position. */
  readonly x: number
  /** The y coordinate (up). */
  readonly y: number
  /** The z coordinate. */
  readonly z: number
  /** The x part of the velocity. */
  readonly vx: number
  /** The y part of the velocity. */
  readonly vy: number
  /** The z part of the velocity. */
  readonly vz: number
  /** The cell of the first lattice layer under the agent, or null outside the grid. */
  readonly patch: unknown | null
  /** The cell at an offset (a vector) from the agent, or null off the grid: `self.patchAt(heading.times(3))`. */
  patchAt(offset: Vec3 | readonly [number, number, number]): unknown | null
}

/**
 * A group of agents that can be asked questions all at once:
 * `neighbors.velocity` is a list of every neighbor's velocity.
 * A group made by a sensor remembers who is looking (`origin`), so `offset` and `within` are relative to them.
 */
export class Agents<A extends Positioned = Positioned> extends Array<A> {
  origin: Positioned | null

  // map/filter/slice give back plain arrays, not half-built groups
  static get [Symbol.species]() { return Array }

  constructor(origin: Positioned | null = null) {
    super()
    this.origin = origin
  }

  /** Everyone's position. */
  get position(): Vecs { return Vecs.from(this, (a) => a.position) as Vecs }

  /** Everyone's velocity. */
  get velocity(): Vecs { return Vecs.from(this, (a) => a.velocity) as Vecs }

  /** For each agent, the vector from the one looking at them to them. */
  get offset(): Vecs {
    const me = this.need('offset').position
    return Vecs.from(this, (a) => a.position.minus(me)) as Vecs
  }

  /** For each agent, how far away they are from the one looking. */
  get distance(): number[] {
    const me = this.need('distance').position
    return Array.from(this, (a) => a.position.distanceTo(me))
  }

  /** Only the agents closer than `radius`. */
  within(radius: number): Agents<A> {
    const me = this.need('within').position
    const out = new (this.constructor as new (origin: Positioned | null) => Agents<A>)(this.origin)
    for (const a of this) if (a.position.distanceTo(me) <= radius) out.push(a)
    return out
  }

  /** The closest agent, or null if the group is empty. */
  nearest(): A | null {
    const me = this.need('nearest').position
    let best: A | null = null
    let bestD = Infinity
    for (const a of this) {
      const d = a.position.distanceTo(me)
      if (d < bestD) { best = a; bestD = d }
    }
    return best
  }

  isEmpty(): boolean { return this.length === 0 }

  private need(what: string): Positioned {
    if (!this.origin) throw new Error(`.${what} needs a group that belongs to an agent, like \`neighbors\``)
    return this.origin
  }
}
