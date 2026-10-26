import { Sim, withParams, type Scene, type ScriptModule } from '@breve/core'
import type { ExperimentSpec } from './spec'
import { makeDims, type Dim } from './space'
import { CmaStrategy, GridStrategy, RandomStrategy } from './strategies'
import type { Strategy } from './strategy'

export interface Trial {
  id: number
  params: Record<string, number>
  /** The objective's value (after aggregating over the run, then averaging replicates). */
  value: number
  /** Higher is always better: the value, or its negative when the goal is to minimise. */
  score: number
  /** Every declared metric at the end of the run (first replicate). */
  metrics: Record<string, number>
}

export interface ExperimentResult {
  spec: ExperimentSpec
  trials: Trial[]
  /** Trials best first. */
  ranked: Trial[]
  best: Trial | null
}

/** Make the strategy an experiment asks for. */
export function makeStrategy(spec: ExperimentSpec, dims: Dim[]): Strategy {
  const s = spec.strategy
  const seed = spec.seed ?? 1
  if (s.type === 'grid') return new GridStrategy(dims, s.steps ?? 5)
  if (s.type === 'random') return new RandomStrategy(dims.length, s.runs ?? 30, seed)
  return new CmaStrategy(dims.length, { runs: s.runs ?? 60, population: s.population, sigma: s.sigma, seed })
}

function aggregate(samples: number[], how: 'final' | 'mean' | 'max' | 'min'): number {
  if (!samples.length) return NaN
  if (how === 'final') return samples[samples.length - 1]
  if (how === 'mean') return samples.reduce((a, b) => a + b, 0) / samples.length
  return how === 'max' ? Math.max(...samples) : Math.min(...samples)
}

/** Run one candidate (all its replicates) and report what it scored. */
export async function evaluate(spec: ExperimentSpec, base: { scene: Scene; script?: ScriptModule }, params: Record<string, number>): Promise<Omit<Trial, 'id'>> {
  const every = spec.sampleEvery ?? 10
  const how = spec.objective.aggregate ?? 'final'
  const values: number[] = []
  let metrics: Record<string, number> = {}
  for (let r = 0; r < (spec.replicates ?? 1); r++) {
    const scene = withParams(base.scene, params)
    scene.seed = base.scene.seed + r * 7919
    const sim = await Sim.create(scene, base.script)
    const samples: number[] = []
    try {
      for (let t = 1; t <= spec.ticks; t++) {
        sim.step()
        if (t % every === 0 || t === spec.ticks) {
          const v = sim.metrics()[spec.objective.metric]
          if (v !== undefined) samples.push(v)
        }
      }
      if (r === 0) metrics = sim.metrics()
    } finally {
      sim.dispose()
    }
    values.push(aggregate(samples, how))
  }
  const value = values.reduce((a, b) => a + b, 0) / values.length
  const score = Number.isFinite(value) ? (spec.objective.goal === 'min' ? -value : value) : -Infinity
  return { params, value, score, metrics }
}

/**
 * Run an experiment: ask the strategy for candidates, run each, tell it the scores, until it is done.
 * `batch` is how many candidates are asked for at a time. With the default evaluator they run one after another. A host with
 * several workers passes `evaluate` (run one candidate somewhere) and the whole batch runs side by side, but the trials still
 * come back in order and the strategy hears the same scores, so the result does not depend on how many workers there were.
 * Keep `batch` the same across machines (the default is 4) so a search is repeatable.
 */
export async function runExperiment(
  spec: ExperimentSpec,
  base: { scene: Scene; script?: ScriptModule },
  opts: { batch?: number; evaluate?: (params: Record<string, number>) => Promise<Omit<Trial, 'id'>>; onTrial?: (t: Trial, done: number) => void; shouldStop?: () => boolean } = {},
): Promise<ExperimentResult> {
  const dims = makeDims(spec.space, base.scene)
  const strategy = makeStrategy(spec, dims)
  const trials: Trial[] = []
  while (!strategy.done() && !opts.shouldStop?.()) {
    const points = strategy.ask(opts.batch ?? 4)
    if (!points.length) break
    const scores: number[] = []
    const paramsOf = points.map((p) => Object.fromEntries(dims.map((d, i) => [d.name, d.decode(p[i])])))
    if (opts.evaluate) {
      // the whole batch runs at once; trials are recorded in the order they were asked for
      const results = await Promise.all(paramsOf.map((params) => opts.evaluate!(params)))
      for (const r of results) {
        const t: Trial = { id: trials.length, ...r }
        trials.push(t)
        scores.push(t.score)
        opts.onTrial?.(t, trials.length)
      }
    } else {
      for (const params of paramsOf) {
        const t: Trial = { id: trials.length, ...(await evaluate(spec, base, params)) }
        trials.push(t)
        scores.push(t.score)
        opts.onTrial?.(t, trials.length)
        if (opts.shouldStop?.()) break
      }
    }
    if (scores.length === points.length) strategy.tell(points, scores)
    else break
  }
  const ranked = [...trials].sort((a, b) => b.score - a.score)
  return { spec, trials, ranked, best: ranked[0] ?? null }
}

/** Results as CSV: one row per trial, best first, with every searched param and the objective value. */
export function toCsv(result: ExperimentResult): string {
  const names = result.ranked[0] ? Object.keys(result.ranked[0].params) : []
  const lines = [['rank', 'trial', ...names, result.spec.objective.metric].join(',')]
  result.ranked.forEach((t, i) => lines.push([i + 1, t.id, ...names.map((n) => t.params[n]), t.value].join(',')))
  return lines.join('\n') + '\n'
}

/** A name for a run, like `separation=14, cohesion=0.8`. */
export function runName(params: Record<string, number>): string {
  return Object.entries(params).map(([k, v]) => `${k}=${v}`).join(', ')
}

/**
 * Up to `max` runs the experiment would try, for watching side by side before (or instead of) running them all.
 * A grid gives an evenly spread subset; the other strategies give what they would ask for first.
 */
export function sampleCandidates(spec: ExperimentSpec, scene: Scene, max: number): { name: string; params: Record<string, number> }[] {
  const dims = makeDims(spec.space, scene)
  const strategy = makeStrategy(spec, dims)
  let points = strategy.ask(strategy instanceof GridStrategy ? strategy.size : max)
  if (points.length > max) points = Array.from({ length: max }, (_, i) => points[Math.round((i * (points.length - 1)) / Math.max(1, max - 1))])
  return points.map((p) => {
    const params = Object.fromEntries(dims.map((d, i) => [d.name, d.decode(p[i])]))
    return { name: runName(params), params }
  })
}

/** How many runs an experiment makes in all (the strategy's budget). */
export function plannedRuns(spec: ExperimentSpec, scene: Scene): number {
  const s = spec.strategy
  if (s.type === 'grid') return (makeStrategy(spec, makeDims(spec.space, scene)) as GridStrategy).size
  return s.runs ?? (s.type === 'random' ? 30 : 60)
}
