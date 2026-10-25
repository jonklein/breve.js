import Ajv from 'ajv'
import type { Scene } from '@breve/core'
import type { SpaceSpec } from './space'

export type StrategySpec =
  | { type: 'grid'; steps?: number }
  | { type: 'random'; runs?: number }
  | { type: 'cmaes'; runs?: number; population?: number; sigma?: number }

export interface ExperimentSpec {
  name?: string
  /** How to pick the next runs. */
  strategy: StrategySpec
  /** Which params to vary, and over what. */
  space: SpaceSpec
  /** What to optimise: a metric the scene declares. */
  objective: { metric: string; goal?: 'max' | 'min'; aggregate?: 'final' | 'mean' | 'max' | 'min' }
  /** How many ticks each run lasts. */
  ticks: number
  /** Sample the metric every this many ticks (for mean, max and min). Default 10. */
  sampleEvery?: number
  /** Runs per candidate, each with a different seed; the score is their average. Default 1. */
  replicates?: number
  /** Seed for the search itself. Default 1. */
  seed?: number
}

const schema = {
  type: 'object',
  required: ['strategy', 'space', 'objective', 'ticks'],
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    strategy: {
      type: 'object',
      required: ['type'],
      oneOf: [
        { properties: { type: { const: 'grid' }, steps: { type: 'integer', minimum: 2, maximum: 50 } }, additionalProperties: false },
        { properties: { type: { const: 'random' }, runs: { type: 'integer', minimum: 1, maximum: 5000 } }, additionalProperties: false },
        { properties: { type: { const: 'cmaes' }, runs: { type: 'integer', minimum: 1, maximum: 5000 }, population: { type: 'integer', minimum: 4, maximum: 200 }, sigma: { type: 'number', exclusiveMinimum: 0, maximum: 1 } }, additionalProperties: false },
      ],
    },
    space: {
      anyOf: [
        { type: 'array', items: { type: 'string' }, minItems: 1 },
        {
          type: 'object',
          minProperties: 1,
          additionalProperties: {
            anyOf: [
              { type: 'boolean' },
              { type: 'array', items: { type: 'number' }, minItems: 1 },
              { type: 'object', additionalProperties: false, properties: { min: { type: 'number' }, max: { type: 'number' }, step: { type: 'number', exclusiveMinimum: 0 }, integer: { type: 'boolean' } } },
            ],
          },
        },
      ],
    },
    objective: {
      type: 'object',
      required: ['metric'],
      additionalProperties: false,
      properties: { metric: { type: 'string' }, goal: { enum: ['max', 'min'] }, aggregate: { enum: ['final', 'mean', 'max', 'min'] } },
    },
    ticks: { type: 'integer', minimum: 1, maximum: 1_000_000 },
    sampleEvery: { type: 'integer', minimum: 1 },
    replicates: { type: 'integer', minimum: 1, maximum: 100 },
    seed: { type: 'integer' },
  },
} as const

const validate = new Ajv({ allErrors: true, strict: false }).compile(schema)

export type SpecResult = { ok: true; spec: ExperimentSpec } | { ok: false; errors: string[] }

/** Parse experiment JSON text (or a value) with readable errors, and check it against the scene when one is given. */
export function parseExperiment(input: string | unknown, scene?: Scene): SpecResult {
  let data: unknown = input
  if (typeof input === 'string') {
    try { data = JSON.parse(input) } catch (e) { return { ok: false, errors: [`Invalid JSON: ${(e as Error).message}`] } }
  }
  if (!validate(data)) {
    const errors = (validate.errors ?? [])
      .filter((e) => !['anyOf', 'oneOf'].includes(e.keyword))
      .map((e) => {
        const where = e.instancePath ? e.instancePath.slice(1).replace(/\//g, '.') : 'experiment'
        if (e.keyword === 'additionalProperties') return `${where}: unknown property "${(e.params as { additionalProperty: string }).additionalProperty}"`
        if (e.keyword === 'required') return `${where}: missing "${(e.params as { missingProperty: string }).missingProperty}"`
        return `${where}: ${e.message}`
      })
    return { ok: false, errors: errors.length ? errors : ['experiment: does not match the schema (check "strategy.type" is grid, random or cmaes)'] }
  }
  const spec = data as ExperimentSpec
  const errors: string[] = []
  if (scene) {
    if (!(scene.metrics ?? []).includes(spec.objective.metric)) errors.push(`objective.metric: the scene does not declare a metric called "${spec.objective.metric}" (it has: ${(scene.metrics ?? []).join(', ') || 'none'})`)
    const names = Array.isArray(spec.space) ? spec.space : Object.keys(spec.space)
    for (const n of names) if (!(n in scene.params)) errors.push(`space: the scene has no param "${n}" (it has: ${Object.keys(scene.params).join(', ')})`)
  }
  return errors.length ? { ok: false, errors } : { ok: true, spec }
}
