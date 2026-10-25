import { Vec3 } from '@breve/stdlib'

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
