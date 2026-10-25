import Ajv from 'ajv'
import { bodySchema, checkBody, expandBody, type BodyInput } from './body'
import type { TerrainDef } from './terrain'

export type NumOrParam = number | string // a number, or "$paramName"

export interface ParamDef {
  value: number
  min?: number
  max?: number
  step?: number
  label?: string
}

export interface SensorDef {
  type: 'neighbors'
  radius: NumOrParam
}

export type StateType = 'u8' | 'i32' | 'f32'

/** A 3D grid of cells with implicit neighbors. Each cell is an entity. */
export interface LatticeDef {
  size: [number, number, number]
  /** World units between cell centers. */
  spacing?: number
  /** What happens at the edge: cells beyond it are "dead" (absent), or the grid wraps around. */
  edges?: 'dead' | 'wrap'
  neighborhood?: 'moore' | 'von-neumann'
  /** State field whose non-zero cells are drawn. */
  show: string
  /** State field that tints drawn cells, scaled by `colorMax`. */
  color?: string
  colorMax?: number
  /** Ease cells in and out over this fraction of a tick (0 = instant, the default; 1 = a whole tick). */
  fade?: number
}

export interface EntityDef {
  name: string
  /** Free-moving agents. Use this or `lattice`. */
  count?: NumOrParam
  lattice?: LatticeDef
  /** Per-cell state, for lattices: field name to storage type. */
  state?: Record<string, StateType>
  /** Fill a state field at the start: `density` of cells, within the central `within` fraction of the grid. */
  fill?: { field: string; density: NumOrParam; within?: number }
  controller: string
  sensors?: SensorDef[]
  motion?: { maxSpeed: NumOrParam; minSpeed?: NumOrParam; maxAccel?: NumOrParam }
  /** An articulated physics body. Makes this entity set a group of creatures (use with `count`). */
  body?: BodyInput
  /** The built-in oscillator that drives joints with a `drive`. */
  oscillator?: { frequency: NumOrParam }
}

/** Look of the world. Purely visual: it never affects the simulation. Every field has a default. */
export interface WorldDef {
  /** A solid color, or a gradient from `top` to `horizon`. */
  sky?: string | { top: string; horizon: string }
  /** A floor grid at the bottom of the bounds. */
  grid?: boolean
  /** Color of the bounds box. */
  boundsColor?: string
  /** "heading" colors each agent by the way it faces, or give one color for all. */
  agentColor?: 'heading' | string
  /** Cast shadows. On by default for physics scenes with terrain, off otherwise. */
  shadows?: boolean
}

export interface Scene {
  name?: string
  seed: number
  /** Ticks per second. Defaults to 60. */
  clock?: { rate: number }
  bounds?: { size: number; mode?: 'soft' | 'clamp' }
  world?: WorldDef
  /** Bumpy ground for creatures to walk on (needs an entity with a `body`). Shape changes apply on reset or respawn the creatures. */
  terrain?: TerrainDef
  /** Physics settings for scenes with a `body`. */
  physics?: { gravity?: number; substeps?: number; /** Creatures bump into each other (default true). */ collide?: boolean
    /** When to put a creature back on its feet: after lying flipped or collapsed for `after` seconds, or once it is `fallBelow` units under the world. `false` never resets. */
    respawn?: false | { after?: number; fallBelow?: number }
  }
  params: Record<string, number | ParamDef>
  entities: EntityDef[]
  metrics?: string[]
}

export type Params = Record<string, number>

const numOrParam = {
  anyOf: [{ type: 'number' }, { type: 'string', pattern: '^\\$[A-Za-z_][A-Za-z0-9_]*$' }],
}

