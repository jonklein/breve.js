import * as THREE from 'three'
import type { WorldFrame } from './world-view'
import { alphaMaterial, blend, withAlpha } from './alpha'
import { applyMaterial, shapeGeometry, type Fallback } from './style'
import { groundSquare, loadSprite, spriteMaterial } from './sprite'
import { Trails } from './trails'

const MAX_INSTANCES = 5000
const MAX_CUBES = 200000
const DEFAULT_CELL = '#4f86f7'
const DEFAULT_NODE = '#4dff88'

function color(v: string): THREE.Color {
  try { return new THREE.Color(v) } catch { return new THREE.Color('#ffffff') }
}

/** One set of free agents, drawn as cones that point the way they move. */
export class AgentLayer {
  private mesh: THREE.InstancedMesh
  private alpha: THREE.InstancedBufferAttribute
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private p = new THREE.Vector3()
  private d = new THREE.Vector3()
  private c = new THREE.Color()
  private fwd = new THREE.Vector3(0, 0, 1)
  private big = new THREE.Vector3(1, 1, 1)
  /** Highlighted row (the one being inspected), or -1. */
  selected = -1
  /** Where a relative sprite image path starts (a URL ending in `/`). */
  assetBase = ''
  private lit: THREE.Material
  private dir: THREE.InstancedBufferAttribute
  private spriteMat: THREE.Material | null = null
  private trails: Trails | null = null
  private trailRgb = new Float32Array(0)

