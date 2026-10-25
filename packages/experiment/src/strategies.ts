import { CmaEs } from './cmaes'
import { SearchRng } from './rng'
import type { Dim } from './space'
import type { Strategy } from './strategy'

/** Try every combination: `steps` values of each continuous param, every value of a listed one. */
export class GridStrategy implements Strategy {
  readonly name = 'grid'
  private points: number[][]
  private next = 0

  constructor(dims: Dim[], steps = 5) {
    const axes = dims.map((d) => {
      const vals = d.gridPoints(steps)
      return vals.map((_, i) => (vals.length === 1 ? 0.5 : d.count === Infinity || d.count > vals.length ? i / (vals.length - 1) : (i + 0.5) / vals.length))
    })
    // cartesian product, first param varying slowest
    this.points = axes.reduce<number[][]>((acc, axis) => acc.flatMap((p) => axis.map((u) => [...p, u])), [[]])
  }

  /** How many runs the whole grid takes. */
  get size(): number { return this.points.length }

  ask(n: number): number[][] {
    const out = this.points.slice(this.next, this.next + n)
    this.next += out.length
    return out
  }
  tell(): void {}
  done(): boolean { return this.next >= this.points.length }
}

/** Uniform random points, a fixed number of them. The honest baseline any smarter search should beat. */
export class RandomStrategy implements Strategy {
  readonly name = 'random'
  private rng: SearchRng
  private left: number

  constructor(private d: number, runs = 30, seed = 1) {
    this.rng = new SearchRng(seed)
    this.left = runs
  }

  ask(n: number): number[][] {
    const k = Math.min(n, this.left)
    this.left -= k
    return Array.from({ length: k }, () => Array.from({ length: this.d }, () => this.rng.next()))
  }
  tell(): void {}
  done(): boolean { return this.left <= 0 }
}

/**
 * CMA-ES: samples around a mean, then reshapes the sampling distribution toward what scored well. It learns which
 * params matter together, so it suits smooth landscapes with a handful of params.
 */
export class CmaStrategy implements Strategy {
  readonly name = 'cmaes'
  private cma: CmaEs
  private left: number
  private pending: number[][] = []
  private scores: number[] = []
  private asked: number[][] = []

  constructor(d: number, opts: { runs?: number; population?: number; sigma?: number; seed?: number } = {}) {
    this.cma = new CmaEs(d, { sigma: opts.sigma ?? 0.3, population: opts.population, seed: opts.seed ?? 1 })
    this.left = opts.runs ?? 60
  }

  ask(n: number): number[][] {
    // hand out the current generation in pieces; a new one is drawn once the last has been told
    if (!this.pending.length && !this.asked.length) this.pending = this.cma.sample()
    const k = Math.min(n, this.pending.length, this.left)
    const out = this.pending.splice(0, k)
    this.left -= k
    this.asked.push(...out)
    return out
  }

  tell(points: number[][], scores: number[]): void {
    this.scores.push(...scores)
    if (this.scores.length >= this.asked.length && !this.pending.length) {
      this.cma.update(this.asked, this.scores.map((s) => -s)) // CMA-ES minimises
      this.asked = []
      this.scores = []
    }
    void points
  }

  done(): boolean { return this.left <= 0 && !this.pending.length }
}
