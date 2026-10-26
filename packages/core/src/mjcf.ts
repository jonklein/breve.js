import type { BodyInput, JointDef, PartDef, Vec3Tuple } from './body'
import type { UrdfResult } from './urdf'
import { IDENTITY, apply, fromEuler, mul, toEuler, transpose, type Mat3 } from './rot'
import { halfExtentY, kid, kids, nums, parseXml, type XmlNode } from './xml'

const round = (v: number) => Math.round(v * 1e6) / 1e6 || 0
const DEG = Math.PI / 180

/** Rotation taking the z axis to direction `d` (what MuJoCo's `fromto` means for a capsule or cylinder). */
function alignZ(d: [number, number, number]): Mat3 {
  const len = Math.hypot(...d) || 1
  const [x, y, z] = [d[0] / len, d[1] / len, d[2] / len]
  if (z > 0.999999) return IDENTITY
  if (z < -0.999999) return [1, 0, 0, 0, -1, 0, 0, 0, -1]
  // Rodrigues: axis = z x d, angle = acos(z . d)
  const ax = -y, ay = x, s = Math.hypot(ax, ay), c = z
  const [kx, ky] = [ax / s, ay / s], v = 1 - c
  return [c + kx * kx * v, kx * ky * v, ky * s, kx * ky * v, c + ky * ky * v, -kx * s, -ky * s, kx * s, c]
}

const volume = (shape: PartDef['shape'], size: number[]): number => {
  switch (shape) {
    case 'box': return size[0] * size[1] * size[2]
    case 'sphere': return (4 / 3) * Math.PI * size[0] ** 3
    case 'capsule': return Math.PI * size[1] ** 2 * size[0] + (4 / 3) * Math.PI * size[1] ** 3
    default: return Math.PI * size[1] ** 2 * size[0]
  }
}

/**
 * Turn a MuJoCo model (MJCF) into a body. Like URDF, MJCF is z-up, so (x, y, z) becomes (x, z, -y).
 * Supported: nested `<body>` with pos, euler (xyz, the default), quat and axisangle; `<geom>` box, sphere, capsule
 * and cylinder, sized or given by `fromto`; mass from `mass` or from `density` (default 1000) times volume;
 * one `hinge`, `ball` or `free` joint per body, with `axis`, `pos` and `range`; the compiler's `angle`.
 * Not supported, and reported: slide joints, several joints on one body, meshes, planes below the root.
 * Left out with a warning: extra geoms on a body (the first is used), defaults classes, tendons, actuators, sensors.
 */
