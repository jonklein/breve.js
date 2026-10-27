import { fromEuler, mul, toEuler } from './rot'
import Ajv from 'ajv'
import { evalNumber } from './expr'
import type { NumOrParam, Params } from './scene'

export type ShapeKind = 'box' | 'sphere' | 'capsule' | 'cylinder' | 'mesh'
export type Vec3Tuple = [number, number, number]

/**
 * One rigid piece of a creature. Sizes: box `[width, height, depth]`, sphere `[radius]`,
 * capsule and cylinder `[length, radius]` (long axis is y, `length` is the straight section). A `mesh` has no size to write: its shape is the
 * convex hull of the model named by `visual`, found when the sim is built (`resolveMeshes`), which then fills in `points` and `size` (the hull's extent).
 */
export interface PartDef {
  name: string
  shape: ShapeKind
  size: number[]
  /** Mesh parts, once resolved: the model's vertices as x, y, z triples in the part's own frame (scale, rotation and offset of `visual` applied). */
  points?: number[]
  /** Kilograms. */
  mass: number
  /** Where the part's center sits in the standing pose, relative to the creature's origin. x is forward, y is up. */
  position: Vec3Tuple
  /**
   * What to draw instead of the primitive shape: a glTF/GLB model (all of its meshes merged into one). With a primitive `shape`, physics still uses
   * `shape` and `size` and the picture is only the picture; with `"shape": "mesh"` the model is the shape too (its convex hull). `gltf` is a path next to the scene (or a full URL). The model's origin sits at the part's center;
   * `scale` (a number, or three for each axis), `rotation` (radians about x, y, z) and `offset` adjust it.
   */
  visual?: { gltf: string; scale?: number | Vec3Tuple; rotation?: Vec3Tuple; offset?: Vec3Tuple }
  /** Turns the shape about its own center (radians about x, then y, then z). Joints and axes stay where they are; only the part's collider and drawing turn. */
  rotation?: Vec3Tuple
  color?: string
  friction?: number
}

/** What a hinge motor does: chase a target like a spring with damping, within limits on how hard and how fast. */
export interface MotorDef {
  /** Torque per radian of error. */
  stiffness?: NumOrParam
  /** Torque per radian per second. */
  damping?: NumOrParam
  /** The most torque (newton-metres) the motor can ever apply. A real muscle has a limit; without one a motor given a far-off target pushes as hard as its stiffness says, however small the limb. */
  maxTorque?: NumOrParam
  /** The fastest the target may move (radians per second). A script that jumps the target from one end of the range to the other is eased there at this speed. */
  maxSpeed?: NumOrParam
}

export interface JointDef {
  name: string
  /** "hinge" turns around one axis (can have limits and a motor), "ball" turns freely, "fixed" welds. */
  type?: 'hinge' | 'ball' | 'fixed'
  parent: string
  child: string
  /** Where the joint sits in the standing pose, in the same coordinates as part positions. */
  anchor: Vec3Tuple
  /** Hinge axis (default `[0, 0, 1]`, sideways, so legs swing forward and back). */
  axis?: Vec3Tuple
  /** Hinge angle range in radians. */
  limits?: [number, number]
  /** A motor makes the joint chase a target angle like a spring with damping (torque per radian, torque per radian per second). Its target is 0 unless `act` returns one by joint name. Say `"motor": {}` to take the body's default motor. */
  motor?: MotorDef
}

/** What a creature can sense; `act` only sees what is declared. */
export type SensorDef =
  | { type: 'joints' }
  | { type: 'pose' }
  | { type: 'touch'; parts?: string[] }
  /** Every part's pose, velocity and shape, as `self.parts.<name>`: what forces that depend on motion (drag, lift) need to read. */
  | { type: 'parts' }

export interface BodyDef {
  /** The first part is the root (the torso). Every other part hangs off it through exactly one joint. */
  parts: PartDef[]
  joints?: JointDef[]
  /** Each joint with a motor is an actuator; `act` can return targets for them by name. */
  sensors?: SensorDef[]
}