const color = { type: 'string', pattern: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' }

export const sceneSchema = {
  $id: 'https://breve.dev/schema/scene.json',
  type: 'object',
  required: ['seed', 'params', 'entities'],
  additionalProperties: false,
  properties: {
    $schema: { type: 'string' },
    name: { type: 'string' },
    seed: { type: 'integer' },
    clock: {
      type: 'object',
      required: ['rate'],
      additionalProperties: false,
      properties: { rate: { type: 'number', exclusiveMinimum: 0, maximum: 240 } },
    },
    bounds: {
      type: 'object',
      required: ['size'],
      additionalProperties: false,
      properties: {
        size: { type: 'number', exclusiveMinimum: 0 },
        mode: { enum: ['soft', 'clamp'] },
      },
    },
    terrain: {
      type: 'object',
      additionalProperties: false,
      properties: {
        size: { type: 'number', exclusiveMinimum: 0 },
        resolution: { type: 'integer', minimum: 2, maximum: 256 },
        amplitude: { type: 'number', minimum: 0 },
        frequency: { type: 'number', exclusiveMinimum: 0 },
        octaves: { type: 'integer', minimum: 1, maximum: 6 },
        color,
        texture: { enum: ['static', 'grid', 'none'] },
      },
    },
    physics: {
      type: 'object',
      additionalProperties: false,
      properties: {
        gravity: { type: 'number' },
        substeps: { type: 'integer', minimum: 1, maximum: 16 },
        collide: { type: 'boolean' },
        respawn: {
          anyOf: [
            { const: false },
            { type: 'object', additionalProperties: false, properties: { after: { type: 'number', exclusiveMinimum: 0 }, fallBelow: { type: 'number', exclusiveMinimum: 0 } } },
          ],
        },
      },
    },
    world: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sky: {
          anyOf: [
            color,
            { type: 'object', required: ['top', 'horizon'], additionalProperties: false, properties: { top: color, horizon: color } },
          ],
        },
        grid: { type: 'boolean' },
        boundsColor: color,
        agentColor: { anyOf: [{ const: 'heading' }, color] },
        shadows: { type: 'boolean' },
      },
    },
    params: {
      type: 'object',
      additionalProperties: {
        anyOf: [
          { type: 'number' },
          {
            type: 'object',
            required: ['value'],
            additionalProperties: false,
            properties: {
              value: { type: 'number' },
              min: { type: 'number' },
              max: { type: 'number' },
              step: { type: 'number', exclusiveMinimum: 0 },
              label: { type: 'string' },
            },
          },
        ],
      },
    },
    entities: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['name', 'controller'],
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          count: numOrParam,
          lattice: {
            type: 'object',
            required: ['size', 'show'],
            additionalProperties: false,
            properties: {
              size: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 128 }, minItems: 3, maxItems: 3 },
              spacing: { type: 'number', exclusiveMinimum: 0 },
              edges: { enum: ['dead', 'wrap'] },
              neighborhood: { enum: ['moore', 'von-neumann'] },
              show: { type: 'string' },
              color: { type: 'string' },
              colorMax: { type: 'number', exclusiveMinimum: 0 },
              fade: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
          state: { type: 'object', additionalProperties: { enum: ['u8', 'i32', 'f32'] } },
          fill: {
            type: 'object',
            required: ['field', 'density'],
            additionalProperties: false,
            properties: { field: { type: 'string' }, density: numOrParam, within: { type: 'number', exclusiveMinimum: 0, maximum: 1 } },
          },
          controller: { type: 'string' },
          body: bodySchema,
          oscillator: {
            type: 'object',
            required: ['frequency'],
            additionalProperties: false,
            properties: { frequency: numOrParam },
          },
          sensors: {
            type: 'array',
            items: {
              type: 'object',
              required: ['type', 'radius'],
              additionalProperties: false,
              properties: { type: { const: 'neighbors' }, radius: numOrParam },
            },
          },
          motion: {
            type: 'object',
            required: ['maxSpeed'],
            additionalProperties: false,
            properties: { maxSpeed: numOrParam, minSpeed: numOrParam, maxAccel: numOrParam },
          },
        },
      },
    },
    metrics: { type: 'array', items: { type: 'string' } },
  },
} as const

const ajv = new Ajv({ allErrors: true, strict: false })
const validateSchema = ajv.compile(sceneSchema)

