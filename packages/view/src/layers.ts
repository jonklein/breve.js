import * as THREE from 'three'
import type { WorldFrame } from './world-view'

const MAX_INSTANCES = 5000
const MAX_CUBES = 200000

function color(v: string): THREE.Color {
  try { return new THREE.Color(v) } catch { return new THREE.Color('#ffffff') }
}

/** One set of free agents, drawn as cones that point the way they move. */
export class AgentLayer {
  private mesh: THREE.InstancedMesh
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private p = new THREE.Vector3()
  private d = new THREE.Vector3()
  private c = new THREE.Color()
  private fwd = new THREE.Vector3(0, 0, 1)
  private big = new THREE.Vector3(1, 1, 1)
  /** Highlighted row (the one being inspected), or -1. */
  selected = -1

  constructor(private scene: THREE.Scene) {
    const geo = new THREE.ConeGeometry(0.32, 1.3, 8)
    geo.rotateX(Math.PI / 2)
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), MAX_INSTANCES)
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

  setVisible(on: boolean): void { this.mesh.visible = on }

  /** `fixed` is the color every agent gets, or null to color by heading. */
  update(f: WorldFrame, fixed: THREE.Color | null): void {
    this.mesh.visible = true
    const own = f.color ? color(f.color) : fixed
    const sc = f.scale ?? 1
    const n = Math.min(f.count, MAX_INSTANCES)
    this.mesh.count = n
    const colors = this.mesh.instanceColor!
    const { pos, vel } = f
    if (!vel) return
    for (let i = 0; i < n; i++) {
      this.p.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
      this.d.set(vel[i * 3], vel[i * 3 + 1], vel[i * 3 + 2])
      const len = this.d.length()
      if (len > 1e-6) this.d.multiplyScalar(1 / len)
      else this.d.copy(this.fwd)
      this.q.setFromUnitVectors(this.fwd, this.d)
      this.m.compose(this.p, this.q, this.selected === i ? this.big.setScalar(1.8 * sc) : this.big.setScalar(sc))
      this.mesh.setMatrixAt(i, this.m)
      // heading as colour: boids flying the same way share a colour
      if (this.selected === i) this.c.set('#ffffff')
      else if (f.colors) this.c.setRGB(f.colors[i * 3] / 255, f.colors[i * 3 + 1] / 255, f.colors[i * 3 + 2] / 255)
      else if (own) this.c.copy(own)
      else this.c.setRGB(0.35 + 0.65 * (this.d.x * 0.5 + 0.5), 0.35 + 0.65 * (this.d.y * 0.5 + 0.5), 0.35 + 0.65 * (this.d.z * 0.5 + 0.5))
      colors.setXYZ(i, this.c.r, this.c.g, this.c.b)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    colors.needsUpdate = true
  }

  dispose(): void {
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh.dispose()
  }
}

/** One lattice, drawn as cubes that grow in and out. The mesh grows when a bigger grid arrives. */
export class CellLayer {
  private cubes: THREE.InstancedMesh | null = null
  private capacity = 0
  private cells: {
    dims: [number, number, number]
    spacing: number
    unit: number
    thick: [number, number, number]
    tau: number
    scale: Float32Array
    target: Uint8Array
    color: Float32Array
    /** red, green, blue per cell (0 to 255) when the script's `display` gives colors */
    rgb: Uint8Array | null
    palette: THREE.Color[] | null
    animating: boolean
  } | null = null
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private p = new THREE.Vector3()
  private d = new THREE.Vector3()
  private c = new THREE.Color()
  private fixed: THREE.Color | null = null
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

