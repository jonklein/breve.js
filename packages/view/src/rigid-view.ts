import * as THREE from 'three'
import { buildTexture, ownCopy } from './textures'
import { antiTile } from './antitile'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { PartShape, RigidFrame, TerrainMesh } from '@breve/core'

const MAX_CREATURES = 256
const DEFAULT_TERRAIN = '#4f7a46'

type Model = NonNullable<RigidFrame['model']>

/** Draws physics bodies (one instanced mesh per body part) and the terrain. A pure reader of RigidFrame. */
export class RigidView {
  private group = new THREE.Group()
  private terrain: THREE.Mesh | null = null
  private meshes: THREE.InstancedMesh[] = []
  private tmpM = new THREE.Matrix4()
  private tmpP = new THREE.Vector3()
  private tmpQ = new THREE.Quaternion()
  private one = new THREE.Vector3(1, 1, 1)
  private tmpC = new THREE.Color()
  private framed = 0
  private shadows = false
  /** Where a part's relative `visual.gltf` path starts (a URL ending in `/`). */
  assetBase = ''
  /** The lowest point of the terrain, so a floor can lie just under it. */
  groundLevel = 0
  private loaded = new Map<string, Promise<THREE.BufferGeometry>>()

  constructor(scene: THREE.Scene, private camera: THREE.PerspectiveCamera, private controls: { target: THREE.Vector3 }) {
    this.group.visible = false
    scene.add(this.group)
  }

  /** The nearest creature under a ray (its row is the instance index of any of its parts). */
  pick(ray: THREE.Raycaster): { row: number; distance: number } | null {
    let best: { row: number; distance: number } | null = null
    for (const m of this.meshes) {
      m.boundingSphere = null
      for (const hit of ray.intersectObject(m)) if (hit.instanceId !== undefined && (!best || hit.distance < best.distance)) best = { row: hit.instanceId, distance: hit.distance }
    }
    return best
  }

  setVisible(v: boolean): void {
    this.group.visible = v
  }

  setShadows(on: boolean): void {
    this.shadows = on
    for (const m of this.meshes) m.castShadow = on
    if (this.terrain) this.terrain.receiveShadow = on
  }

  update(r: RigidFrame, halfSize: number): void {
    if (r.model) this.build(r.model, halfSize)
    const per = r.partCount * 7
    const n = Math.min(MAX_CREATURES, per ? r.poses.length / per : 0)
    const p = r.poses
    this.meshes.forEach((mesh, part) => {
      mesh.count = n
      for (let i = 0; i < n; i++) {
        const o = i * per + part * 7
        this.tmpP.set(p[o], p[o + 1], p[o + 2])
        this.tmpQ.set(p[o + 3], p[o + 4], p[o + 5], p[o + 6])
        this.tmpM.compose(this.tmpP, this.tmpQ, this.one)
        mesh.setMatrixAt(i, this.tmpM)
      }
      mesh.instanceMatrix.needsUpdate = true
    })
  }

  private build(model: Model, halfSize: number): void {
    for (const m of this.meshes) { this.group.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); m.dispose() }
    this.meshes = model.parts.map((part, k) => this.partMesh(part, k))
    model.parts.forEach((part, k) => { if (part.visual) void this.useVisual(part.visual, this.meshes[k]) })
    this.meshes.forEach((m) => this.group.add(m))
    this.buildTerrain(model.terrain)
    // frame the arena from a corner, a little above, but leave the camera alone when only a body was edited
    if (halfSize !== this.framed) {
      this.framed = halfSize
      this.controls.target.set(0, 0, 0)
      this.camera.position.set(0.9, 0.6, 0.9).multiplyScalar(halfSize * 0.5)
    }
  }

  /** Swap a part's primitive for its glTF model once it has loaded; until then (or if it never loads) the primitive shows. */
  private async useVisual(v: NonNullable<PartShape['visual']>, mesh: THREE.InstancedMesh): Promise<void> {
    const url = new URL(v.gltf, this.assetBase || (typeof location !== 'undefined' ? location.href : undefined)).href
    let promise = this.loaded.get(url)
    if (!promise) {
      promise = loadMergedGeometry(url)
      this.loaded.set(url, promise)
    }
    try {
      const base = await promise
      if (!this.meshes.includes(mesh)) return // the body was rebuilt while this loaded
      const g = base.clone()
      const scale = typeof v.scale === 'number' ? [v.scale, v.scale, v.scale] : v.scale ?? [1, 1, 1]
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(...(v.offset ?? [0, 0, 0])),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...(v.rotation ?? [0, 0, 0]), 'XYZ')),
        new THREE.Vector3(...scale),
      )
      g.applyMatrix4(m)
      mesh.geometry.dispose()
      mesh.geometry = g
      mesh.boundingSphere = null
    } catch (e) {
      this.loaded.delete(url)
      console.warn(`could not load the model ${url}:`, e instanceof Error ? e.message : e)
    }
  }

  private partMesh(part: PartShape, k: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometryFor(part), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.08 }), MAX_CREATURES)
    mesh.frustumCulled = false
    mesh.castShadow = this.shadows
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CREATURES * 3), 3)
    for (let i = 0; i < MAX_CREATURES; i++) {
      // parts without a color take a hue from their creature, so you can tell individuals apart
      if (part.color) this.tmpC.set(part.color)
      else this.tmpC.setHSL((i * 0.618034) % 1, 0.55, k === 0 ? 0.55 : 0.4)
      mesh.instanceColor.setXYZ(i, this.tmpC.r, this.tmpC.g, this.tmpC.b)
    }
    mesh.count = 0
    return mesh
  }

  private buildTerrain(t: TerrainMesh | null): void {
    if (this.terrain) { this.group.remove(this.terrain); this.terrain.geometry.dispose(); (this.terrain.material as THREE.Material).dispose(); this.terrain = null }
    if (!t) return
    const tex = t.texture ?? 'static'
    const legacy = tex === 'static' || tex === 'grid' || tex === 'none'
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: t.shading === 'flat', roughness: 0.92, metalness: 0 })
    let tile = 1, offset = 0
    if (legacy) {
      const g = groundTexture(tex, t.size)
      tile = g?.tile ?? 1
      offset = g?.offset ?? 0
      mat.map = g?.map ?? null
    } else {
      // a generated or loaded texture repeats over the ground, with its bump map for fine relief
      const spec = typeof tex === 'string' ? { kind: tex } : tex
      const built = buildTexture(spec, { assetBase: this.assetBase, changed: () => this.buildTerrain(t) })
      tile = (typeof spec === 'object' && 'tile' in spec && (spec as { tile?: number }).tile) || 10
      mat.map = ownCopy(built.map)
      mat.normalMap = ownCopy(built.normalMap)
      for (const x of [mat.map, mat.normalMap]) x?.repeat.set(1, 1)
      antiTile(mat)
    }
    this.groundLevel = t.heights.length ? Math.min(...t.heights) : 0
    this.terrain = new THREE.Mesh(terrainGeometry(t, tile, offset, !legacy), mat)
    this.terrain.receiveShadow = this.shadows
    this.group.add(this.terrain)
  }
}

