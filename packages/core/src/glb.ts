import { apply, fromEuler } from './rot'
import type { PartDef } from './body'
import type { Scene } from './scene'

/** Reads a file next to the scene (a path or URL as the scene wrote it). Hosts register one, as they register physics engines. */
export type AssetReader = (path: string) => Promise<Uint8Array>

let reader: AssetReader | undefined

/** Tell the core how to read model files (the workbench fetches them, a script reads the disk). Without one, a scene with a mesh part cannot be built. */
export function registerAssetReader(read: AssetReader | undefined): void {
  reader = read
}

type Mat4 = number[] // column-major, as glTF writes matrices
const I4: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const mul4 = (a: Mat4, b: Mat4): Mat4 => {
  const o = new Array<number>(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return o
}
function fromTrs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]): Mat4 {
  const [x, y, z, w] = q
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
  ]
  return [r[0] * s[0], r[1] * s[0], r[2] * s[0], 0, r[3] * s[1], r[4] * s[1], r[5] * s[1], 0, r[6] * s[2], r[7] * s[2], r[8] * s[2], 0, t[0], t[1], t[2], 1]
}

interface Gltf {
  scene?: number
  scenes?: { nodes?: number[] }[]
  nodes?: { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[]
  meshes?: { primitives: { attributes: { POSITION?: number }; extensions?: Record<string, unknown> }[] }[]
  accessors?: { bufferView?: number; byteOffset?: number; count: number; componentType: number; type: string; sparse?: unknown }[]
  bufferViews?: { buffer: number; byteOffset?: number; byteStride?: number }[]
}

/**
 * Every vertex of every mesh in a GLB file (the binary glTF form), in the file's own coordinates with each node's transform applied,
 * as x, y, z triples. Only what a collision shape needs: positions, no triangles. Compressed meshes (Draco, meshopt) are not read.
 */
export function glbPoints(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file (use the binary .glb form of glTF)')
  let json: Gltf | undefined
  let bin: Uint8Array | undefined
  for (let at = 12; at + 8 <= bytes.byteLength;) {
    const len = view.getUint32(at, true), type = view.getUint32(at + 4, true)
    const body = bytes.subarray(at + 8, at + 8 + len)
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body)) as Gltf
    else if (type === 0x004e4942 && !bin) bin = body
    at += 8 + len + ((4 - (len % 4)) % 4)
  }
  if (!json || !bin) throw new Error('the GLB file has no JSON or binary chunk')
  const { nodes = [], meshes = [], accessors = [], bufferViews = [] } = json
  const out: number[] = []
  const visit = (index: number, parent: Mat4, depth: number): void => {
    const node = nodes[index]
    if (!node || depth > 64) return
    const m = mul4(parent, node.matrix ? node.matrix : fromTrs(node.translation, node.rotation, node.scale))
    if (node.mesh !== undefined) {
      for (const prim of meshes[node.mesh]?.primitives ?? []) {
        if (prim.extensions?.KHR_draco_mesh_compression || prim.extensions?.EXT_meshopt_compression) throw new Error('compressed meshes (Draco, meshopt) are not supported')
        const acc = accessors[prim.attributes.POSITION ?? -1]
        if (!acc || acc.componentType !== 5126 || acc.type !== 'VEC3' || acc.bufferView === undefined || acc.sparse) throw new Error('a mesh has positions this reader cannot use (it needs plain float VEC3)')
        const bv = bufferViews[acc.bufferView]
        const start = bin!.byteOffset + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0), stride = bv.byteStride || 12
        const data = new DataView(bin!.buffer)
        for (let i = 0; i < acc.count; i++) {
          const x = data.getFloat32(start + i * stride, true), y = data.getFloat32(start + i * stride + 4, true), z = data.getFloat32(start + i * stride + 8, true)
          out.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14])
        }
      }
    }
    for (const c of node.children ?? []) visit(c, m, depth + 1)
  }
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, i) => i)
  for (const r of roots) visit(r, I4, 0)
  if (out.length < 12) throw new Error('the GLB file has no mesh to make a shape from')
  return Float32Array.from(out)
}

/** The most points a collision hull is built from; a denser model is thinned evenly (the hull barely changes). */
const MAX_POINTS = 3000

/** A part's collision shape from the model's vertices: placed as `visual` places the picture (scale, then rotation, then offset), with its extent as `size`. */
export function meshPart(part: PartDef, vertices: Float32Array): PartDef {
  const v = part.visual!
  const scale = typeof v.scale === 'number' ? [v.scale, v.scale, v.scale] : v.scale ?? [1, 1, 1]
  const turn = fromEuler(v.rotation ?? [0, 0, 0])
  const offset = v.offset ?? [0, 0, 0]
  const n = vertices.length / 3, step = Math.max(1, Math.ceil(n / MAX_POINTS))
  const points: number[] = []
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < n; i += step) {
    const p = apply(turn, [vertices[i * 3] * scale[0], vertices[i * 3 + 1] * scale[1], vertices[i * 3 + 2] * scale[2]])
    for (let a = 0; a < 3; a++) {
      const c = Math.round((p[a] + offset[a]) * 1e5) / 1e5
      points.push(c)
      lo[a] = Math.min(lo[a], c)
      hi[a] = Math.max(hi[a], c)
    }
  }
  return { ...part, points, size: [0, 1, 2].map((a) => Math.max(hi[a] - lo[a], 1e-3)) }
}

const needsMesh = (p: PartDef) => p.shape === 'mesh' && !p.points

/**
 * The scene with every mesh part's shape worked out from its model file. A scene with no unresolved mesh part comes back as it is, so this is
 * safe to call on any scene (and on one that was already resolved).
 */
export async function resolveMeshes(scene: Scene, read: AssetReader | undefined = reader): Promise<Scene> {
  const wanted = scene.entities.flatMap((e) => [...(e.body?.parts ?? []), ...Object.values(e.body?.templates ?? {}).flatMap((t) => t.parts)]).filter(needsMesh)
  if (!wanted.length) return scene
  if (!read) throw new Error('this scene has a mesh part, and nothing is registered to read model files (registerAssetReader)')
  const cache = new Map<string, Promise<Float32Array>>()
  const load = (path: string) => {
    let c = cache.get(path)
    if (!c) cache.set(path, (c = read(path).then(glbPoints, (e) => { throw new Error(`could not read the model "${path}": ${(e as Error).message}`) })))
    return c
  }
  const fix = async (parts: PartDef[]) => Promise.all(parts.map(async (p) => (needsMesh(p) && p.visual ? meshPart(p, await load(p.visual.gltf)) : p)))
  const entities = await Promise.all(scene.entities.map(async (e) => {
    if (!e.body) return e
    const templates = e.body.templates && Object.fromEntries(await Promise.all(Object.entries(e.body.templates).map(async ([k, t]) => [k, { ...t, parts: await fix(t.parts) }] as const)))
    return { ...e, body: { ...e.body, parts: await fix(e.body.parts), ...(templates ? { templates } : {}) } }
  }))
  return { ...scene, entities }
}