  constructor(private scene: THREE.Scene, shadowsOn = false) {
    const geo = new THREE.ConeGeometry(0.32, 1.3, 20, 1) // enough sides that the cone reads as round
    geo.rotateX(Math.PI / 2)
    this.lit = alphaMaterial()
    this.mesh = new THREE.InstancedMesh(geo, this.lit, MAX_INSTANCES)
    this.mesh.castShadow = shadowsOn
    this.alpha = withAlpha(this.mesh, MAX_INSTANCES)
    this.dir = new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 3), 3)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 3), 3)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    scene.add(this.mesh)
  }

  get object(): THREE.InstancedMesh { return this.mesh }

  /** The nearest agent under a ray: its row and how far away it is. */
  pick(ray: THREE.Raycaster): { row: number; distance: number } | null {
    this.mesh.boundingSphere = null
    const hit = ray.intersectObject(this.mesh)[0]
    return hit && hit.instanceId !== undefined ? { row: hit.instanceId, distance: hit.distance } : null
  }

  setVisible(on: boolean): void { this.mesh.visible = on; this.trails?.setVisible(on) }

  setShadows(on: boolean): void { this.mesh.castShadow = on }

  /** `fixed` is the color every agent gets, or null to color by heading. */
  private styleKey = ''
  /** Pick up the set's shape and material settings when they change. */
  private restyle(style: WorldFrame['style']): void {
    const key = JSON.stringify(style ?? null)
    if (key === this.styleKey) return
    this.styleKey = key
    const old = this.mesh.geometry
    const sprite = style?.sprite
    this.spriteMat?.dispose()
    this.spriteMat = null
    if (sprite) {
      // a flat picture (facing the camera, or lying on the ground), drawn unlit
      const flat = sprite.facing === 'ground'
      this.mesh.geometry = flat ? groundSquare(0.08) : new THREE.PlaneGeometry(1, 1)
      this.mesh.geometry.setAttribute('instanceDir', this.dir)
      const m = spriteMaterial(flat ? 'ground' : 'camera', !!sprite.turn)
      m.map = loadSprite(new URL(sprite.image, this.assetBase || (typeof location !== 'undefined' ? location.href : undefined)).href, () => { m.needsUpdate = true })
      this.mesh.material = this.spriteMat = m
      this.mesh.castShadow = false
    } else {
      this.mesh.geometry = shapeGeometry(style?.shape, 'cone')
      this.mesh.material = this.lit
    }
    this.mesh.geometry.setAttribute('instanceAlpha', this.alpha)
    old.dispose()
    this.mesh.boundingSphere = null
    if (!sprite) applyMaterial(this.lit as THREE.MeshStandardMaterial, style)
  }

  update(f: WorldFrame, fixed: THREE.Color | null): void {
    this.mesh.visible = true
    this.restyle(f.style)
    const own = f.color ? color(f.color) : fixed
    const sc = f.scale ?? 1
    const n = Math.min(f.count, MAX_INSTANCES)
    this.mesh.count = n
    const colors = this.mesh.instanceColor!
    const { pos, vel } = f
    const look = f.look
    if (!vel) return
    let see = false
    for (let i = 0; i < n; i++) {
      this.p.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
      this.d.set(vel[i * 3], vel[i * 3 + 1], vel[i * 3 + 2])
      const len = this.d.length()
      if (len > 1e-6) this.d.multiplyScalar(1 / len)
      else this.d.copy(this.fwd)
      this.q.setFromUnitVectors(this.fwd, this.d)
      // `display` can hide an agent or resize it; a hidden agent is drawn at size zero
      const size = look?.visible && !look.visible[i] ? 0 : sc * (look?.scale ? look.scale[i] : 1)
      this.m.compose(this.p, this.q, this.big.setScalar(this.selected === i ? 1.8 * size : size))
      this.mesh.setMatrixAt(i, this.m)
      this.dir.setXYZ(i, this.d.x, this.d.y, this.d.z)
      const a = look?.alpha ? look.alpha[i] / 255 : 1
      if (a < 1) see = true
      this.alpha.setX(i, a)
      // heading as colour: boids flying the same way share a colour
      if (this.selected === i) this.c.set('#ffffff')
      else if (look?.rgb) this.c.setRGB(look.rgb[i * 3] / 255, look.rgb[i * 3 + 1] / 255, look.rgb[i * 3 + 2] / 255)
      else if (own) this.c.copy(own)
      else this.c.setRGB(0.35 + 0.65 * (this.d.x * 0.5 + 0.5), 0.35 + 0.65 * (this.d.y * 0.5 + 0.5), 0.35 + 0.65 * (this.d.z * 0.5 + 0.5))
      colors.setXYZ(i, this.c.r, this.c.g, this.c.b)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    colors.needsUpdate = true
    this.alpha.needsUpdate = true
    this.dir.needsUpdate = true
    blend(this.mesh.material as THREE.Material, see)
    this.updateTrails(f, n, colors)
  }

  /** `style.trail`: a fading line behind each agent, in the agent's own color. */
  private updateTrails(f: WorldFrame, n: number, colors: THREE.InstancedBufferAttribute): void {
    const t = f.style?.trail
    const length = typeof t === 'number' ? t : t?.length ?? 0
    if (length < 2) { this.trails?.dispose(); this.trails = null; return }
    const strength = typeof t === 'object' ? t.strength ?? 1 : 1
    this.trails ??= new Trails(this.scene)
    if (this.trailRgb.length < n * 3) this.trailRgb = new Float32Array(n * 3)
    for (let i = 0; i < n * 3; i++) this.trailRgb[i] = colors.array[i]
    this.trails.push(n, f.pos, this.trailRgb, length, strength)
  }

  dispose(): void {
    this.trails?.dispose()
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    this.lit.dispose()
    this.spriteMat?.dispose()
    this.mesh.dispose()
  }
}

