import { Vec3, Vecs } from './vec'

export interface AgentCols {
  px: Float32Array; py: Float32Array; pz: Float32Array
  vx: Float32Array; vy: Float32Array; vz: Float32Array
}

/** Readable view of one row. Only valid for the duration of a decide() call. */
export class Agent {
  constructor(private cols: AgentCols, readonly row: number) {}
  get x() { return this.cols.px[this.row] }
  get y() { return this.cols.py[this.row] }
  get z() { return this.cols.pz[this.row] }
  get vx() { return this.cols.vx[this.row] }
  get vy() { return this.cols.vy[this.row] }
  get vz() { return this.cols.vz[this.row] }
  get position(): Vec3 { return new Vec3(this.x, this.y, this.z) }
  get velocity(): Vec3 { return new Vec3(this.vx, this.vy, this.vz) }
}

/**
 * A group of agents that can be asked questions all at once:
 * `neighbors.velocity` is a list of every neighbor's velocity.
 * A group made by a sensor remembers who is looking (`origin`), so `offset` and `within` are relative to them.
 */
export class Agents extends Array<Agent> {
  origin: Agent | null

  // map/filter/slice give back plain arrays, not half-built groups
  static get [Symbol.species]() { return Array }

  constructor(origin: Agent | null = null) {
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
  within(radius: number): Agents {
    const me = this.need('within').position
    const out = new Agents(this.origin)
    for (const a of this) if (a.position.distanceTo(me) <= radius) out.push(a)
    return out
  }

  /** The closest agent, or null if the group is empty. */
  nearest(): Agent | null {
    const me = this.need('nearest').position
    let best: Agent | null = null
    let bestD = Infinity
    for (const a of this) {
      const d = a.position.distanceTo(me)
      if (d < bestD) { best = a; bestD = d }
    }
    return best
  }

  isEmpty(): boolean { return this.length === 0 }

  private need(what: string): Agent {
    if (!this.origin) throw new Error(`.${what} needs a group that belongs to an agent, like \`neighbors\``)
    return this.origin
  }
}
