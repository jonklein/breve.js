import type { BodyInput, JointDef, PartDef, Vec3Tuple } from './body'

interface XmlNode {
  tag: string
  attrs: Record<string, string>
  children: XmlNode[]
}

/** A small XML reader, enough for URDF: elements, attributes, nesting. Comments, declarations and text are skipped. */
function parseXml(text: string): XmlNode {
  const root: XmlNode = { tag: '#root', attrs: {}, children: [] }
  const stack = [root]
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (!m[2]) continue
    if (m[1]) {
      if (stack.length > 1 && stack[stack.length - 1].tag === m[2]) stack.pop()
      else throw new Error(`mismatched </${m[2]}>`)
      continue
    }
    const attrs: Record<string, string> = {}
    for (const a of m[3].matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = a[2] ?? a[3]
    const node: XmlNode = { tag: m[2], attrs, children: [] }
    stack[stack.length - 1].children.push(node)
    if (!m[4]) stack.push(node)
  }
  if (stack.length !== 1) throw new Error(`<${stack[stack.length - 1].tag}> is never closed`)
  return root
}

const kids = (n: XmlNode, tag: string) => n.children.filter((c) => c.tag === tag)
const kid = (n: XmlNode, tag: string) => kids(n, tag)[0]
const nums = (s: string | undefined, fallback: number[]): number[] => (s ? s.trim().split(/\s+/).map(Number) : fallback)

export interface UrdfResult {
  body: BodyInput
  /** Things that were not carried over (visual meshes, collision shapes beyond the first, and so on). */
  warnings: string[]
  errors: string[]
}

const round = (v: number) => Math.round(v * 1e6) / 1e6 || 0 // `|| 0` turns -0 into 0

/**
 * Turn a URDF robot description into a body. URDF is z-up; bodies are y-up, so (x, y, z) becomes (x, z, -y).
 * Supported: box, sphere and cylinder shapes; revolute, continuous and fixed joints with axes and limits; link masses.
 * Not supported yet, and reported as errors: rotated links or joint frames (non-zero rpy), prismatic and other joint kinds, meshes.
 * The robot is lifted so its lowest point rests just above the ground.
 */
