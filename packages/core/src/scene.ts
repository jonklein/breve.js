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
  layout?: 'force' | 'circle' | 'sphere' | 'grid' | 'random' | 'radial'
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
  /** How this set is drawn (purely visual): its shape and its surface. Colors come from `color`, the world's `agentColor`, or the script's `display`. */
  style?: SetStyle
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

/** How the things in one entity set look. */
export interface SetStyle {
  /** What each agent or node is drawn as: `cone` (the default for agents, pointing the way they move), `sphere`, `cube`, `rounded` (a cube with soft edges), `capsule`, `octahedron`, `tetrahedron`, `disc`, `cylinder`. Lattice cells are cubes and nodes are spheres unless this says otherwise. */
  shape?: 'cone' | 'sphere' | 'cube' | 'rounded' | 'capsule' | 'octahedron' | 'tetrahedron' | 'disc' | 'cylinder'
  /** Surface: `roughness` 0 (mirror) to 1 (matte), `metalness` 0 to 1, `glow` how much the color lights itself (0 none, 1 as bright as lit, above 1 glows), `opacity` 0 to 1. */
  material?: { roughness?: number; metalness?: number; glow?: number; opacity?: number }
  /** A fading line behind each agent: how many ticks long (up to 240), or `{ length, strength }` (strength scales brightness, default 1). */
  trail?: number | { length?: number; strength?: number }
  /**
   * Draw each agent as a flat picture instead of a shape: `{ "image": "ant.svg", "facing": "ground" }` (PNG, SVG, JPEG; a path next to the
   * scene or a URL; see-through parts of the image stay see-through; draw it facing up). The entity's `size` is the picture's width in world
   * units, and `color` tints it (white leaves it as drawn). `facing` is `ground` (the picture lies flat and turns to point the way the
   * agent moves, as seen from above) or `camera` (the default: it always faces the viewer, and with `turn` is rotated on screen to point
   * the way the agent moves).
   */
  sprite?: { image: string; facing?: 'camera' | 'ground'; turn?: boolean }
}

/** The patterns a generated texture can be. */
export const TEXTURE_KINDS = ['noise', 'fbm', 'checker', 'stripes', 'grid', 'dots', 'bricks', 'marble', 'grass', 'sand', 'water', 'url'] as const

/**
 * A surface texture, either picked by name (`"grass"`) or described: a generated `kind` (made from a few numbers, the same every time,
 * and seamless when repeated) or an image from a `url`. Purely visual.
 */
export type TextureDef = (typeof TEXTURE_KINDS)[number] | {
  kind?: (typeof TEXTURE_KINDS)[number]
  /** Image to load, for kind `url` (relative paths start at the project's assets). */
  url?: string
  /** Colors the pattern blends between, dark to light or as the pattern calls for (two or more). */
  colors?: string[]
  /** How many pattern cells across one tile (default depends on the kind). */
  scale?: number
  /** Changes the pattern while keeping its style. */
  seed?: number
  /** Stronger or weaker differences between the colors, 0 to 2 (default 1). */
  contrast?: number
  /** How strongly the pattern bumps the surface, 0 to 4 (default 1; 0 turns bumps off). */
  bump?: number
  /** World units one repeat of the texture covers (default 10). */
  tile?: number
}

/** A ground plane for scenes that have no terrain of their own. */
export interface FloorDef {
  /** Base color (shows through the texture). */
  color?: string
  texture?: TextureDef
  /** Height of the floor in world units. Default: the bottom of the world box. */
  y?: number
  /** Edge length (default 12 times the world's size, so it reaches the haze). */
  size?: number
  /** 0 (mirror) to 1 (matte). Default 0.9. */
  roughness?: number
  /** 0 (plastic or earth) to 1 (metal). Default 0. */
  metalness?: number
}