/** A reusable piece (a leg, a tail, an arm) written once in its own coordinates and attached in as many places as you like. */
export interface TemplateDef {
  /** Defaults for the `@name` placeholders used inside this template. */
  args?: Record<string, NumOrParam>
  /** Parts, with positions relative to the attach point. */
  parts: PartDef[]
  /** Joints, with anchors relative to the attach point. A joint whose parent is `"^"` hangs off the part the template is attached to. */
  joints?: JointDef[]
}

export interface AttachDef {
  template: string
  /** Prefix for the part and joint names this copy makes: `FL` gives `FL.upper`, `FL.hip`. */
  name: string
  /** The part to hang it from (default: the first part, the root). */
  to?: string
  /** Where the attach point is, relative to the center of that part. */
  at?: Vec3Tuple
  /** Turn the copy by this many radians about the vertical axis. */
  yaw?: number
  /** Values for the template's `@name` placeholders. */
  args?: Record<string, NumOrParam>
}

/** The compact form you write: the flat body plus templates, attachments, and a default motor. */
export interface BodyInput extends BodyDef {
  /** Default for every joint's `motor` (a joint's own values win). */
  motor?: MotorDef
  templates?: Record<string, TemplateDef>
  attach?: AttachDef[]
}

export const MOTOR_DEFAULTS = { stiffness: 100, damping: 8 }