export function importUrdf(text: string, opts: { stiffness?: number; damping?: number } = {}): UrdfResult {
  const errors: string[] = [], warnings: string[] = []
  let doc: XmlNode
  try { doc = parseXml(text) } catch (e) { return { body: { parts: [] }, warnings, errors: [`URDF: not valid XML (${(e as Error).message})`] } }
  const robot = kid(doc, 'robot')
  if (!robot) return { body: { parts: [] }, warnings, errors: ['URDF: no <robot> element'] }

  const links = new Map(kids(robot, 'link').map((l) => [l.attrs.name, l]))
  const joints = kids(robot, 'joint')
  const childOf = new Set(joints.map((j) => kid(j, 'child')?.attrs.link))
  const rootName = [...links.keys()].find((n) => !childOf.has(n))
  if (!rootName) return { body: { parts: [] }, warnings, errors: ['URDF: could not find the root link (every link is some joint\'s child)'] }

  const origin = (n: XmlNode | undefined, where: string): Vec3Tuple => {
    const o = n && kid(n, 'origin')
    if (o && nums(o.attrs.rpy, [0, 0, 0]).some((v) => Math.abs(v) > 1e-9)) errors.push(`${where}: rotated frames (non-zero rpy) are not supported yet`)
    const [x, y, z] = nums(o?.attrs.xyz, [0, 0, 0])
    return [x, y, z]
  }
  const toY = ([x, y, z]: Vec3Tuple): Vec3Tuple => [x, z, -y]

  // world position of each link's frame, walking down from the root
  const frame = new Map<string, Vec3Tuple>([[rootName, [0, 0, 0]]])
  const queue = [rootName]
  const jointsOf = (parent: string) => joints.filter((j) => kid(j, 'parent')?.attrs.link === parent)
  while (queue.length) {
    const p = queue.shift()!
    for (const j of jointsOf(p)) {
      const c = kid(j, 'child')?.attrs.link
      if (!c || !links.has(c)) { errors.push(`joint ${j.attrs.name}: unknown child link "${c}"`); continue }
      const o = origin(j, `joint ${j.attrs.name}`), f = frame.get(p)!
      frame.set(c, [f[0] + o[0], f[1] + o[1], f[2] + o[2]])
      queue.push(c)
    }
  }

  const parts: PartDef[] = []
  const lowest: number[] = []
  for (const [name, link] of links) {
    const f = frame.get(name)
    if (!f) { warnings.push(`link ${name} is not connected to the root and was left out`); continue }
    const geoms = [...kids(link, 'collision'), ...kids(link, 'visual')]
    const holder = geoms.find((g) => kid(g, 'geometry'))
    if (!holder) { errors.push(`link ${name}: needs a <collision> or <visual> geometry`); continue }
    if (geoms.length > 2) warnings.push(`link ${name}: only the first shape is used`)
    const geo = kid(holder, 'geometry')!.children[0]
    const o = origin(holder, `link ${name}`)
    const at = toY([f[0] + o[0], f[1] + o[1], f[2] + o[2]])
    const mass = Number(kid(kid(link, 'inertial') ?? { tag: '', attrs: {}, children: [] }, 'mass')?.attrs.value ?? 1)
    let shape: PartDef['shape'], size: number[], halfY: number
    if (geo.tag === 'box') {
      const [sx, sy, sz] = nums(geo.attrs.size, [1, 1, 1])
      shape = 'box'; size = [sx, sz, sy]; halfY = sz / 2
    } else if (geo.tag === 'sphere') {
      const r = Number(geo.attrs.radius ?? 0.5)
      shape = 'sphere'; size = [r]; halfY = r
    } else if (geo.tag === 'cylinder') {
      const r = Number(geo.attrs.radius ?? 0.5), len = Number(geo.attrs.length ?? 1) // URDF cylinders stand along z, ours along y
      shape = 'cylinder'; size = [len, r]; halfY = len / 2
    } else {
      errors.push(`link ${name}: <${geo.tag}> shapes are not supported (use box, sphere or cylinder)`)
      continue
    }
    parts.push({ name, shape, size: size.map(round), mass: mass > 0 ? mass : 1, position: at.map(round) as Vec3Tuple })
    lowest.push(at[1] - halfY)
  }
  // the root part must come first
  parts.sort((a, b) => (a.name === rootName ? -1 : b.name === rootName ? 1 : 0))

  const out: JointDef[] = []
  for (const j of joints) {
    const type = j.attrs.type
    const parent = kid(j, 'parent')?.attrs.link, child = kid(j, 'child')?.attrs.link
    if (!parent || !child || !parts.some((p) => p.name === child)) continue
    const f = frame.get(child)!
    const anchor = toY(f).map(round) as Vec3Tuple
    if (type === 'fixed') { out.push({ name: j.attrs.name, type: 'fixed', parent, child, anchor }); continue }
    if (type !== 'revolute' && type !== 'continuous') { errors.push(`joint ${j.attrs.name}: "${type}" joints are not supported yet (revolute, continuous and fixed are)`); continue }
    const axis = toY(nums(kid(j, 'axis')?.attrs.xyz, [1, 0, 0]) as Vec3Tuple).map(round) as Vec3Tuple
    const lim = kid(j, 'limit')
    const joint: JointDef = { name: j.attrs.name, type: 'hinge', parent, child, anchor, axis, motor: { stiffness: opts.stiffness ?? 100, damping: opts.damping ?? 8 } }
    if (type === 'revolute' && lim?.attrs.lower !== undefined && lim.attrs.upper !== undefined) joint.limits = [Number(lim.attrs.lower), Number(lim.attrs.upper)]
    out.push(joint)
  }

  // stand the robot on the ground: lowest point just above y = 0
  const lift = lowest.length ? 0.02 - Math.min(...lowest) : 0
  for (const p of parts) p.position = [p.position[0], round(p.position[1] + lift), p.position[2]]
  for (const j of out) j.anchor = [j.anchor[0], round(j.anchor[1] + lift), j.anchor[2]]
  return { body: { parts, joints: out, sensors: [{ type: 'pose' }, { type: 'joints' }, { type: 'touch' }] }, warnings, errors }
}
