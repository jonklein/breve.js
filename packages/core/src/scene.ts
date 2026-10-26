import Ajv from 'ajv'
import { bodySchema, buildBody, type BodyInput } from './body'
import type { TerrainDef } from './terrain'

export type NumOrParam = number | string // a number, or "$paramName"

export interface ParamDef {
  value: number
  min?: number
  max?: number
  step?: number
  label?: string
}

export interface ModelDef {
  /** Where the model file is: a path or URL, or `hf:owner/repo/path/to/model.onnx` for a file on the Hugging Face Hub (`hf:owner/repo@revision/path` to pin a revision). */
  url: string
  /** `cpu` (default; repeatable) or `webgpu` (faster where the browser has it, but results can differ a little between machines). */
  device?: 'cpu' | 'webgpu'
}

export interface SensorDef {
  /** `neighbors`: the agents near this one, or linked to it. `camera`: a small top-down picture of its surroundings (see `size` and `range`), made when a script reads it. */
  type: 'neighbors' | 'camera'
  /** camera only: pixels along each side of the picture. Default 32. */
  size?: number
  /** How far to look. Needed unless the sensor has a `via`. */
  radius?: NumOrParam
  /** Look at another set of agents instead of this one. Needs a `name`: the script finds them at `obs.<name>`. */
  of?: string
  /** Use the agents linked by this relation (`ctx.relations.get(name)`) instead of the ones within `radius`. */
  via?: string
  /** What the script calls this sensor. The set's own neighbors are `neighbors` when this is left out. */
  name?: string
}

/** How a number is stored. Scenes rarely need to say: a plain number is a `f64`. */
export type StateType = 'u8' | 'i32' | 'f32' | 'f64' | 'str'

/** What a field holds, as scripts see it. */
export type StateKind = 'number' | 'boolean' | 'string'

