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
  /** Look at another set of agents instead of this one. Needs a `name`: the script finds them at `obs.<name>`. */
  of?: string
  /** What the script calls this sensor. The set's own neighbors are `neighbors` when this is left out. */
  name?: string
}

/** How a number is stored. Scenes rarely need to say: a plain number is a `f64`. */
export type StateType = 'u8' | 'i32' | 'f32' | 'f64' | 'str'

/** What a field holds, as scripts see it. */
export type StateKind = 'number' | 'boolean' | 'string'

/** How a state field starts: a constant, or random draws from the seeded RNG. */
export type StateInit = number | boolean | string | { normal: number } | { uniform: [number, number] }

/**
 * A per-entity state field. Say what it starts as and the type follows: `"energy": 10` is a number,
 * `"hungry": false` a boolean, `"mood": "calm"` a string. An object makes an array of numbers per entity
 * (network weights: `{ "length": 24, "init": { "normal": 0.5 } }`) or spells out a type
 * (`"int"`, `"float"`, `"boolean"`, `"string"`; the small storage types `"u8"`, `"i32"` and `"f32"` also work).
 */
export type StateDef = number | boolean | string | { type?: string; length?: number; init?: StateInit }

const TYPE_WORDS: Record<string, { type: StateType; kind: StateKind }> = {
  u8: { type: 'u8', kind: 'number' }, i32: { type: 'i32', kind: 'number' }, f32: { type: 'f32', kind: 'number' },
  int: { type: 'i32', kind: 'number' }, float: { type: 'f64', kind: 'number' }, number: { type: 'f64', kind: 'number' },
  boolean: { type: 'u8', kind: 'boolean' }, string: { type: 'str', kind: 'string' },
}

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
  /** Colors for the `color` field, low to high: two or more hex colors, blended in order. Default red to green. */
  palette?: string[]
  /** For a flat grid (size 1 on one axis): how thick the drawn cells are along that axis, as a fraction of their width. Default 1. */
  thickness?: number
  /** Ease cells in and out over this fraction of a tick (0 = instant, the default; 1 = a whole tick). */
  fade?: number
}

/**
 * Nodes and the links between them. `count` of the set is the number of nodes. The neighbors a node's script
 * sees are the nodes it is linked to. Positions come from `layout` and are only for drawing.
 */
export interface NetworkDef {
  /** How links are made. Default `smallworld`. `edges` uses the list given in `edges`. */
  topology?: 'smallworld' | 'random' | 'scalefree' | 'ring' | 'complete' | 'edges'
  /** Average number of links per node (default 4). */
  degree?: number
  /** For small worlds: the share of links rewired to random nodes (default 0.1). */
  rewire?: number
  /** Explicit links as pairs of node numbers, for topology `edges`. */
  edges?: [number, number][]
  /** How to place nodes for drawing (default `force`). */
  layout?: 'force' | 'circle' | 'sphere'
  /** Size of the drawn layout in world units (default 20). */
  radius?: number
  /** State field that tints nodes, scaled by `colorMax` (default 1), through `palette` (default red to green). */
  color?: string
  colorMax?: number
  palette?: string[]
  /** How big nodes are drawn, as a multiple of the default. */
  size?: number
}

/**
 * Fill a state field at the start. `density` is the share of cells set (default 1); `within` limits it to the central
 * fraction of the grid; `region` limits it to a ball in world units around `center`; `value` is what cells get (default 1).
 */
export interface FillDef {
  field: string
  density?: NumOrParam
  within?: number
  /** Set exactly this many randomly chosen entities (networks and lattices). */
  count?: number
  value?: number
  region?: { center: [number, number, number]; radius: number }
}

/**
 * Where new entities start. `at` puts them at a point (scattered over a ball of radius `spread`), `box` anywhere
 * inside two corners; `velocity` gives them all that heading. Leave `spawn` out to scatter them through the bounds.
 */
export interface SpawnDef {
  at?: [number, number, number]
  spread?: number
  box?: [[number, number, number], [number, number, number]]
  velocity?: [number, number, number]
}

/**
 * A fence: when an entity crosses it, its controller's `onLeave({ self })` runs once. The fence changes nothing by
 * itself; `self.reset()` inside the handler puts the entity back at its start. `size` is the half-width of a box
 * around the origin, `floor` the lowest height allowed.
 */