/** Look of the world. Purely visual: it never affects the simulation. Every field has a default. */
export interface WorldDef {
  /**
   * A ready-made look to start from; every other field here overrides it. `day`, `dusk`, `night`, `studio`, `space`,
   * or `plain` (the older flat look). With no `world` block at all, the look is `dusk`.
   */
  preset?: 'day' | 'dusk' | 'night' | 'studio' | 'space' | 'plain'
  /** A solid color, or a gradient from `top` to `horizon`. */
  sky?: string | { top: string; horizon: string; ground?: string; /** 0 to 1: how many stars. */ stars?: number; /** 0 to 1: how much cloud. */ clouds?: number; /** Draw a sun disc and glow where the light comes from (default: on for day and dusk). */ sun?: boolean }
  /**
   * Distance haze. `true` uses the preset's; `false` turns it off. Give `near` and `far` (distances from the camera) for linear fog,
   * or a `density` for exponential fog. `color` defaults to the horizon color of the sky.
   */
  fog?: boolean | { color?: string; near?: number; far?: number; density?: number }
  /** Lighting. Angles are in degrees: `azimuth` turns the sun around the vertical axis from +x toward +z, `elevation` lifts it above the horizon. */
  light?: {
    sun?: { color?: string; intensity?: number; azimuth?: number; elevation?: number }
    ambient?: { color?: string; intensity?: number }
    hemisphere?: { sky?: string; ground?: string; intensity?: number }
    /** Overall brightness (default 1). */
    exposure?: number
    /** How bright values are squeezed into the screen's range: `none`, `aces` (filmic) or `neutral`. */
    toneMapping?: 'none' | 'aces' | 'neutral'
  }
  /** How strongly shiny surfaces mirror the sky, 0 (not at all) to 2. `true` uses the preset's. */
  reflections?: boolean | number
  /**
   * Screen effects: `bloom` (bright things glow), `ao` (contact shading in creases and under things), `vignette` (darker corners, 0 to 1),
   * `saturation` and `contrast` (color grading, 1 is unchanged). `true` or `false` turns the preset's set on or off.
   */
  effects?: boolean | {
    bloom?: boolean | { strength?: number; radius?: number; threshold?: number }
    ao?: boolean | { radius?: number; intensity?: number }
    vignette?: number
    saturation?: number
    contrast?: number
  }
  /** Where the camera starts (you can still orbit): `distance` as a multiple of the world's size (default 2.5), `elevation` and `azimuth` in degrees (defaults 23 and 45), `fov` field of view in degrees (default 55). */
  camera?: { distance?: number; elevation?: number; azimuth?: number; fov?: number }
  /** A ground plane, for scenes without terrain: `{ "texture": "grass" }`, `{ "color": "#222", "y": -1 }`. `false` or leaving it out draws none. */
  floor?: false | FloorDef
  /** A floor grid at the bottom of the bounds. */
  grid?: boolean
  /** Color of the bounds box. */
  boundsColor?: string
  /** Draw the outline of the world's box (default true). Turn it off for a scene that reads better as open ground. */
  frame?: boolean
  /** "heading" colors each agent by the way it faces, or give one color for all. */
  agentColor?: 'heading' | string
  /** Cast shadows: `true`/`false`, or settings: `softness` (blur, 0 to 4), `resolution` (shadow map size) and `bias`. On by default for physics scenes with terrain, off otherwise. */
  shadows?: boolean | { softness?: number; resolution?: 512 | 1024 | 2048 | 4096; bias?: number }
  /** Poles standing on the ground at fixed spots, so you can see how far things have gone. Drawn only: nothing collides with them. */
  markers?: { /** Where, on the ground: [x, z]. */ at: [number, number]; /** Pole height in world units. Default 2. */ height?: number; color?: string }[]
  /** Physics scenes: the camera follows the first body of the first creature, keeping whatever angle and distance you orbit to. Default false. */
  follow?: boolean
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
  /**
   * Buttons in the control panel that pick a value for one field of this scene: `{ "label": "Layout", "set": "entities.0.network.layout",
   * "options": ["force", "circle"] }`. Clicking one rewrites the field and restarts the scene, so it works for anything the scene says.
   */
  controls?: ControlDef[]
}

export type ControlValue = string | number | boolean

/** One button that sets several fields at once: `{ "label": "stripes", "values": { "params.feed.value": 0.078, "params.kill.value": 0.061 } }`. */
export interface Preset {
  label: string
  values: Record<string, ControlValue>
}

/** Either `set` and `options` (a row of choices for one field) or `presets` (each button sets several fields). */
export interface ControlDef {
  label?: string
  /** Dotted path to the field, with array positions as numbers. */
  set?: string
  options?: ControlValue[]
  presets?: Preset[]
}

export type Params = Record<string, number>