/** Box `[w, h, d]`, sphere `[r]`, capsule and cylinder `[length, radius]` with the long axis along y: the same sizes the physics uses. */
function geometryFor(p: PartShape): THREE.BufferGeometry {
  const g = baseGeometry(p)
  // a turned shape is turned in the geometry, so the instance matrices stay the body poses
  if (p.rotation) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(p.rotation[0], p.rotation[1], p.rotation[2], 'XYZ')))
  return g
}

function baseGeometry(p: PartShape): THREE.BufferGeometry {
  const s = p.size
  switch (p.shape) {
    case 'box': case 'mesh': return new THREE.BoxGeometry(s[0], s[1], s[2]) // a mesh shows its extent as a box until its model has loaded
    case 'sphere': return new THREE.SphereGeometry(s[0], 20, 14)
    case 'capsule': return new THREE.CapsuleGeometry(s[1], s[0], 4, 12)
    default: return new THREE.CylinderGeometry(s[1], s[1], s[0], 16)
  }
}

/** A height grid as a mesh, shaded a little lighter on the hilltops. Vertex (ix, iz) matches the physics heightfield. */
function terrainGeometry(t: TerrainMesh, tile: number, offset: number, tinted = false): THREE.BufferGeometry {
  const m = t.n + 1
  const step = t.size / t.n
  let lo = Infinity, hi = -Infinity
  for (const h of t.heights) { lo = Math.min(lo, h); hi = Math.max(hi, h) }
  const base = new THREE.Color(t.color ?? DEFAULT_TERRAIN)
  const pos = new Float32Array(m * m * 3), col = new Float32Array(m * m * 3), uv = new Float32Array(m * m * 2)
  for (let ix = 0; ix < m; ix++)
    for (let iz = 0; iz < m; iz++) {
      const v = ix * m + iz
      const h = t.heights[v]
      pos.set([-t.size / 2 + ix * step, h, -t.size / 2 + iz * step], v * 3)
      uv.set([(-t.size / 2 + ix * step) / tile + offset, (-t.size / 2 + iz * step) / tile + offset], v * 2)
      const shade = 0.7 + 0.5 * (hi > lo ? (h - lo) / (hi - lo) : 0.5)
      col.set([base.r * shade, base.g * shade, base.b * shade], v * 3)
    }
  const index: number[] = []
  for (let ix = 0; ix < t.n; ix++)
    for (let iz = 0; iz < t.n; iz++) {
      const a = ix * m + iz, b = (ix + 1) * m + iz, c = a + 1, d = b + 1
      index.push(a, c, b, b, c, d) // counter-clockwise seen from above
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setIndex(index)
  g.computeVertexNormals()
  if (tinted) tintByBiome(g, t, lo, hi)
  return g
}

/** Color the ground by height (valleys, middle, peaks) and slope (cliffs), tints that multiply with the texture. */
function tintByBiome(g: THREE.BufferGeometry, t: TerrainMesh, lo: number, hi: number): void {
  const p = t.palette ?? {}
  const low = new THREE.Color(p.low ?? '#d8cfa8'), mid = new THREE.Color(p.mid ?? '#ffffff'), high = new THREE.Color(p.high ?? '#e6e6e6'), steep = new THREE.Color(p.steep ?? '#9a9084')
  const pos = g.attributes.position, nor = g.attributes.normal
  const col = new Float32Array(pos.count * 3)
  const c = new THREE.Color()
  for (let v = 0; v < pos.count; v++) {
    const h = hi > lo ? (pos.getY(v) - lo) / (hi - lo) : 0.5
    if (h < 0.35) c.copy(low).lerp(mid, h / 0.35)
    else if (h < 0.7) c.copy(mid)
    else c.copy(mid).lerp(high, (h - 0.7) / 0.3)
    const slope = 1 - nor.getY(v) // 0 flat, toward 1 vertical
    c.lerp(steep, Math.min(1, Math.max(0, (slope - 0.06) / 0.16)))
    const shade = 0.82 + 0.3 * h // a little lighter on the hilltops
    col.set([c.r * shade, c.g * shade, c.b * shade], v * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
}

/**
 * A ground texture drawn once on a canvas, deterministically (a local seeded generator, so it looks the
 * same every time). 'static' is one big image stretched over the whole ground, so nothing repeats and
 * there are no seams: soft blotches at three scales, fine per-pixel grain, and a few flecks. 'grid'
 * is a small tile repeated over the ground: a one-unit grid with heavier lines every five.
 * `tile` is how many world units one copy covers, and `offset` shifts the texture coordinates.
 */
function groundTexture(kind: 'static' | 'grid' | 'none', size: number): { map: THREE.Texture; tile: number; offset: number } | null {
  if (kind === 'none') return null
  const N = kind === 'grid' ? 256 : 1024
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = N
  const c = canvas.getContext('2d')!
  let seed = 12345
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  let tile: number
  let offset = 0
  if (kind === 'grid') {
    tile = 5
    c.fillStyle = '#d8d8d8'
    c.fillRect(0, 0, N, N)
    const cell = N / 5
    c.strokeStyle = 'rgba(0,0,0,0.22)'
    c.lineWidth = 2
    for (let i = 0; i <= 5; i++) {
      c.beginPath(); c.moveTo(i * cell, 0); c.lineTo(i * cell, N); c.moveTo(0, i * cell); c.lineTo(N, i * cell); c.stroke()
    }
    c.strokeStyle = 'rgba(0,0,0,0.5)'
    c.lineWidth = 5
    c.strokeRect(0, 0, N, N)
  } else {
    tile = size
    offset = 0.5
    // value noise on a random lattice, smoothly interpolated; three scales added together
    const lattice = (cells: number) => Float32Array.from({ length: (cells + 1) * (cells + 1) }, rnd)
    const octaves = [{ cells: 6, grid: lattice(6), weight: 0.5 }, { cells: 24, grid: lattice(24), weight: 0.3 }, { cells: 96, grid: lattice(96), weight: 0.2 }]
    const smooth = (t: number) => t * t * (3 - 2 * t)
    const img = c.createImageData(N, N)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        let v = 0
        for (const o of octaves) {
          const fx = (x / N) * o.cells, fy = (y / N) * o.cells
          const ix = Math.floor(fx), iy = Math.floor(fy)
          const tx = smooth(fx - ix), ty = smooth(fy - iy)
          const row = o.cells + 1
          const top = o.grid[iy * row + ix] * (1 - tx) + o.grid[iy * row + ix + 1] * tx
          const bot = o.grid[(iy + 1) * row + ix] * (1 - tx) + o.grid[(iy + 1) * row + ix + 1] * tx
          v += (top * (1 - ty) + bot * ty) * o.weight
        }
        const grain = 0.86 + rnd() * 0.14
        const k = (0.72 + 0.28 * v) * grain * 255
        const i = (y * N + x) * 4
        img.data[i] = img.data[i + 1] = img.data[i + 2] = k
        img.data[i + 3] = 255
      }
    c.putImageData(img, 0, 0)
    for (let i = 0; i < 2500; i++) {
      c.fillStyle = rnd() < 0.6 ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.28)'
      const r = 0.8 + rnd() * 1.8
      c.fillRect(rnd() * N, rnd() * N, r, r)
    }
  }
  const map = new THREE.CanvasTexture(canvas)
  map.wrapS = map.wrapT = kind === 'grid' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 4
  return { map, tile, offset }
}

/** Every mesh in a glTF file as one geometry (positions and normals only), in the file's own coordinates. */
async function loadMergedGeometry(url: string): Promise<THREE.BufferGeometry> {
  const gltf = await new GLTFLoader().loadAsync(url)
  gltf.scene.updateMatrixWorld(true)
  const parts: THREE.BufferGeometry[] = []
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name)
    g.applyMatrix4(mesh.matrixWorld)
    if (!g.attributes.normal) g.computeVertexNormals()
    parts.push(g)
  })
  if (!parts.length) throw new Error('the file has no meshes')
  const merged = mergeGeometries(parts, false)
  if (!merged) throw new Error('the meshes could not be merged')
  return merged
}