export interface FenceDef {
  size?: NumOrParam
  floor?: NumOrParam
}

export interface EntityDef {
  name: string
  /** Which controller runs this set: the name of an export of the script. Leave it out to use `export default`. */
  type?: string
  /** A boundary that fires `onLeave` when crossed (free agents and creatures). */
  fence?: FenceDef
  /** Where entities start (free agents and creatures). */
  spawn?: SpawnDef
  /** Run this set only every n-th tick (default 1). */
  every?: number
  /** Draw color for free agents (overrides the world's agentColor). */
  color?: string
  /** How big free agents are drawn, as a multiple of the default (1). */
  size?: number
  /** Free-moving agents. Use this or `lattice`. */
  count?: NumOrParam
  lattice?: LatticeDef
  /** Nodes joined by links, instead of free agents or a grid. Use with `count`. */
  network?: NetworkDef
  /** Per-entity state: field name to storage type (lattice cells take plain types only). */
  state?: Record<string, StateDef>
  /** Fill a state field at the start: `density` of cells, within the central `within` fraction of the grid. */
  fill?: FillDef | FillDef[]
  /** The script file for this project (the same file serves every set; list it once). */
  controller?: string
  sensors?: SensorDef[]
  motion?: {
    maxSpeed: NumOrParam
    minSpeed?: NumOrParam
    maxAccel?: NumOrParam
    /** "xz" keeps agents on the ground plane (y = 0), for 2D-style worlds. */
    plane?: 'xz'
  }
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
  }
  params: Record<string, number | ParamDef>
  entities: EntityDef[]
  metrics?: string[]
  /** Draw several metrics on one chart: `[{ "title": "SIR", "metrics": ["susceptible", "infected"] }]`. Metrics not listed in any chart get their own. */
  charts?: { title?: string; metrics: string[] }[]
}

export type Params = Record<string, number>

const numOrParam = {
  anyOf: [{ type: 'number' }, { type: 'string', pattern: '^\\$[A-Za-z_][A-Za-z0-9_]*$' }],
}

const vec3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 } as const