/** One lattice, drawn as cubes that grow in and out. The mesh grows when a bigger grid arrives. */
export class CellLayer {
  private cubes: THREE.InstancedMesh | null = null
  private alpha: THREE.InstancedBufferAttribute | null = null
  private capacity = 0
  private cells: {
    dims: [number, number, number]
    spacing: number
    unit: number
    thick: [number, number, number]
    tau: number
    scale: Float32Array
    target: Uint8Array
    /** from the script's `display`, per cell: red, green, blue (0 to 255), opacity (0 to 255), size multiplier */
    rgb: Uint8Array | null
    alpha: Uint8Array | null
    sizes: Float32Array | null
    animating: boolean
  } | null = null
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private p = new THREE.Vector3()
  private d = new THREE.Vector3()
  private c = new THREE.Color()
  private fixed: THREE.Color | null = null
  private fallback = color(DEFAULT_CELL)
  /** Which lattice row each drawn cube is, so a click on a cube can name its cell. */
  private rows = new Int32Array(0)

  constructor(private scene: THREE.Scene) {}

  pick(ray: THREE.Raycaster): { row: number; distance: number } | null {
    if (!this.cubes || !this.cubes.visible) return null
    this.cubes.boundingSphere = null
    const hit = ray.intersectObject(this.cubes)[0]
    return hit && hit.instanceId !== undefined ? { row: this.rows[hit.instanceId], distance: hit.distance } : null
  }

  setVisible(on: boolean): void { if (this.cubes) this.cubes.visible = on }

  private shadows = false
  setShadows(on: boolean): void {
    this.shadows = on
    if (this.cubes) this.cubes.castShadow = on
  }

  private ensure(n: number): THREE.InstancedMesh {
    const need = Math.min(Math.max(n, 1), MAX_CUBES)
    if (this.cubes && need <= this.capacity) return this.cubes
    this.dispose()
    this.capacity = need
    this.rows = new Int32Array(need)
    this.styleKey = ''
    const cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), alphaMaterial(), need)
    this.alpha = withAlpha(cubes, need)
    cubes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(need * 3), 3)
    cubes.frustumCulled = false
    cubes.castShadow = this.shadows
    cubes.count = 0
    this.scene.add(cubes)
    return (this.cubes = cubes)
  }

  private styleKey = ''
  /** Pick up the set's shape and material settings when they change (a new mesh starts over). */
  private restyle(cubes: THREE.InstancedMesh, style: WorldFrame['style']): void {
    const key = JSON.stringify(style ?? null)
    if (key === this.styleKey) return
    this.styleKey = key
    const old = cubes.geometry
    cubes.geometry = shapeGeometry(style?.shape, 'cube')
    cubes.geometry.setAttribute('instanceAlpha', this.alpha!)
    old.dispose()
    cubes.boundingSphere = null
    applyMaterial(cubes.material as THREE.MeshStandardMaterial, style)
  }

  /** Take a new frame: set where each cell is heading; `animate` does the easing. */
  set(f: WorldFrame, fixed: THREE.Color | null): void {
    const L = f.lattice!
    const { dims, spacing, show, fade } = L
    const n = show.length
    const cubes = this.ensure(n)
    cubes.visible = true
    this.restyle(cubes, f.style)
    this.fixed = fixed
    let c = this.cells
    if (!c || c.scale.length !== n || c.dims.some((d, i) => d !== dims[i])) {
      c = this.cells = { dims, spacing, unit: f.unit, thick: [1, 1, 1], tau: 0.1, scale: Float32Array.from(show), target: new Uint8Array(n), rgb: null, alpha: null, sizes: null, animating: true }
    }
    c.spacing = spacing
    c.unit = f.unit
    // a flat grid (size 1 on one axis) can be drawn as thin tiles
    const t = L.thickness ?? 1
    c.thick = [dims[0] === 1 ? t : 1, dims[1] === 1 ? t : 1, dims[2] === 1 ? t : 1]
    c.rgb = L.rgb ?? null
    c.alpha = L.alpha ?? null
    c.sizes = L.sizes ?? null
    // `fade` is the fraction of a tick over which cells ease in and out; 0 snaps them instantly
    c.tau = fade > 0 ? fade / (3 * (f.rate ?? 8)) : 0
    c.target.set(show)
    if (fade <= 0) c.scale.set(show)
    c.animating = true
  }

  animate(dt: number): void {
    const c = this.cells, cubes = this.cubes
    if (!c || !cubes || !cubes.visible || !c.animating) return
    const [nx, ny, nz] = c.dims
    const k = c.tau > 0 ? 1 - Math.exp(-dt / c.tau) : 1
    const colors = cubes.instanceColor!
    let moving = false
    let see = false
    let w = 0
    this.q.identity()
    for (let i = 0; i < c.scale.length && w < this.capacity; i++) {
      let s = c.scale[i]
      const t = c.target[i]
      if (s !== t) {
        s += (t - s) * k
        if (Math.abs(t - s) < 0.02) s = t
        else moving = true
        c.scale[i] = s
      }
      if (s <= 0) continue
      const u = c.unit * s * s * (3 - 2 * s) * (c.sizes ? c.sizes[i] : 1) // smoothstep, so growth starts and ends gently
      this.p.set(
        ((i % nx) - (nx - 1) / 2) * c.spacing,
        ((Math.floor(i / nx) % ny) - (ny - 1) / 2) * c.spacing,
        (Math.floor(i / (nx * ny)) - (nz - 1) / 2) * c.spacing,
      )
      this.d.set(u * c.thick[0], u * c.thick[1], u * c.thick[2])
      this.m.compose(this.p, this.q, this.d)
      cubes.setMatrixAt(w, this.m)
      this.rows[w] = i
      if (c.rgb) this.c.setRGB(c.rgb[i * 3] / 255, c.rgb[i * 3 + 1] / 255, c.rgb[i * 3 + 2] / 255)
      else this.c.copy(this.fixed ?? this.fallback)
      colors.setXYZ(w, this.c.r, this.c.g, this.c.b)
      const a = c.alpha ? c.alpha[i] / 255 : 1
      if (a < 1) see = true
      this.alpha!.setX(w, a)
      w++
    }
    cubes.count = w
    cubes.instanceMatrix.needsUpdate = true
    colors.needsUpdate = true
    this.alpha!.needsUpdate = true
    blend(cubes.material as THREE.Material, see)
    c.animating = moving
  }

  dispose(): void {
    if (!this.cubes) return
    this.scene.remove(this.cubes)
    this.cubes.geometry.dispose()
    ;(this.cubes.material as THREE.Material).dispose()
    this.cubes.dispose()
    this.cubes = null
    this.alpha = null
    this.capacity = 0
    if (this.cells) this.cells.animating = true
  }
}