/** A 3D grid of cells with implicit neighbors. Each cell is an entity. */
export interface LatticeDef {
  size: [number, number, number]
  /** World units between cell centers. */
  spacing?: number
  /** What happens at the edge: cells beyond it are "dead" (absent), or the grid wraps around. */
  edges?: 'dead' | 'wrap'
  neighborhood?: 'moore' | 'von-neumann'
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
  /** How big nodes are drawn, as a multiple of the default. */
  size?: number
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

export interface EntityDef {
  name: string
  /** Which controller runs this set: the name of an export of the script. Leave it out to use `export default`. */
  type?: string
  /** Where entities start (free agents and creatures). */
  spawn?: SpawnDef
  /** How often the controller's slow `think` runs (it may call a language model). */
  think?: { every?: number }
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
  /** The size of the world: the half-width of the box around the origin that is drawn and that scripts read as `ctx.world.size`. The engine keeps nothing inside it. */
  bounds?: { size: number }
  world?: WorldDef
  /** Bumpy ground for creatures to walk on (needs an entity with a `body`). Shape changes apply on reset or respawn the creatures. */
  terrain?: TerrainDef
  /** Physics settings for scenes with a `body`. */
  physics?: { /** Which physics engine runs the creatures: `rapier` (the default, deterministic everywhere) or another registered by the host, such as `mujoco`. */ engine?: string; gravity?: number; substeps?: number; /** A floor on how hard each part is to spin: its rotational inertia is at least mass times this many metres squared. Thin, light parts joined to heavy ones can otherwise be whipped around by the joint solver and throw the whole creature. Default 0 (off); 0.3 steadies random blocky bodies. */ minGyration?: number; /** Creatures bump into each other (default true). */ collide?: boolean
  }
  params: Record<string, number | ParamDef>
  /**
   * Trained models the scene uses, by name: `"models": { "policy": { "url": "policy.onnx" } }`. The host loads them
   * (see `@breve/inference`); a controller's `think` or `thinkAll` runs one with `ctx.model('policy')`.
   */
  models?: Record<string, ModelDef>
  /**
   * Plain JSON the scene hands its scripts as `ctx.data`: what is too structured for a slider, such as the genome a parent gives a sub-sim
   * (a body plan, a list of weights). Fixed for the run; sliders stay in `params`.
   */
  data?: Record<string, unknown>
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
        engine: { type: 'string' },
        gravity: { type: 'number' },
        substeps: { type: 'integer', minimum: 1, maximum: 16 },
        minGyration: { type: 'number', minimum: 0, maximum: 2 },
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
    models: {
      type: 'object',
      additionalProperties: {
        type: 'object', required: ['url'], additionalProperties: false,
        properties: { url: { type: 'string', minLength: 1 }, device: { enum: ['cpu', 'webgpu'] } },
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
          think: { type: 'object', additionalProperties: false, properties: { every: { type: 'integer', minimum: 1 } } },
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
              size: { type: 'number', exclusiveMinimum: 0, maximum: 20 },
            },
          },
          lattice: {
            type: 'object',
            required: ['size'],
            additionalProperties: false,
            properties: {
              size: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 2048 }, minItems: 3, maxItems: 3 },
              spacing: { type: 'number', exclusiveMinimum: 0 },
              edges: { enum: ['dead', 'wrap'] },
              neighborhood: { enum: ['moore', 'von-neumann'] },
              thickness: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
              fade: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
          controller: { type: 'string' },
          body: bodySchema,
          sensors: {
            type: 'array',
            items: {
              type: 'object',
              required: ['type'],
              additionalProperties: false,
              properties: { type: { enum: ['neighbors', 'camera'] }, size: { type: 'integer', minimum: 4, maximum: 256 }, radius: numOrParam, via: { type: 'string', minLength: 1 }, of: { type: 'string' }, name: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' } },
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
    data: { type: 'object' },
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

/** Scene settings that moved into the script, by where they were (`set`: on a set; `look`: in its lattice or network). */
const REMOVED: Record<string, string> = {
  'set.state': "a set's state is what its script's init returns, for example `init() { return { alive: 0, age: 0 } }`",
  'set.fill': "set starting values in the script's init (or initAll), for example `init(self, p, ctx) { return { alive: ctx.random() < p.density ? 1 : 0 } }`",
  'set.fence': "check where it is in the script's act and move it yourself, for example `if (self.y < -20) self.place({ x: 0, z: 0 })` (creatures) or `self.place({ position: [0, 0, 0] })` (agents)",
  'set.oscillator': "swing the joints from the script (the stdlib's `Gait` helps), for example `return { joints: Gait.targets(legs, phase) }`",
  'joint.drive': "swing the joint from the script, for example `act({ self }, p, ctx) { return { joints: { hip: 0.5 * Math.sin(ctx.tick / 10) } } }`, or use the stdlib's `Gait`",
  'bounds.mode': "keep entities inside yourself with the stdlib's Bounds: `ctx.bounds.soft(self.position, ctx.world.size)` added to the steering, or `ctx.bounds.bounce(self.position, self.velocity, ctx.world.size)` handed to `self.place(...)`",
  'look.show': "say what is drawn in the script's display, for example `display({ self }) { return { visible: self.alive } }`",
  'look.color': "say the color in the script's display, for example `display({ self }, p, ctx) { return { color: ctx.colors.ramp(['#ff0d0d', '#0dff0d'], self.age / 20) } }`",
  'look.colorMax': "scale the value yourself in the script's display (for example `self.age / 20`)",
  'look.palette': "give the colors in the script's display (`ctx.colors.ramp(['#4f86f7', '#ffd34a'], t)`)",
}

export function validateScene(data: unknown): SceneResult {
  if (!validateSchema(data)) {
    const errors = (validateSchema.errors ?? [])
      .filter((e) => e.keyword !== 'anyOf')
      .map((e) => {
        const where = e.instancePath ? e.instancePath.slice(1).replace(/\//g, '.') : 'scene'
        if (e.keyword === 'additionalProperties') {
          const prop = (e.params as { additionalProperty: string }).additionalProperty
          const gone = REMOVED[`${/^entities\.\d+\.(lattice|network)$/.test(where) ? 'look' : /^entities\.\d+$/.test(where) ? 'set' : where === 'bounds' ? 'bounds' : /\.joints\.\d+$/.test(where) ? 'joint' : ''}.${prop}`]
          return gone ? `${where}: "${prop}" is gone: ${gone}` : `${where}: unknown property "${prop}"`
        }
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
    if (e.network) {
      if (e.lattice || e.body) errors.push(`entities.${i}.network: a set is a network, a lattice or creatures, not several`)
      if (e.count === undefined) errors.push(`entities.${i}.count: a network needs "count", the number of nodes`)
      if (e.network.topology === 'edges' && !e.network.edges) errors.push(`entities.${i}.network.edges: topology "edges" needs the list of links`)
    }
    if (e.spawn?.at && e.spawn.box) errors.push(`entities.${i}.spawn: give "at" or "box", not both`)
    if (e.spawn?.spread !== undefined && !e.spawn.at) errors.push(`entities.${i}.spawn.spread: "spread" scatters entities around "at"`)
    check(e.count, `entities.${i}.count`)
    if (e.body) {
      if (e.lattice) errors.push(`entities.${i}.body: a lattice cannot have a body`)
      // check the body as it comes out at the params' starting values; the engine rebuilds it whenever params change
      errors.push(...buildBody(e.body, paramValues(scene), `entities.${i}.body`, names).errors)
    }
    e.sensors?.forEach((s, j) => {
      check(s.radius, `entities.${i}.sensors.${j}.radius`)
      if (s.type === 'camera') {
        if (!s.name) errors.push(`entities.${i}.sensors.${j}.name: a camera needs a name, so the script can find its picture at obs.<name>`)
        if (s.radius === undefined) errors.push(`entities.${i}.sensors.${j}.radius: how far the camera sees (world units from the center to the edge of the picture)`)
        if (s.via !== undefined || s.of !== undefined) errors.push(`entities.${i}.sensors.${j}: a camera has no "via" or "of"`)
        return
      }
      if (s.size !== undefined) errors.push(`entities.${i}.sensors.${j}.size: only a camera has a size`)
      if (s.radius === undefined && !s.via) errors.push(`entities.${i}.sensors.${j}: give a "radius" (look at nearby agents) or a "via" (look at the agents a relation links to)`)
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
}

/**
 * The state field a value shows. A number is a number, `true`/`false` a boolean, text is text, and an array of numbers is a
 * field of that length, stored as its own kind of array (`Uint8Array` one byte a value, `Int32Array`, `Float32Array`; a plain
 * array is full precision). Null for anything else (objects, empty arrays).
 */
export function fieldOfValue(name: string, v: unknown): StateField | null {
  if (typeof v === 'number') return { name, type: 'f64', kind: 'number', length: 1, array: false }
  if (typeof v === 'boolean') return { name, type: 'u8', kind: 'boolean', length: 1, array: false }
  if (typeof v === 'string') return { name, type: 'str', kind: 'string', length: 1, array: false }
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const a = v as ArrayLike<unknown>
    if (!a.length || typeof a[0] !== 'number') return null
    return { name, type: storageOf(v), kind: 'number', length: a.length, array: true }
  }
  return null
}

/** The field one value per entity makes when it comes as a column (`initAll`): the column's kind sets how it is stored. */
export function fieldOfColumn(name: string, col: ArrayLike<unknown>): StateField | null {
  const first = col[0]
  if (typeof first === 'boolean') return { name, type: 'u8', kind: 'boolean', length: 1, array: false }
  if (typeof first === 'string') return { name, type: 'str', kind: 'string', length: 1, array: false }
  if (typeof first === 'number') return { name, type: storageOf(col), kind: 'number', length: 1, array: false }
  return null
}

function storageOf(a: unknown): StateType {
  return a instanceof Float32Array ? 'f32' : a instanceof Uint8Array ? 'u8' : a instanceof Int32Array ? 'i32' : 'f64'
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