const color = { type: 'string', pattern: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' }

const fillItem = {
  type: 'object',
  required: ['field'],
  additionalProperties: false,
  properties: {
    field: { type: 'string' },
    density: numOrParam,
    within: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
    count: { type: 'integer', minimum: 0 },
    value: { type: 'number' },
    region: {
      type: 'object',
      required: ['center', 'radius'],
      additionalProperties: false,
      properties: { center: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, radius: { type: 'number', exclusiveMinimum: 0 } },
    },
  },
} as const

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
        required: ['name'],
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          type: { type: 'string', pattern: '^[A-Za-z_$][A-Za-z0-9_$]*$' },
          fence: { type: 'object', additionalProperties: false, properties: { size: numOrParam, floor: numOrParam } },
          spawn: {
            type: 'object',
            additionalProperties: false,
            properties: {
              at: vec3,
              spread: { type: 'number', minimum: 0 },
              box: { type: 'array', items: vec3, minItems: 2, maxItems: 2 },
              velocity: vec3,
            },
          },
          every: { type: 'integer', minimum: 1, maximum: 1000 },
          color,
          size: { type: 'number', exclusiveMinimum: 0, maximum: 20 },
          count: numOrParam,
          network: {
            type: 'object',
            additionalProperties: false,
            properties: {
              topology: { enum: ['smallworld', 'random', 'scalefree', 'ring', 'complete', 'edges'] },
              degree: { type: 'number', minimum: 0 },
              rewire: { type: 'number', minimum: 0, maximum: 1 },
              edges: { type: 'array', items: { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 2, maxItems: 2 } },
              layout: { enum: ['force', 'circle', 'sphere'] },
              radius: { type: 'number', exclusiveMinimum: 0 },
              color: { type: 'string' },
              colorMax: { type: 'number', exclusiveMinimum: 0 },
              palette: { type: 'array', items: color, minItems: 2, maxItems: 8 },
              size: { type: 'number', exclusiveMinimum: 0, maximum: 20 },
            },
          },
          lattice: {
            type: 'object',
            required: ['size', 'show'],
            additionalProperties: false,
            properties: {
              size: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 2048 }, minItems: 3, maxItems: 3 },
              spacing: { type: 'number', exclusiveMinimum: 0 },
              edges: { enum: ['dead', 'wrap'] },
              neighborhood: { enum: ['moore', 'von-neumann'] },
              show: { type: 'string' },
              color: { type: 'string' },
              colorMax: { type: 'number', exclusiveMinimum: 0 },
              thickness: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
              palette: { type: 'array', items: color, minItems: 2, maxItems: 8 },
              fade: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
          state: {
            type: 'object',
            additionalProperties: {
              anyOf: [
                { type: ['number', 'boolean', 'string'] },
                {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    type: { enum: Object.keys(TYPE_WORDS) },
                    length: { type: 'integer', minimum: 1, maximum: 4096 },
                    init: {
                      anyOf: [
                        { type: ['number', 'boolean', 'string'] },
                        { type: 'object', required: ['normal'], additionalProperties: false, properties: { normal: { type: 'number' } } },
                        { type: 'object', required: ['uniform'], additionalProperties: false, properties: { uniform: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } } },
                      ],
                    },
                  },
                },
              ],
            },
          },
          fill: { anyOf: [fillItem, { type: 'array', items: fillItem }] },
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
              properties: { type: { const: 'neighbors' }, radius: numOrParam, of: { type: 'string' }, name: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' } },
            },
          },
          motion: {
            type: 'object',
            required: ['maxSpeed'],
            additionalProperties: false,
            properties: { maxSpeed: numOrParam, minSpeed: numOrParam, maxAccel: numOrParam, plane: { const: 'xz' } },
          },
        },
      },
    },
    metrics: { type: 'array', items: { type: 'string' } },
    charts: { type: 'array', items: { type: 'object', required: ['metrics'], additionalProperties: false, properties: { title: { type: 'string' }, metrics: { type: 'array', items: { type: 'string' }, minItems: 1 } } } },
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
  scene.charts?.forEach((c, i) => c.metrics.forEach((m) => { if (!(scene.metrics ?? []).includes(m)) errors.push(`charts.${i}.metrics: "${m}" is not one of the scene's metrics`) }))
  const seen = new Set<string>()
  scene.entities.forEach((e, i) => {
    if (seen.has(e.name)) errors.push(`entities.${i}.name: another set is already called "${e.name}"`)
    seen.add(e.name)
  })
  if (scene.entities.length > 1 && scene.entities.some((e) => e.body)) errors.push('entities: creatures (a set with a "body") cannot be mixed with other sets yet')
  scene.entities.forEach((e, i) => {
    if (!e.lattice === (e.count === undefined)) errors.push(`entities.${i}: give either "count" (free agents) or "lattice" (a grid of cells)`)
    if (e.lattice) {
      const fields = Object.keys(e.state ?? {})
      if (!fields.length) errors.push(`entities.${i}.state: a lattice needs at least one state field`)
      if (!fields.includes(e.lattice.show)) errors.push(`entities.${i}.lattice.show: "${e.lattice.show}" is not a state field`)
      if (e.lattice.color && !fields.includes(e.lattice.color)) errors.push(`entities.${i}.lattice.color: "${e.lattice.color}" is not a state field`)
      for (const [k, f] of fillList(e.fill).entries()) {
        if (!fields.includes(f.field)) errors.push(`entities.${i}.fill${Array.isArray(e.fill) ? '.' + k : ''}.field: "${f.field}" is not a state field`)
        check(f.density, `entities.${i}.fill.density`)
      }
      for (const [k, d] of Object.entries(e.state ?? {}))
        if (typeof d === 'object' && d.length !== undefined) errors.push(`entities.${i}.state.${k}: lattice cells hold one value per field, not an array`)
    }
    if (e.network) {
      if (e.lattice || e.body) errors.push(`entities.${i}.network: a set is a network, a lattice or creatures, not several`)
      if (e.count === undefined) errors.push(`entities.${i}.count: a network needs "count", the number of nodes`)
      const fields = stateFields(e.state).map((f) => f.name)
      if (e.network.color && !fields.includes(e.network.color)) errors.push(`entities.${i}.network.color: "${e.network.color}" is not a state field`)
      if (e.network.topology === 'edges' && !e.network.edges) errors.push(`entities.${i}.network.edges: topology "edges" needs the list of links`)
      for (const [k, f] of fillList(e.fill).entries())
        if (!fields.includes(f.field)) errors.push(`entities.${i}.fill${Array.isArray(e.fill) ? '.' + k : ''}.field: "${f.field}" is not a state field`)
    }
    if (e.spawn?.at && e.spawn.box) errors.push(`entities.${i}.spawn: give "at" or "box", not both`)
    if (e.spawn?.spread !== undefined && !e.spawn.at) errors.push(`entities.${i}.spawn.spread: "spread" scatters entities around "at"`)
    check(e.fence?.size, `entities.${i}.fence.size`)
    check(e.fence?.floor, `entities.${i}.fence.floor`)
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
    e.sensors?.forEach((s, j) => {
      check(s.radius, `entities.${i}.sensors.${j}.radius`)
      const target = scene.entities.find((x) => x.name === s.of)
      if (s.of !== undefined && !target) errors.push(`entities.${i}.sensors.${j}.of: there is no set called "${s.of}" (the scene has: ${scene.entities.map((x) => x.name).join(', ')})`)
      else if (target && (target.lattice || target.body)) errors.push(`entities.${i}.sensors.${j}.of: "${s.of}" is not a set of free agents`)
      if (s.of !== undefined && s.of !== e.name && !s.name) errors.push(`entities.${i}.sensors.${j}.name: a sensor on another set needs a name, so the script can find it at obs.<name>`)
      if (s.name === 'self') errors.push(`entities.${i}.sensors.${j}.name: "self" is taken`)
    })
    if (e.motion) {
      check(e.motion.maxSpeed, `entities.${i}.motion.maxSpeed`)
      check(e.motion.minSpeed, `entities.${i}.motion.minSpeed`)
      check(e.motion.maxAccel, `entities.${i}.motion.maxAccel`)
    }
  })
  return errors.length ? { ok: false, errors } : { ok: true, scene }
}