/** A network: nodes as small spheres where the layout put them, links as thin lines. */
export class GraphLayer {
  private mesh: THREE.InstancedMesh | null = null
  private alpha: THREE.InstancedBufferAttribute | null = null
  private lines: THREE.LineSegments | null = null
  private version = -1
  private capacity = 0
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private p = new THREE.Vector3()
  private s = new THREE.Vector3()
  private c = new THREE.Color()
  selected = -1

  constructor(private scene: THREE.Scene) {}

  setVisible(on: boolean): void {
    if (this.mesh) this.mesh.visible = on
    if (this.lines) this.lines.visible = on
  }

  private shadows = false
  setShadows(on: boolean): void {
    this.shadows = on
    if (this.mesh) this.mesh.castShadow = on
  }

  pick(ray: THREE.Raycaster): { row: number; distance: number } | null {
    if (!this.mesh) return null
    this.mesh.boundingSphere = null
    const hit = ray.intersectObject(this.mesh)[0]
    return hit && hit.instanceId !== undefined ? { row: hit.instanceId, distance: hit.distance } : null
  }

  private styleKey = ''
  private restyle(style: WorldFrame['style']): void {
    const key = JSON.stringify(style ?? null)
    if (key === this.styleKey || !this.mesh) return
    this.styleKey = key
    const old = this.mesh.geometry
    this.mesh.geometry = shapeGeometry(style?.shape, 'sphere')
    this.mesh.geometry.setAttribute('instanceAlpha', this.alpha!)
    old.dispose()
    this.mesh.boundingSphere = null
    applyMaterial(this.mesh.material as THREE.MeshStandardMaterial, style)
  }