const numOrParam = {
  anyOf: [{ type: 'number' }, { type: 'string', pattern: '^\\$[A-Za-z_][A-Za-z0-9_]*$' }],
}

const vec3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 } as const

const textureDef = {
  anyOf: [
    { enum: [...TEXTURE_KINDS] },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { enum: [...TEXTURE_KINDS] },
        url: { type: 'string', minLength: 1 },
        colors: { type: 'array', items: { type: 'string', pattern: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' }, minItems: 2, maxItems: 8 },
        scale: { type: 'number', exclusiveMinimum: 0, maximum: 256 },
        seed: { type: 'integer' },
        contrast: { type: 'number', minimum: 0, maximum: 2 },
        bump: { type: 'number', minimum: 0, maximum: 4 },
        tile: { type: 'number', exclusiveMinimum: 0 },
      },
    },
  ],
} as const

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
        texture: { anyOf: [{ enum: ['static', 'grid', 'none'] }, textureDef] },
        palette: { type: 'object', additionalProperties: false, properties: { low: color, mid: color, high: color, steep: color } },
        shading: { enum: ['smooth', 'flat'] },
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
        preset: { enum: ['day', 'dusk', 'night', 'studio', 'space', 'plain'] },
        fog: {
          anyOf: [
            { type: 'boolean' },
            { type: 'object', additionalProperties: false, properties: { color, near: { type: 'number', minimum: 0 }, far: { type: 'number', exclusiveMinimum: 0 }, density: { type: 'number', exclusiveMinimum: 0 } } },
          ],
        },
        light: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sun: { type: 'object', additionalProperties: false, properties: { color, intensity: { type: 'number', minimum: 0 }, azimuth: { type: 'number' }, elevation: { type: 'number', minimum: -90, maximum: 90 } } },
            ambient: { type: 'object', additionalProperties: false, properties: { color, intensity: { type: 'number', minimum: 0 } } },
            hemisphere: { type: 'object', additionalProperties: false, properties: { sky: color, ground: color, intensity: { type: 'number', minimum: 0 } } },
            exposure: { type: 'number', exclusiveMinimum: 0, maximum: 10 },
            toneMapping: { enum: ['none', 'aces', 'neutral'] },
          },
        },
        reflections: { anyOf: [{ type: 'boolean' }, { type: 'number', minimum: 0, maximum: 2 }] },
        effects: {
          anyOf: [
            { type: 'boolean' },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                bloom: { anyOf: [{ type: 'boolean' }, { type: 'object', additionalProperties: false, properties: { strength: { type: 'number', minimum: 0, maximum: 5 }, radius: { type: 'number', minimum: 0, maximum: 1.5 }, threshold: { type: 'number', minimum: 0, maximum: 5 } } }] },
                ao: { anyOf: [{ type: 'boolean' }, { type: 'object', additionalProperties: false, properties: { radius: { type: 'number', exclusiveMinimum: 0 }, intensity: { type: 'number', minimum: 0, maximum: 4 } } }] },
                vignette: { type: 'number', minimum: 0, maximum: 1 },
                saturation: { type: 'number', minimum: 0, maximum: 3 },
                contrast: { type: 'number', minimum: 0.2, maximum: 3 },
              },
            },
          ],
        },
        camera: { type: 'object', additionalProperties: false, properties: { distance: { type: 'number', exclusiveMinimum: 0, maximum: 20 }, elevation: { type: 'number', minimum: -10, maximum: 89 }, azimuth: { type: 'number' }, fov: { type: 'number', minimum: 10, maximum: 120 } } },
        floor: {
          anyOf: [
            { const: false },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                color,
                texture: textureDef,
                y: { type: 'number' },
                size: { type: 'number', exclusiveMinimum: 0 },
                roughness: { type: 'number', minimum: 0, maximum: 1 },
                metalness: { type: 'number', minimum: 0, maximum: 1 },
              },
            },
          ],
        },
        sky: {
          anyOf: [
            color,
            { type: 'object', required: ['top', 'horizon'], additionalProperties: false, properties: { top: color, horizon: color, ground: color, stars: { type: 'number', minimum: 0, maximum: 1 }, clouds: { type: 'number', minimum: 0, maximum: 1 }, sun: { type: 'boolean' } } },
          ],
        },
        grid: { type: 'boolean' },
        boundsColor: color,
        frame: { type: 'boolean' },
        agentColor: { anyOf: [{ const: 'heading' }, color] },
        shadows: {
          anyOf: [
            { type: 'boolean' },
            { type: 'object', additionalProperties: false, properties: { softness: { type: 'number', minimum: 0, maximum: 4 }, resolution: { enum: [512, 1024, 2048, 4096] }, bias: { type: 'number' } } },
          ],
        },
        markers: {
          type: 'array',
          items: {
            type: 'object', required: ['at'], additionalProperties: false,
            properties: { at: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, height: { type: 'number', exclusiveMinimum: 0 }, color },
          },
        },
        follow: { type: 'boolean' },
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
          style: {
            type: 'object',
            additionalProperties: false,
            properties: {
              shape: { enum: ['cone', 'sphere', 'cube', 'rounded', 'capsule', 'octahedron', 'tetrahedron', 'disc', 'cylinder'] },
              material: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  roughness: { type: 'number', minimum: 0, maximum: 1 },
                  metalness: { type: 'number', minimum: 0, maximum: 1 },
                  glow: { type: 'number', minimum: 0, maximum: 8 },
                  opacity: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
                },
              },
              sprite: { type: 'object', required: ['image'], additionalProperties: false, properties: { image: { type: 'string', minLength: 1 }, facing: { enum: ['camera', 'ground'] }, turn: { type: 'boolean' } } },
              trail: { anyOf: [{ type: 'number', minimum: 0, maximum: 240 }, { type: 'object', additionalProperties: false, properties: { length: { type: 'number', minimum: 0, maximum: 240 }, strength: { type: 'number', minimum: 0, maximum: 4 } } }] },
            },
          },
          count: numOrParam,
          network: {
            type: 'object',
            additionalProperties: false,
            properties: {
              topology: { enum: ['smallworld', 'random', 'scalefree', 'ring', 'complete', 'edges'] },
              degree: { type: 'number', minimum: 0 },
              rewire: { type: 'number', minimum: 0, maximum: 1 },
              edges: { type: 'array', items: { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 2, maxItems: 2 } },
              layout: { enum: ['force', 'circle', 'sphere', 'grid', 'random', 'radial'] },
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
    controls: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string' },
          set: { type: 'string', pattern: '^[^.\\s]+(\\.[^.\\s]+)*$' },
          options: { type: 'array', items: { type: ['string', 'number', 'boolean'] }, minItems: 2 },
          presets: {
            type: 'array',
            minItems: 2,
            items: {
              type: 'object',
              required: ['label', 'values'],
              additionalProperties: false,
              properties: {
                label: { type: 'string' },
                values: { type: 'object', minProperties: 1, additionalProperties: { type: ['string', 'number', 'boolean'] } },
              },
            },
          },
        },
        oneOf: [{ required: ['set', 'options'], not: { required: ['presets'] } }, { required: ['presets'], not: { anyOf: [{ required: ['set'] }, { required: ['options'] }] } }],
      },
    },
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
  'set.fence': "check where it is in the script's act and move it yourself, for example `return { place: self.y < -20 ? { x: 0, z: 0 } : undefined }` (creatures) or `return { place: { position: [0, 0, 0] } }` (agents)",
  'set.oscillator': "swing the joints from the script (the stdlib's `Gait` helps), for example `return { joints: Gait.targets(legs, phase) }`",
  'joint.drive': "swing the joint from the script, for example `act({ self }, p, ctx) { return { joints: { hip: 0.5 * Math.sin(ctx.tick / 10) } } }`, or use the stdlib's `Gait`",
  'bounds.mode': "keep entities inside yourself with the stdlib's Bounds: `ctx.bounds.soft(self.position, ctx.world.size)` added to the steering, or `ctx.bounds.bounce(self.position, self.velocity, ctx.world.size)` returned as `place`",
  'look.show': "say what is drawn in the script's display, for example `display({ self }) { return { visible: self.alive } }`",
  'look.color': "say the color in the script's display, for example `display({ self }, p, ctx) { return { color: ctx.colors.gradient(['#ff0d0d', '#0dff0d'], self.age / 20) } }`",
  'look.colorMax': "scale the value yourself in the script's display (for example `self.age / 20`)",
  'look.palette': "give the colors in the script's display (`ctx.colors.gradient(['#4f86f7', '#ffd34a'], t)`)",
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