export interface StateField {
  name: string
  /** How it is stored. */
  type: StateType
  /** What scripts see: a number, a boolean (stored 0/1) or a string. */
  kind: StateKind
  /** Values per entity: 1 unless the field is an array. */
  length: number
  array: boolean
  init?: StateInit
}

/** Every state field of an entity set in one shape: a name, how it is stored, what it holds, and how it starts. */
export function stateFields(state: Record<string, StateDef> | undefined): StateField[] {
  return Object.entries(state ?? {}).map(([name, d]): StateField => {
    if (typeof d === 'number') return { name, type: 'f64', kind: 'number', length: 1, array: false, init: d }
    if (typeof d === 'boolean') return { name, type: 'u8', kind: 'boolean', length: 1, array: false, init: d }
    if (typeof d === 'string') {
      const w = TYPE_WORDS[d]
      return w ? { name, ...w, length: 1, array: false } : { name, type: 'str', kind: 'string', length: 1, array: false, init: d }
    }
    const init = d.init
    const w = d.type ? TYPE_WORDS[d.type] : typeof init === 'boolean' ? TYPE_WORDS.boolean : typeof init === 'string' ? TYPE_WORDS.string : TYPE_WORDS.float
    return { name, ...(w ?? TYPE_WORDS.float), length: d.length ?? 1, array: d.length !== undefined, init }
  })
}

export function fillList(f: FillDef | FillDef[] | undefined): FillDef[] {
  return f === undefined ? [] : Array.isArray(f) ? f : [f]
}

export function paramValues(scene: Scene): Params {
  const out: Params = {}
  for (const [k, v] of Object.entries(scene.params)) out[k] = typeof v === 'number' ? v : v.value
  return out
}

/** A copy of the scene with some params set to new values (their ranges are kept). */
export function withParams(scene: Scene, values: Params): Scene {
  const out = structuredClone(scene)
  for (const [k, v] of Object.entries(values)) {
    if (!(k in out.params)) throw new Error(`there is no param "${k}" (the scene has: ${Object.keys(out.params).join(', ')})`)
    const cur = out.params[k]
    out.params[k] = typeof cur === 'number' ? v : { ...cur, value: v }
  }
  return out
}

export function resolve(v: NumOrParam | undefined, params: Params, fallback: number): number {
  if (v === undefined) return fallback
  if (typeof v === 'number') return v
  return params[v.slice(1)] ?? fallback
}