  private ensure(n: number): THREE.InstancedMesh {
    const need = Math.min(Math.max(n, 1), MAX_CUBES)
    if (this.cubes && need <= this.capacity) return this.cubes
    this.dispose()
    this.capacity = need
    this.rows = new Int32Array(need)
    const cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), need)
    cubes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(need * 3), 3)
    cubes.frustumCulled = false
    cubes.count = 0
    this.scene.add(cubes)
    return (this.cubes = cubes)
  }

  /** Take a new frame: set where each cell is heading; `animate` does the easing. */
  set(f: WorldFrame, fixed: THREE.Color | null): void {
    const L = f.lattice!
    const { dims, spacing, show, fade } = L
    const n = show.length
    this.ensure(n).visible = true
    this.fixed = fixed
    let c = this.cells
    if (!c || c.scale.length !== n || c.dims.some((d, i) => d !== dims[i])) {
      c = this.cells = { dims, spacing, unit: f.unit, thick: [1, 1, 1], tau: 0.1, scale: Float32Array.from(show), target: new Uint8Array(n), color: new Float32Array(n), rgb: null, palette: null, animating: true }
    }
    c.spacing = spacing
    c.unit = f.unit
    // a flat grid (size 1 on one axis) can be drawn as thin tiles
    const t = L.thickness ?? 1
    c.thick = [dims[0] === 1 ? t : 1, dims[1] === 1 ? t : 1, dims[2] === 1 ? t : 1]
    c.palette = L.palette ? L.palette.map(color) : null
    c.rgb = L.rgb ?? null
    // `fade` is the fraction of a tick over which cells ease in and out; 0 snaps them instantly
    c.tau = fade > 0 ? fade / (3 * (f.rate ?? 8)) : 0
    c.target.set(show)
    if (fade <= 0) c.scale.set(show)
    for (let i = 0; i < n; i++) if (show[i] && f.attr) c.color[i] = f.attr[i]
    c.animating = true
  }

  private tint(v: number, out: THREE.Color): void {
    const pal = this.cells!.palette
    if (!pal) { out.setRGB(1 - v, v, 0.05); return } // young cells red, old cells green
    const x = Math.min(1, Math.max(0, v)) * (pal.length - 1)
    const i = Math.min(pal.length - 2, Math.floor(x))
    out.copy(pal[i]).lerp(pal[i + 1], x - i)
  }

  animate(dt: number): void {
    const c = this.cells, cubes = this.cubes
    if (!c || !cubes || !cubes.visible || !c.animating) return
    const [nx, ny, nz] = c.dims
    const k = c.tau > 0 ? 1 - Math.exp(-dt / c.tau) : 1
    const colors = cubes.instanceColor!
    let moving = false
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
      const u = c.unit * s * s * (3 - 2 * s) // smoothstep, so growth starts and ends gently
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
      else if (this.fixed && !c.palette) this.c.copy(this.fixed)
      else this.tint(c.color[i], this.c)
      colors.setXYZ(w, this.c.r, this.c.g, this.c.b)
      w++
    }
    cubes.count = w
    cubes.instanceMatrix.needsUpdate = true
    colors.needsUpdate = true
    c.animating = moving
  }

  dispose(): void {
    if (!this.cubes) return
    this.scene.remove(this.cubes)
    this.cubes.geometry.dispose()
    ;(this.cubes.material as THREE.Material).dispose()
    this.cubes.dispose()
    this.cubes = null
    this.capacity = 0
    if (this.cells) this.cells.animating = true
  }
}

/** A network: nodes as small spheres where the layout put them, links as thin lines. */
export class GraphLayer {
  private mesh: THREE.InstancedMesh | null = null
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

  pick(ray: THREE.Raycaster): { row: number; distance: number } | null {
    if (!this.mesh) return null
    this.mesh.boundingSphere = null
    const hit = ray.intersectObject(this.mesh)[0]
    return hit && hit.instanceId !== undefined ? { row: hit.instanceId, distance: hit.distance } : null
  }

  update(f: WorldFrame, fixed: THREE.Color | null): void {
    const g = f.graph
    if (!g) return
    const n = f.count
    if (!this.mesh || this.capacity < n) {
      this.disposeNodes()
      this.capacity = n
      this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 14, 10), new THREE.MeshLambertMaterial(), Math.max(1, n))
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3)
      this.mesh.frustumCulled = false
      this.scene.add(this.mesh)
    }
    this.mesh.visible = true
    this.mesh.count = n
    const pal = (g.palette ?? ['#ff4d4d', '#4dff88']).map((x) => color(x))
    const base = (f.scale ?? 1) * g.nodeSize * 0.9
    for (let i = 0; i < n; i++) {
      this.p.set(f.pos[i * 3], f.pos[i * 3 + 1], f.pos[i * 3 + 2])
      const big = this.selected === i ? 1.8 : 1
      this.s.setScalar(base * big)
      this.m.compose(this.p, this.q, this.s)
      this.mesh.setMatrixAt(i, this.m)
      if (this.selected === i) this.c.set('#ffffff')
      else if (f.colors) this.c.setRGB(f.colors[i * 3] / 255, f.colors[i * 3 + 1] / 255, f.colors[i * 3 + 2] / 255)
      else if (f.attr) {
        const x = Math.min(1, Math.max(0, f.attr[i])) * (pal.length - 1)
        const k = Math.min(pal.length - 2, Math.floor(x))
        this.c.copy(pal[k]).lerp(pal[k + 1], x - k)
      } else this.c.copy(fixed ?? pal[0])
      this.mesh.setColorAt(i, this.c)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
    if (g.version !== this.version) this.drawLinks(f)
    if (this.lines) this.lines.visible = true
  }

  private drawLinks(f: WorldFrame): void {
    this.version = f.graph!.version
    this.disposeLines()
    const e = f.graph!.edges
    const pos = new Float32Array(e.length * 3)
    for (let i = 0; i < e.length; i++) pos.set([f.pos[e[i] * 3], f.pos[e[i] * 3 + 1], f.pos[e[i] * 3 + 2]], i * 3)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#6b7a99', transparent: true, opacity: 0.35 }))
    this.lines.frustumCulled = false
    this.scene.add(this.lines)
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
