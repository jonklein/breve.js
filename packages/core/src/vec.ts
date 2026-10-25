export type VecLike = Vec3 | readonly [number, number, number]

export function toVec(v: VecLike): Vec3 {
  return v instanceof Vec3 ? v : new Vec3(v[0], v[1], v[2])
}

/** An immutable 3D vector. Every operation returns a new one, so scripts can chain freely. */
export class Vec3 {
  static readonly zero = new Vec3(0, 0, 0)

  constructor(readonly x = 0, readonly y = 0, readonly z = 0) {}

  plus(v: VecLike): Vec3 { const o = toVec(v); return new Vec3(this.x + o.x, this.y + o.y, this.z + o.z) }
  minus(v: VecLike): Vec3 { const o = toVec(v); return new Vec3(this.x - o.x, this.y - o.y, this.z - o.z) }
  times(k: number): Vec3 { return new Vec3(this.x * k, this.y * k, this.z * k) }
  dividedBy(k: number): Vec3 { return this.times(1 / k) }
  reversed(): Vec3 { return new Vec3(-this.x, -this.y, -this.z) }

  length(): number { return Math.hypot(this.x, this.y, this.z) }
  lengthSquared(): number { return this.x * this.x + this.y * this.y + this.z * this.z }
  /** Same direction, length 1. The zero vector stays zero. */
  normalized(): Vec3 { const l = this.length(); return l > 1e-9 ? this.times(1 / l) : Vec3.zero }
  /** Same direction, but no longer than `max`. */
  limit(max: number): Vec3 { const l = this.length(); return l > max ? this.times(max / l) : this }

  dot(v: VecLike): number { const o = toVec(v); return this.x * o.x + this.y * o.y + this.z * o.z }
  cross(v: VecLike): Vec3 {
    const o = toVec(v)
    return new Vec3(this.y * o.z - this.z * o.y, this.z * o.x - this.x * o.z, this.x * o.y - this.y * o.x)
  }
  /** Turned by `angle` radians around the vertical axis (positive turns toward -x seen from above, like the physics yaw). */
  turned(angle: number): Vec3 { const c = Math.cos(angle), s = Math.sin(angle); return new Vec3(this.x * c + this.z * s, this.y, -this.x * s + this.z * c) }
  distanceTo(v: VecLike): number { return this.minus(v).length() }

  toArray(): [number, number, number] { return [this.x, this.y, this.z] }
  toString(): string { return `(${this.x.toFixed(2)}, ${this.y.toFixed(2)}, ${this.z.toFixed(2)})` }
}

/**
 * A list of vectors that can be used like one vector: `neighbors.velocity.average()`,
 * `positions.minus(me)`. Operations apply to every element, so scripts rarely need loops.
 */
export class Vecs extends Array<Vec3> {
  plus(v: VecLike): Vecs { return this.each((a) => a.plus(v)) }
  minus(v: VecLike): Vecs { return this.each((a) => a.minus(v)) }
  times(k: number): Vecs { return this.each((a) => a.times(k)) }
  dividedBy(k: number): Vecs { return this.each((a) => a.dividedBy(k)) }
  reversed(): Vecs { return this.each((a) => a.reversed()) }
  normalized(): Vecs { return this.each((a) => a.normalized()) }
  limit(max: number): Vecs { return this.each((a) => a.limit(max)) }

  /** The sum of all the vectors. An empty list sums to the zero vector. */
  sum(): Vec3 {
    let x = 0, y = 0, z = 0
    for (const v of this) { x += v.x; y += v.y; z += v.z }
    return new Vec3(x, y, z)
  }

  /** The average vector. An empty list averages to the zero vector. */
  average(): Vec3 { return this.length ? this.sum().times(1 / this.length) : Vec3.zero }

  /** How long each vector is, as a list of numbers you can ask `.average()`, `.max()` and so on. */
  lengths(): Nums { return Nums.from(this, (v) => v.length()) as Nums }

  isEmpty(): boolean { return this.length === 0 }

  private each(fn: (v: Vec3) => Vec3): Vecs {
    const out = new Vecs()
    for (const v of this) out.push(fn(v))
    return out
  }
}

/** A list of numbers that answers questions as a whole: `neighbors.alive.sum()`. */
export class Nums extends Array<number> {
  static get [Symbol.species]() { return Array }
  sum(): number { let t = 0; for (const v of this) t += v; return t }
  /** The average, or 0 for an empty list. */
  average(): number { return this.length ? this.sum() / this.length : 0 }
  min(): number { return this.length ? Math.min(...this) : 0 }
  max(): number { return this.length ? Math.max(...this) : 0 }
  isEmpty(): boolean { return this.length === 0 }
}