  update(f: WorldFrame, fixed: THREE.Color | null): void {
    const g = f.graph
    if (!g) return
    const n = f.count
    if (!this.mesh || this.capacity < n) {
      this.disposeNodes()
      this.styleKey = '' // a new mesh takes the set's style afresh
      this.capacity = n
      this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 28, 18), alphaMaterial(), Math.max(1, n))
      this.mesh.castShadow = this.shadows
      this.alpha = withAlpha(this.mesh, Math.max(1, n))
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3)
      this.mesh.frustumCulled = false
      this.scene.add(this.mesh)
    }
    this.mesh.visible = true
    this.restyle(f.style)
    this.mesh.count = n
    const look = f.look
    let see = false
    const base = (f.scale ?? 1) * g.nodeSize * 0.9
    for (let i = 0; i < n; i++) {
      this.p.set(f.pos[i * 3], f.pos[i * 3 + 1], f.pos[i * 3 + 2])
      const big = this.selected === i ? 1.8 : 1
      const size = look?.visible && !look.visible[i] ? 0 : look?.scale ? look.scale[i] : 1
      this.s.setScalar(base * big * size)
      this.m.compose(this.p, this.q, this.s)
      this.mesh.setMatrixAt(i, this.m)
      if (this.selected === i) this.c.set('#ffffff')
      else if (look?.rgb) this.c.setRGB(look.rgb[i * 3] / 255, look.rgb[i * 3 + 1] / 255, look.rgb[i * 3 + 2] / 255)
      else this.c.copy(fixed ?? color(DEFAULT_NODE))
      const a = look?.alpha ? look.alpha[i] / 255 : 1
      if (a < 1) see = true
      this.alpha!.setX(i, a)
      this.mesh.setColorAt(i, this.c)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
    this.alpha!.needsUpdate = true
    blend(this.mesh.material as THREE.Material, see)
    if (g.version !== this.version) this.drawLinks(f)
    if (this.lines) { this.lines.visible = true; this.colorLinks(f) }
  }

  private drawLinks(f: WorldFrame): void {
    this.version = f.graph!.version
    this.disposeLines()
    const e = f.graph!.edges
    const pos = new Float32Array(e.length * 3)
    for (let i = 0; i < e.length; i++) pos.set([f.pos[e[i] * 3], f.pos[e[i] * 3 + 1], f.pos[e[i] * 3 + 2]], i * 3)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(e.length * 3), 3).setUsage(THREE.DynamicDrawUsage))
    // links glow softly in the colors of the nodes they join (additive, so they never hide what is behind them)
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.lines.frustumCulled = false
    this.scene.add(this.lines)
  }

  /** Each end of a link takes the color of its node (dimmed), so links read as part of the graph and change with it. */
  private colorLinks(f: WorldFrame): void {
    const e = f.graph!.edges
    const col = this.lines!.geometry.attributes.color as THREE.BufferAttribute
    const src = this.mesh!.instanceColor!.array
    for (let i = 0; i < e.length; i++) {
      const k = e[i] * 3
      col.array[i * 3] = src[k] * 0.45
      col.array[i * 3 + 1] = src[k + 1] * 0.45
      col.array[i * 3 + 2] = src[k + 2] * 0.45
    }
    col.needsUpdate = true
  }

  private disposeNodes(): void {
    if (!this.mesh) return
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh.dispose()
    this.mesh = null
  }

  private disposeLines(): void {
    if (!this.lines) return
    this.scene.remove(this.lines)
    this.lines.geometry.dispose()
    ;(this.lines.material as THREE.Material).dispose()
    this.lines = null
  }

  dispose(): void {
    this.disposeNodes()
    this.disposeLines()
    this.version = -1
  }
}