const numOrParam = { anyOf: [{ type: 'number' }, { type: 'string', pattern: '^\\$[A-Za-z_][A-Za-z0-9_]*$' }] }
/** Like numOrParam, but a body's templates may also use "@name" placeholders that each attach fills in. */
const numOrParamOrArg = { anyOf: [{ type: 'number' }, { type: 'string', pattern: '^[$@][A-Za-z_][A-Za-z0-9_]*$' }] }
/** A number, or text with a `$param` in it that is worked out when the creature is built: `"$legLength * 0.5"`. */
const expr = { anyOf: [{ type: 'number' }, { type: 'string', pattern: '\\$' }] }
const vec3 = { type: 'array', items: expr, minItems: 3, maxItems: 3 }
const colorSchema = { type: 'string', pattern: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' }

const partItem = {
  type: 'object',
  required: ['name', 'shape', 'mass', 'position'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    shape: { enum: ['box', 'sphere', 'capsule', 'cylinder', 'mesh'] },
    size: { type: 'array', items: expr, minItems: 1, maxItems: 3 },
    points: { type: 'array', items: { type: 'number' }, minItems: 12, maxItems: 12000 },
    mass: expr,
    position: vec3,
    rotation: vec3,
    visual: {
      type: 'object', required: ['gltf'], additionalProperties: false,
      properties: {
        gltf: { type: 'string', minLength: 1 },
        scale: { anyOf: [{ type: 'number', exclusiveMinimum: 0 }, { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }] },
        rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        offset: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
      },
    },
    color: colorSchema,
    friction: { type: 'number', minimum: 0 },
  },
} as const

const jointItem = {
  type: 'object',
  required: ['name', 'parent', 'child', 'anchor'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    type: { enum: ['hinge', 'ball', 'fixed'] },
    parent: { type: 'string' },
    child: { type: 'string' },
    anchor: vec3,
    axis: vec3,
    limits: { type: 'array', items: expr, minItems: 2, maxItems: 2 },
    motor: {
      type: 'object',
      additionalProperties: false,
      properties: { stiffness: numOrParamOrArg, damping: numOrParamOrArg, maxTorque: numOrParamOrArg, maxSpeed: numOrParamOrArg },
    },
  },
} as const

export const bodySchema = {
  $id: 'https://breve.dev/schema/body.json',
  type: 'object',
  required: ['parts'],
  additionalProperties: false,
  properties: {
    parts: { type: 'array', minItems: 1, items: partItem },
    joints: { type: 'array', items: jointItem },
    motor: { type: 'object', additionalProperties: false, properties: { stiffness: numOrParam, damping: numOrParam, maxTorque: numOrParam, maxSpeed: numOrParam } },
    templates: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        required: ['parts'],
        additionalProperties: false,
        properties: {
          args: { type: 'object', additionalProperties: numOrParamOrArg },
          parts: { type: 'array', minItems: 1, items: partItem },
          joints: { type: 'array', items: jointItem },
        },
      },
    },
    attach: {
      type: 'array',
      items: {
        type: 'object',
        required: ['template', 'name'],
        additionalProperties: false,
        properties: {
          template: { type: 'string' },
          name: { type: 'string', minLength: 1 },
          to: { type: 'string' },
          at: vec3,
          yaw: expr,
          args: { type: 'object', additionalProperties: numOrParam },
        },
      },
    },
    sensors: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type'],
        additionalProperties: false,
        properties: {
          type: { enum: ['joints', 'pose', 'touch', 'parts'] },
          parts: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const

const SIZE_LEN: Record<ShapeKind, number> = { box: 3, sphere: 1, capsule: 2, cylinder: 2, mesh: 3 }

/** Checks a schema-valid body for sense: names resolve, the joints form a tree, sizes fit the shapes. */
export function checkBody(body: BodyDef, where: string, params: Set<string> | null): string[] {
  const errors: string[] = []
  if (body.parts.length > 64) errors.push(`${where}.parts: at most 64 parts (this body has ${body.parts.length} once templates are attached)`)
  if ((body.joints?.length ?? 0) > 128) errors.push(`${where}.joints: at most 128 joints`)
  const names = new Map<string, number>()
  body.parts.forEach((p, i) => {
    if (names.has(p.name)) errors.push(`${where}.parts.${i}.name: duplicate part name "${p.name}"`)
    names.set(p.name, i)
    if (p.shape === 'mesh') {
      if (!p.visual) errors.push(`${where}.parts.${i}.visual: a mesh part takes its shape from the model named by "visual": { "gltf": "file.glb" }`)
      if (p.points && p.points.length % 3 !== 0) errors.push(`${where}.parts.${i}.points: must be x, y, z triples`)
    } else if (p.size.length !== SIZE_LEN[p.shape])
      errors.push(`${where}.parts.${i}.size: a ${p.shape} needs ${SIZE_LEN[p.shape]} number${SIZE_LEN[p.shape] > 1 ? 's' : ''}, got ${p.size?.length ?? 0}`)
  })
  const parentOf = new Map<string, string>()
  const jointNames = new Set<string>()
  ;(body.joints ?? []).forEach((j, i) => {
    const w = `${where}.joints.${i}`
    if (jointNames.has(j.name)) errors.push(`${w}.name: duplicate joint name "${j.name}"`)
    jointNames.add(j.name)
    if (!names.has(j.parent)) errors.push(`${w}.parent: unknown part "${j.parent}"`)
    if (!names.has(j.child)) errors.push(`${w}.child: unknown part "${j.child}"`)
    if (j.child === body.parts[0].name) errors.push(`${w}.child: the root part "${j.child}" cannot be a child`)
    if (parentOf.has(j.child)) errors.push(`${w}.child: part "${j.child}" already hangs off another joint`)
    parentOf.set(j.child, j.parent)
    const type = j.type ?? 'hinge'
    if (type !== 'hinge') {
      for (const k of ['axis', 'limits', 'motor'] as const) if (j[k] !== undefined) errors.push(`${w}.${k}: only hinge joints have "${k}"`)
    }
    if (j.axis && Math.hypot(...j.axis) < 1e-6) errors.push(`${w}.axis: must not be all zeros`)
    if (j.limits && !(j.limits[0] < j.limits[1])) errors.push(`${w}.limits: the first number must be less than the second`)
    const refs: [string, NumOrParam | undefined][] = [
      ['motor.stiffness', j.motor?.stiffness],
      ['motor.damping', j.motor?.damping],
      ['motor.maxTorque', j.motor?.maxTorque],
      ['motor.maxSpeed', j.motor?.maxSpeed],
    ]
    for (const [k, v] of refs) if (typeof v === 'string' && params && !params.has(v.slice(1))) errors.push(`${w}.${k}: unknown param "${v}"`)
  })
  // every part must reach the root through parent joints, with no loops
  body.parts.forEach((p, i) => {
    let at = p.name
    for (let hops = 0; at !== body.parts[0].name; hops++) {
      const up = parentOf.get(at)
      if (up === undefined || hops > body.parts.length) {
        errors.push(`${where}.parts.${i}: "${p.name}" is not connected to the root part "${body.parts[0].name}" by joints`)
        return
      }
      at = up
    }
  })
  body.sensors?.forEach((s, i) => {
    if (s.type === 'touch') s.parts?.forEach((n) => { if (!names.has(n)) errors.push(`${where}.sensors.${i}.parts: unknown part "${n}"`) })
  })
  return errors
}

const ajv = new Ajv({ allErrors: true, strict: false })
const validate = ajv.compile(bodySchema)

export type BodyResult = { ok: true; body: BodyDef } | { ok: false; errors: string[] }

/** Validate a standalone body document (the same checks run for `body` inside a scene). */
export function validateBody(data: unknown, params: Params = {}): BodyResult {
  if (!validate(data)) {
    return {
      ok: false,
      errors: (validate.errors ?? [])
        .filter((e) => e.keyword !== 'anyOf')
        .map((e) => {
          const where = e.instancePath ? 'body.' + e.instancePath.slice(1).replace(/\//g, '.') : 'body'
          if (e.keyword === 'additionalProperties') {
            const prop = (e.params as { additionalProperty: string }).additionalProperty
            return prop === 'drive' ? `${where}: "drive" is gone: swing the joint from the script, for example \`act({ self }, p, ctx) { return { joints: { hip: 0.5 * Math.sin(ctx.tick / 10) } } }\`, or use the stdlib's \`Gait\``  : `${where}: unknown property "${prop}"`
          }
          if (e.keyword === 'required') return `${where}: missing "${(e.params as { missingProperty: string }).missingProperty}"`
          return `${where}: ${e.message}`
        }),
    }
  }
  const built = buildBody(data as BodyInput, params, 'body', null)
  return built.errors.length ? { ok: false, errors: built.errors } : { ok: true, body: built.body }
}

const round = (v: number) => Math.round(v * 1e9) / 1e9

/**
 * Turn the compact form into the flat body the engine uses: every attached template becomes real
 * parts and joints, named `<attach name>.<template name>`, in the order attached. Bodies with no
 * templates pass through (a joint's `motor` is filled in from the body's default motor).
 */
export function expandBody(input: BodyInput, where: string): { body: BodyDef; errors: string[] } {
  const errors: string[] = []
  const parts: PartDef[] = input.parts.map((p) => ({ ...p }))
  const joints: JointDef[] = (input.joints ?? []).map((j) => ({ ...j }))

  ;(input.attach ?? []).forEach((a, i) => {
    const w = `${where}.attach.${i}`
    const tpl = input.templates?.[a.template]
    if (!tpl) return void errors.push(`${w}.template: unknown template "${a.template}"`)
    const target = parts.find((p) => p.name === (a.to ?? parts[0].name))
    if (!target) return void errors.push(`${w}.to: unknown part "${a.to}"`)
    const args = { ...tpl.args, ...a.args }
    const cos = Math.cos(a.yaw ?? 0), sin = Math.sin(a.yaw ?? 0)
    const at = a.at ?? [0, 0, 0]
    // the same turn the physics engine uses for yaw: x toward -z as yaw grows
    const place = (v: Vec3Tuple): Vec3Tuple => [
      round(target.position[0] + at[0] + v[0] * cos + v[2] * sin),
      round(target.position[1] + at[1] + v[1]),
      round(target.position[2] + at[2] - v[0] * sin + v[2] * cos),
    ]
    const turn = (v: Vec3Tuple): Vec3Tuple => [round(v[0] * cos + v[2] * sin), v[1], round(-v[0] * sin + v[2] * cos)]
    const fill = (v: unknown, path: string): unknown => {
      if (typeof v === 'string' && v.startsWith('@')) {
        const k = v.slice(1)
        if (!(k in args)) errors.push(`${w}.args: template "${a.template}" needs a value for "${k}"`)
        return args[k]
      }
      if (Array.isArray(v)) return v.map((x, j) => fill(x, `${path}.${j}`))
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, `${path}.${k}`)]))
      return v
    }
    const local = (n: string) => `${a.name}.${n}`
    // a turned attach also turns a rotated shape: Ry(yaw) * R
    const spin = (r: Vec3Tuple | undefined): { rotation?: Vec3Tuple } =>
      r && (a.yaw ?? 0) !== 0 ? { rotation: toEuler(mul(fromEuler([0, a.yaw!, 0]), fromEuler(r))).map(round) as Vec3Tuple } : {}
    for (const p of tpl.parts) { const f = fill(p, w) as PartDef; parts.push({ ...f, name: local(p.name), position: place(p.position), ...spin(f.rotation) }) }
    for (const j of tpl.joints ?? []) {
      const f = fill(j, w) as JointDef
      joints.push({
        ...f,
        name: local(j.name),
        parent: j.parent === '^' ? target.name : local(j.parent),
        child: local(j.child),
        anchor: place(j.anchor),
        ...(j.axis ? { axis: turn(j.axis) } : {}),
      })
    }
  })

  // the body's default motor fills in what a joint's own leaves out, so legs don't each repeat it
  for (const j of joints) if (j.motor) j.motor = { ...input.motor, ...j.motor }
  return { body: { parts, joints, ...(input.sensors ? { sensors: input.sensors } : {}) }, errors }
}

