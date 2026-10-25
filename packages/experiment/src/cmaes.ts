import { SearchRng } from './rng'

/** The CMA-ES optimizer (Hansen's tutorial form) on the unit cube: minimises, and keeps samples inside the box by clipping. */
export class CmaEs {
  readonly n: number
  readonly lambda: number
  private mu: number
  private w: number[]
  private mueff: number
  private cc: number
  private cs: number
  private c1: number
  private cmu: number
  private damps: number
  private chiN: number
  private mean: number[]
  sigma: number
  private C: number[][]
  private B: number[][]
  private D: number[]
  private pc: number[]
  private ps: number[]
  private rng: SearchRng
  private generation = 0
  /** The y vectors of the last sample, so the update uses what was actually evaluated. */
  private lastY: number[][] = []

  constructor(n: number, opts: { sigma?: number; population?: number; seed?: number; start?: number[] } = {}) {
    this.n = n
    this.lambda = opts.population ?? 4 + Math.floor(3 * Math.log(n))
    this.mu = Math.floor(this.lambda / 2)
    const raw = Array.from({ length: this.mu }, (_, i) => Math.log(this.mu + 0.5) - Math.log(i + 1))
    const sum = raw.reduce((a, b) => a + b, 0)
    this.w = raw.map((x) => x / sum)
    this.mueff = 1 / this.w.reduce((a, b) => a + b * b, 0)
    this.cc = (4 + this.mueff / n) / (n + 4 + (2 * this.mueff) / n)
    this.cs = (this.mueff + 2) / (n + this.mueff + 5)
    this.c1 = 2 / ((n + 1.3) ** 2 + this.mueff)
    this.cmu = Math.min(1 - this.c1, (2 * (this.mueff - 2 + 1 / this.mueff)) / ((n + 2) ** 2 + this.mueff))
    this.damps = 1 + 2 * Math.max(0, Math.sqrt((this.mueff - 1) / (n + 1)) - 1) + this.cs
    this.chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n))
    this.mean = opts.start ?? Array(n).fill(0.5)
    this.sigma = opts.sigma ?? 0.3
    this.C = identity(n)
    this.B = identity(n)
    this.D = Array(n).fill(1)
    this.pc = Array(n).fill(0)
    this.ps = Array(n).fill(0)
    this.rng = new SearchRng(opts.seed ?? 1)
  }

  get currentMean(): number[] { return [...this.mean] }

  /** Draw a generation of candidate points. */
  sample(): number[][] {
    const { n } = this
    const xs: number[][] = []
    this.lastY = []
    for (let k = 0; k < this.lambda; k++) {
      const z = Array.from({ length: n }, () => this.rng.gauss())
      const y = this.B.map((row) => row.reduce((s, b, j) => s + b * this.D[j] * z[j], 0))
      const x = this.mean.map((m, i) => Math.min(1, Math.max(0, m + this.sigma * y[i])))
      xs.push(x)
      this.lastY.push(x.map((xi, i) => (xi - this.mean[i]) / this.sigma)) // y of the point as clipped
    }
    return xs
  }

  /** Learn from the scores of a generation drawn by `sample` (lower is better). */
  update(_xs: number[][], fitness: number[]): void {
    const { n } = this
    const order = fitness.map((f, i) => [f, i] as const).sort((a, b) => a[0] - b[0]).map((p) => p[1])
    const ys = this.lastY
    // weighted mean step
    const yw = Array(n).fill(0)
    for (let i = 0; i < this.mu; i++) for (let j = 0; j < n; j++) yw[j] += this.w[i] * ys[order[i]][j]
    this.mean = this.mean.map((m, j) => Math.min(1, Math.max(0, m + this.sigma * yw[j])))
    // C^(-1/2) * yw
    const invSqrt = this.B.map((_, i) => this.B[i].map((__, j) => 0))
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      let s = 0
      for (let k = 0; k < n; k++) s += this.B[i][k] * (1 / this.D[k]) * this.B[j][k]
      invSqrt[i][j] = s
    }
    const cInvY = invSqrt.map((row) => row.reduce((s, v, j) => s + v * yw[j], 0))
    const csq = Math.sqrt(this.cs * (2 - this.cs) * this.mueff)
    this.ps = this.ps.map((p, j) => (1 - this.cs) * p + csq * cInvY[j])
    const psNorm = Math.hypot(...this.ps)
    this.generation++
    const hsig = psNorm / Math.sqrt(1 - (1 - this.cs) ** (2 * this.generation)) / this.chiN < 1.4 + 2 / (n + 1) ? 1 : 0
    const ccsq = Math.sqrt(this.cc * (2 - this.cc) * this.mueff)
    this.pc = this.pc.map((p, j) => (1 - this.cc) * p + hsig * ccsq * yw[j])
    // covariance update
    const delta = (1 - hsig) * this.cc * (2 - this.cc)
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let rank = 0
      for (let k = 0; k < this.mu; k++) rank += this.w[k] * ys[order[k]][i] * ys[order[k]][j]
      const v = (1 - this.c1 - this.cmu) * this.C[i][j] + this.c1 * (this.pc[i] * this.pc[j] + delta * this.C[i][j]) + this.cmu * rank
      this.C[i][j] = this.C[j][i] = v
    }
    this.sigma *= Math.exp((this.cs / this.damps) * (psNorm / this.chiN - 1))
    this.sigma = Math.min(1, Math.max(1e-6, this.sigma))
    const { vectors, values } = eigen(this.C)
    this.B = vectors
    this.D = values.map((v) => Math.sqrt(Math.max(v, 1e-20)))
  }
}

function identity(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)))
}

/** Eigen decomposition of a small symmetric matrix by Jacobi rotations: columns of `vectors` are the eigenvectors (stored as vectors[row][col]). */
export function eigen(a: number[][]): { vectors: number[][]; values: number[] } {
  const n = a.length
  const A = a.map((r) => [...r])
  const V = identity(n)
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j]
    if (off < 1e-22) break
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue
      const theta = (A[q][q] - A[p][p]) / (2 * A[p][q])
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
      const c = 1 / Math.sqrt(t * t + 1), s = t * c
      for (let k = 0; k < n; k++) {
        const akp = A[k][p], akq = A[k][q]
        A[k][p] = c * akp - s * akq
        A[k][q] = s * akp + c * akq
      }
      for (let k = 0; k < n; k++) {
        const apk = A[p][k], aqk = A[q][k]
        A[p][k] = c * apk - s * aqk
        A[q][k] = s * apk + c * aqk
      }
      for (let k = 0; k < n; k++) {
        const vkp = V[k][p], vkq = V[k][q]
        V[k][p] = c * vkp - s * vkq
        V[k][q] = s * vkp + c * vkq
      }
    }
  }
  return { vectors: V, values: A.map((r, i) => r[i]) }
}