export type SceneResult = { ok: true; scene: Scene } | { ok: false; errors: string[] }

/** Parse and validate scene JSON text. Errors are written for humans, not for machines. */
export function parseScene(text: string): SceneResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { ok: false, errors: [`Invalid JSON: ${(e as Error).message}`] }
  }
  return validateScene(data)
}

export function validateScene(data: unknown): SceneResult {
  if (!validateSchema(data)) {
    const errors = (validateSchema.errors ?? [])
      .filter((e) => e.keyword !== 'anyOf')
      .map((e) => {
        const where = e.instancePath ? e.instancePath.slice(1).replace(/\//g, '.') : 'scene'
        if (e.keyword === 'additionalProperties')
          return `${where}: unknown property "${(e.params as { additionalProperty: string }).additionalProperty}"`
        if (e.keyword === 'required')
          return `${where}: missing "${(e.params as { missingProperty: string }).missingProperty}"`
        return `${where}: ${e.message}`
      })
    return { ok: false, errors: errors.length ? errors : ['scene: does not match the schema'] }
  }
  const scene = data as Scene
  const errors: string[] = []
  const names = new Set(Object.keys(scene.params))
  const check = (v: NumOrParam | undefined, where: string) => {
    if (typeof v === 'string' && !names.has(v.slice(1))) errors.push(`${where}: unknown param "${v}"`)
  }
  if (scene.entities.length !== 1) errors.push('entities: this version supports exactly one entity set')
  scene.entities.forEach((e, i) => {
    if (!e.lattice === (e.count === undefined)) errors.push(`entities.${i}: give either "count" (free agents) or "lattice" (a grid of cells)`)
    if (e.lattice) {
      const fields = Object.keys(e.state ?? {})
      if (!fields.length) errors.push(`entities.${i}.state: a lattice needs at least one state field`)
      if (!fields.includes(e.lattice.show)) errors.push(`entities.${i}.lattice.show: "${e.lattice.show}" is not a state field`)
      if (e.lattice.color && !fields.includes(e.lattice.color)) errors.push(`entities.${i}.lattice.color: "${e.lattice.color}" is not a state field`)
      if (e.fill && !fields.includes(e.fill.field)) errors.push(`entities.${i}.fill.field: "${e.fill.field}" is not a state field`)
      check(e.fill?.density, `entities.${i}.fill.density`)
    }
    check(e.count, `entities.${i}.count`)
    if (e.body) {
      if (e.lattice) errors.push(`entities.${i}.body: a lattice cannot have a body`)
      // the compact form (templates, attach) becomes the flat body the engine uses; the editor text keeps what you wrote
      const x = expandBody(e.body, `entities.${i}.body`)
      errors.push(...x.errors)
      if (!x.errors.length) {
        e.body = x.body
        errors.push(...checkBody(x.body, `entities.${i}.body`, names))
      }
      check(e.oscillator?.frequency, `entities.${i}.oscillator.frequency`)
    } else if (e.oscillator) errors.push(`entities.${i}.oscillator: needs a "body" with joint drives`)
    e.sensors?.forEach((s, j) => check(s.radius, `entities.${i}.sensors.${j}.radius`))
    if (e.motion) {
      check(e.motion.maxSpeed, `entities.${i}.motion.maxSpeed`)
      check(e.motion.minSpeed, `entities.${i}.motion.minSpeed`)
      check(e.motion.maxAccel, `entities.${i}.motion.maxAccel`)
    }
  })
  return errors.length ? { ok: false, errors } : { ok: true, scene }
}

export function paramValues(scene: Scene): Params {
  const out: Params = {}
  for (const [k, v] of Object.entries(scene.params)) out[k] = typeof v === 'number' ? v : v.value
  return out
}

export function resolve(v: NumOrParam | undefined, params: Params, fallback: number): number {
  if (v === undefined) return fallback
  if (typeof v === 'number') return v
  return params[v.slice(1)] ?? fallback
}