/** Work out every `$param` expression in the body's geometry (sizes, positions, masses, anchors, axes, limits, attach points). Motor fields are left for the engine to read live. */
export function resolveGeometry(input: BodyInput, params: Params, where: string): BodyInput {
  const n = (v: unknown, w: string) => evalNumber(v as number | string, params, w)
  const vec = (v: unknown, w: string) => (v as unknown[]).map((x, i) => n(x, `${w}.${i}`)) as number[]
  const part = (p: PartDef, w: string): PartDef => ({ ...p, size: vec(p.size ?? [], `${w}.size`), mass: n(p.mass, `${w}.mass`), position: vec(p.position, `${w}.position`) as Vec3Tuple, ...(p.rotation ? { rotation: vec(p.rotation, `${w}.rotation`) as Vec3Tuple } : {}) })
  const joint = (j: JointDef, w: string): JointDef => ({
    ...j,
    anchor: vec(j.anchor, `${w}.anchor`) as Vec3Tuple,
    ...(j.axis ? { axis: vec(j.axis, `${w}.axis`) as Vec3Tuple } : {}),
    ...(j.limits ? { limits: vec(j.limits, `${w}.limits`) as [number, number] } : {}),
  })
  const templates = input.templates && Object.fromEntries(Object.entries(input.templates).map(([k, t]) => [k, {
    ...t,
    parts: t.parts.map((p, i) => part(p, `${where}.templates.${k}.parts.${i}`)),
    ...(t.joints ? { joints: t.joints.map((j, i) => joint(j, `${where}.templates.${k}.joints.${i}`)) } : {}),
  }]))
  return {
    ...input,
    parts: input.parts.map((p, i) => part(p, `${where}.parts.${i}`)),
    ...(input.joints ? { joints: input.joints.map((j, i) => joint(j, `${where}.joints.${i}`)) } : {}),
    ...(templates ? { templates } : {}),
    ...(input.attach ? { attach: input.attach.map((a, i) => ({ ...a, ...(a.at ? { at: vec(a.at, `${where}.attach.${i}.at`) as Vec3Tuple } : {}), ...(a.yaw !== undefined ? { yaw: n(a.yaw, `${where}.attach.${i}.yaw`) } : {}) })) } : {}),
  }
}

/**
 * The flat body the physics engine builds, from what the scene wrote and the current param values:
 * geometry expressions are worked out, templates are attached, and the result is checked.
 */
export function buildBody(input: BodyInput, params: Params, where: string, paramNames: Set<string> | null): { body: BodyDef; errors: string[] } {
  let resolved: BodyInput
  try {
    resolved = resolveGeometry(input, params, where)
  } catch (e) {
    return { body: { parts: [] }, errors: [(e as Error).message] }
  }
  const x = expandBody(resolved, where)
  if (x.errors.length) return { body: x.body, errors: x.errors }
  const errors = checkBody(x.body, where, paramNames)
  // sizes and masses must be positive once worked out
  x.body.parts.forEach((p, i) => {
    if (p.size.some((v) => !(v > 0))) errors.push(`${where}.parts.${i}.size: every size must be greater than zero (got ${p.size.join(', ')})`)
    if (!(p.mass > 0)) errors.push(`${where}.parts.${i}.mass: must be greater than zero (got ${p.mass})`)
  })
  return { body: x.body, errors }
}
