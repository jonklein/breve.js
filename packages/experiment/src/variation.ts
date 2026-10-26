import type { Dim } from './space'
import { SearchRng } from './rng'

/** A point in the search space: a value for each searched param, by name. */
export type Genome = Record<string, number>

export interface MutateOptions {
  /** Chance that each param changes. Default: one param per mutation on average. */
  rate?: number
  /** Size of a change, as a fraction of the param's range. Default 0.15. */
  sigma?: number
}

/**
 * A copy of `genome` with some params nudged. The size of a nudge and the values a param may take come from
 * the annotations on the scene's params (min, max, step), through the search dimensions: a stepped param moves
 * in whole steps, a list picks a neighboring slot, and nothing leaves its range. All randomness comes from `rng`.
 */
export function mutate(genome: Genome, dims: Dim[], rng: SearchRng, opts: MutateOptions = {}): Genome {
  const rate = opts.rate ?? 1 / Math.max(1, dims.length)
  const sigma = opts.sigma ?? 0.15
  const out: Genome = { ...genome }
  for (const d of dims) {
    if (rng.next() >= rate) continue
    const from = out[d.name]
    // a stepped or listed param can round a small nudge back to where it started; try a few times, then move one slot
    for (let tries = 0; tries < 8 && out[d.name] === from; tries++) out[d.name] = d.decode(d.encode(from) + rng.gauss() * sigma)
    if (out[d.name] === from && Number.isFinite(d.count) && d.count > 1) {
      const slot = 1 / (d.count - 1)
      out[d.name] = d.decode(d.encode(from) + (rng.next() < 0.5 ? -slot : slot))
    }
  }
  return out
}

/**
 * A child of two genomes. `uniform` takes each param from either parent at random; `blend` picks a point
 * between the parents' values (and stays within the range). Every param is present in the child.
 */
export function crossover(a: Genome, b: Genome, dims: Dim[], rng: SearchRng, mode: 'uniform' | 'blend' = 'uniform'): Genome {
  const out: Genome = {}
  for (const d of dims) {
    if (mode === 'uniform') out[d.name] = rng.next() < 0.5 ? a[d.name] : b[d.name]
    else {
      const t = rng.next()
      out[d.name] = d.decode(d.encode(a[d.name]) * (1 - t) + d.encode(b[d.name]) * t)
    }
  }
  return out
}

/** A random genome inside the ranges, for starting a population. */
export function randomGenome(dims: Dim[], rng: SearchRng): Genome {
  return Object.fromEntries(dims.map((d) => [d.name, d.decode(rng.next())]))
}