export function importMjcf(text: string, opts: { stiffness?: number; damping?: number } = {}): UrdfResult {
  const errors: string[] = [], warnings: string[] = []
  let doc: XmlNode
  try { doc = parseXml(text) } catch (e) { return { body: { parts: [] }, warnings, errors: [`MJCF: not valid XML (${(e as Error).message})`] } }
  const model = kid(doc, 'mujoco')
  if (!model) return { body: { parts: [] }, warnings, errors: ['MJCF: no <mujoco> element'] }
  const compiler = kid(model, 'compiler')
  const angle = compiler?.attrs.angle === 'radian' ? 1 : DEG
  if (compiler?.attrs.eulerseq && compiler.attrs.eulerseq !== 'xyz') errors.push(`compiler eulerseq "${compiler.attrs.eulerseq}": only the default "xyz" is supported`)
  if (kid(model, 'default')?.children.length) warnings.push('<default> classes are ignored: write sizes and joint settings on each element')
  const world = kid(model, 'worldbody')
  if (!world) return { body: { parts: [] }, warnings, errors: ['MJCF: no <worldbody>'] }

  const toY = ([x, y, z]: number[]): Vec3Tuple => [x, z, -y]
  const C: Mat3 = [1, 0, 0, 0, 0, 1, 0, -1, 0]
  const rotToY = (m: Mat3): Mat3 => mul(C, mul(m, transpose(C)))

  /** A pos plus an orientation written as euler, quat (w x y z) or axisangle (x y z angle), whichever the element has. */
  const pose = (n: XmlNode, where: string): { pos: Vec3Tuple; rot: Mat3 } => {
    const pos = nums(n.attrs.pos, [0, 0, 0]) as Vec3Tuple
    let rot = IDENTITY
    if (n.attrs.euler) { const [a, b, c] = nums(n.attrs.euler, [0, 0, 0]); rot = fromEuler([a * angle, b * angle, c * angle]) }
    else if (n.attrs.quat) {
      const [w, x, y, z] = nums(n.attrs.quat, [1, 0, 0, 0]), l = Math.hypot(w, x, y, z) || 1
      const [qw, qx, qy, qz] = [w / l, x / l, y / l, z / l]
      rot = [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw), 2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw), 2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)]
    } else if (n.attrs.axisangle) {
      const [x, y, z, a] = nums(n.attrs.axisangle, [0, 0, 1, 0]), l = Math.hypot(x, y, z) || 1
      const [kx, ky, kz] = [x / l, y / l, z / l], c = Math.cos(a * angle), s = Math.sin(a * angle), v = 1 - c
      rot = [c + kx * kx * v, kx * ky * v - kz * s, kx * kz * v + ky * s, ky * kx * v + kz * s, c + ky * ky * v, ky * kz * v - kx * s, kz * kx * v - ky * s, kz * ky * v + kx * s, c + kz * kz * v]
    } else if (n.attrs.xyaxes || n.attrs.zaxis) errors.push(`${where}: xyaxes and zaxis orientations are not supported (use euler, quat or axisangle)`)
    return { pos, rot }
  }

  const parts: PartDef[] = []
  const joints: JointDef[] = []
  const lowest: number[] = []
  const used = new Set<string>()
  const unique = (base: string): string => {
    let n = base, i = 2
    while (used.has(n)) n = `${base}_${i++}`
    used.add(n)
    return n
  }

  const walk = (b: XmlNode, parentName: string | null, parentPos: Vec3Tuple, parentRot: Mat3, index: number): void => {
    const name = unique(b.attrs.name ?? (parentName ? `${parentName}.${index}` : 'root'))
    const own = pose(b, `body ${name}`)
    const d = apply(parentRot, own.pos)
    const pos: Vec3Tuple = [parentPos[0] + d[0], parentPos[1] + d[1], parentPos[2] + d[2]]
    const rot = mul(parentRot, own.rot)

    // the part: the first geom (or a small stand-in sphere, so the body has something to hang children on)
    const geoms = kids(b, 'geom')
    if (geoms.length > 1) warnings.push(`body ${name}: only the first of ${geoms.length} geoms is used`)
    const g = geoms[0]
    let shape: PartDef['shape'] = 'sphere', size = [0.02], gpos: Vec3Tuple = pos, grot = rot, explicitMass: number | undefined
    if (g) {
      const type = g.attrs.type ?? 'sphere'
      const s = nums(g.attrs.size, [])
      const gp = pose(g, `body ${name} geom`)
      let local = gp.rot, center = gp.pos
      if (g.attrs.fromto) {
        const [x1, y1, z1, x2, y2, z2] = nums(g.attrs.fromto, [0, 0, 0, 0, 0, 1])
        center = [(x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2]
        local = alignZ([x2 - x1, y2 - y1, z2 - z1])
        s[1] = Math.hypot(x2 - x1, y2 - y1, z2 - z1) / 2 // a half length, like the sized form
      }
      if (type === 'box') {
        if (s.length < 3) errors.push(`body ${name}: a box needs size="hx hy hz"`)
        shape = 'box'; size = [s[0] * 2, s[2] * 2, s[1] * 2] // z-up (x, y, z) to y-up (x, z, y)
      } else if (type === 'sphere') { shape = 'sphere'; size = [s[0] ?? 0.1] }
      else if (type === 'capsule' || type === 'cylinder') {
        if (s.length < 2) errors.push(`body ${name}: a ${type} needs a radius and a half length (size="r h", or "r" with fromto)`)
        shape = type; size = [(s[1] ?? 0.1) * 2, s[0] ?? 0.05] // MJCF puts these along local z, ours along y
      } else { errors.push(`body ${name}: <geom type="${type}"> is not supported (use box, sphere, capsule or cylinder)`) }
      const dd = apply(rot, center)
      gpos = [pos[0] + dd[0], pos[1] + dd[1], pos[2] + dd[2]]
      grot = mul(rot, local)
      if (g.attrs.mass) explicitMass = Number(g.attrs.mass)
      else if (g.attrs.density) explicitMass = Number(g.attrs.density) * volume(shape, size)
    } else if (parentName) warnings.push(`body ${name} has no geom: a small sphere stands in for it`)
    const inertial = kid(b, 'inertial')
    if (inertial?.attrs.mass) explicitMass = Number(inertial.attrs.mass)
    const mass = explicitMass ?? 1000 * volume(shape, size) // MuJoCo's default density

    const rotY = rotToY(grot)
    const euler = toEuler(rotY)
    const at = toY(gpos)
    parts.push({ name, shape, size: size.map(round), mass: round(Math.max(mass, 1e-3)), position: at.map(round) as Vec3Tuple, ...(euler.some((v) => Math.abs(v) > 1e-6) ? { rotation: euler.map(round) as Vec3Tuple } : {}) })
    lowest.push(at[1] - halfExtentY(shape, size, rotY))

    // the joint that connects this body to its parent
    const js = kids(b, 'joint')
    const freejoint = kid(b, 'freejoint')
    if (parentName) {
      const j = js[0]
      if (js.length > 1) errors.push(`body ${name}: ${js.length} joints on one body are not supported (split it into bodies, one joint each)`)
      if (!j) joints.push({ name: `${name}_fixed`, type: 'fixed', parent: parentName, child: name, anchor: toY(pos).map(round) as Vec3Tuple })
      else {
        const type = j.attrs.type ?? 'hinge'
        const jd = apply(rot, nums(j.attrs.pos, [0, 0, 0]))
        const anchor = toY([pos[0] + jd[0], pos[1] + jd[1], pos[2] + jd[2]]).map(round) as Vec3Tuple
        const jname = j.attrs.name ?? `${name}_joint`
        if (type === 'hinge') {
          const axis = toY(apply(rot, nums(j.attrs.axis, [0, 0, 1]))).map(round) as Vec3Tuple
          const def: JointDef = { name: jname, type: 'hinge', parent: parentName, child: name, anchor, axis, motor: { stiffness: opts.stiffness ?? 100, damping: opts.damping ?? 8 } }
          const range = nums(j.attrs.range, [])
          if (range.length === 2 && j.attrs.limited !== 'false') def.limits = [round(range[0] * angle), round(range[1] * angle)]
          joints.push(def)
        } else if (type === 'ball') joints.push({ name: jname, type: 'ball', parent: parentName, child: name, anchor })
        else if (type === 'free') warnings.push(`body ${name}: a free joint below the root is treated as fixed`), joints.push({ name: jname, type: 'fixed', parent: parentName, child: name, anchor })
        else errors.push(`body ${name}: "${type}" joints are not supported (hinge, ball and free are)`)
      }
    } else if (js.length && !freejoint && !(js.length === 1 && js[0].attrs.type === 'free')) warnings.push(`body ${name}: joints on the root body are ignored (the root floats)`)

    kids(b, 'body').forEach((c, i) => walk(c, name, pos, rot, i))
  }

  const roots = kids(world, 'body')
  if (!roots.length) return { body: { parts: [] }, warnings, errors: ['MJCF: the <worldbody> has no <body>'] }
  if (roots.length > 1) warnings.push(`only the first of ${roots.length} top-level bodies is used`)
  if (kids(world, 'geom').length) warnings.push('geoms directly in <worldbody> (a floor, say) are left out: the scene has its own terrain')
  if (kid(model, 'actuator')) warnings.push('<actuator> is ignored: every hinge gets a position motor, driven by the oscillator or your script')
  walk(roots[0], null, [0, 0, 0], IDENTITY, 0)

  // stand the robot on the ground: lowest point just above y = 0
  const lift = lowest.length ? 0.02 - Math.min(...lowest) : 0
  for (const p of parts) p.position = [p.position[0], round(p.position[1] + lift), p.position[2]]
  for (const j of joints) j.anchor = [j.anchor[0], round(j.anchor[1] + lift), j.anchor[2]]
  return { body: { parts, joints, sensors: [{ type: 'pose' }, { type: 'joints' }, { type: 'touch' }] } as BodyInput, warnings, errors }
}
