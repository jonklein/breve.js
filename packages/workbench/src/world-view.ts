import * as THREE from 'three'
import type { RigidFrame } from '@breve/core'
import { RigidView } from './rigid-view'

const MAX_INSTANCES = 5000
const MAX_CUBES = 200000

/** What the view needs from a simulation frame. */
export interface WorldFrame {
  rigid?: RigidFrame
  kind: 'agents' | 'lattice' | 'bodies'
  count: number
  size: number
  unit: number
  pos: Float32Array
  vel: Float32Array | null
  attr: Float32Array | null
  lattice?: { dims: [number, number, number]; spacing: number; show: Uint8Array; fade: number }
  rate?: number
}

export interface WorldLook {
  sky?: unknown
  grid?: unknown
  boundsColor?: unknown
  agentColor?: unknown
  shadows?: unknown
}

const DEFAULTS = { top: '#0b1226', horizon: '#2a4a7a', bounds: '#3a4658' }

function parseColor(v: unknown, fallback: string): THREE.Color {
  try {
    if (typeof v === 'string') return new THREE.Color(v)
  } catch { /* fall through to the default */ }
  return new THREE.Color(fallback)
}

/**
 * Everything drawn for one world: sky, bounds, agents, lattice cells, creatures and ground. It knows nothing about
 * canvases, so one renderer can draw several of them (the sweep tiles), each into its own rectangle.
 */
export class WorldView {
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  /** Where the camera looks. The single view hands in its OrbitControls; tiles use this stand-in. */
  readonly controls: { target: THREE.Vector3 }
  private mesh: THREE.InstancedMesh
  private cubes: THREE.InstancedMesh
  private cubeCapacity = 0
  /** Per-cell display state for lattices, so cells grow and shrink instead of popping. */
  private cells: {
    dims: [number, number, number]
    spacing: number
    unit: number
    tau: number
    scale: Float32Array
    target: Uint8Array
    color: Float32Array
    animating: boolean
  } | null = null
  private lastTime = performance.now()
  private rigid: RigidView
  private box: THREE.LineSegments | null = null
  private boxSize = 0
  private sky: THREE.Mesh
  private skyUniforms = { top: { value: new THREE.Color(DEFAULTS.top) }, horizon: { value: new THREE.Color(DEFAULTS.horizon) } }
  private grid: THREE.GridHelper | null = null
  private gridWanted = true
  private boundsColor = new THREE.Color(DEFAULTS.bounds)
  private fixedColor: THREE.Color | null = null
  private sun = new THREE.DirectionalLight(0xffffff, 1.6)
  private shadowsWanted: boolean | undefined
  private shadowsOn = false
  private shadowSize = 0
  private isBodies = false
  private tmpM = new THREE.Matrix4()
  private tmpQ = new THREE.Quaternion()
  private tmpP = new THREE.Vector3()
  private tmpD = new THREE.Vector3()
  private tmpC = new THREE.Color()
  private fwd = new THREE.Vector3(0, 0, 1)
  private one = new THREE.Vector3(1, 1, 1)

  constructor(private renderer: THREE.WebGLRenderer, camera?: THREE.PerspectiveCamera, controls?: { target: THREE.Vector3 }) {
    this.camera = camera ?? new THREE.PerspectiveCamera(55, 1, 0.1, 1000)
    this.controls = controls ?? { target: new THREE.Vector3() }
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(500, 24, 16),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vDir; void main() { float t = vDir.y; vec3 c = t >= 0.0 ? mix(horizon, top, pow(t, 0.6)) : horizon * (1.0 - 0.55 * min(1.0, -t * 2.0)); gl_FragColor = vec4(c, 1.0); }',
      }),
    )
    this.sky.renderOrder = -1
    this.sky.frustumCulled = false
    this.scene.add(this.sky)
    this.camera.position.set(55, 35, 55)

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9))
    this.sun.position.set(30, 60, 20)
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.06
    this.scene.add(this.sun, this.sun.target)
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.rigid = new RigidView(this.scene, this.camera, this.controls)

    const geo = new THREE.ConeGeometry(0.32, 1.3, 8)
    geo.rotateX(Math.PI / 2)
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), MAX_INSTANCES)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 3), 3)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.scene.add(this.mesh)

    this.cubes = this.makeCubes(1024)

  }

  /** Cubes for lattice cells; the mesh is rebuilt bigger when a lattice needs more than it holds. */
  private makeCubes(capacity: number): THREE.InstancedMesh {
    this.cubeCapacity = capacity
    const cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), capacity)
    cubes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    cubes.frustumCulled = false
    cubes.count = 0
    cubes.visible = false
    this.scene.add(cubes)
    return cubes
  }

  private ensureCubes(n: number): void {
    const need = Math.min(n, MAX_CUBES)
    if (need <= this.cubeCapacity) return
    this.scene.remove(this.cubes)
    this.cubes.geometry.dispose()
    ;(this.cubes.material as THREE.Material).dispose()
    this.cubes.dispose()
    this.cubes = this.makeCubes(need)
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  /** Advance animations by `dt` seconds and keep the sky around the camera. */
  tick(dt: number): void {
    this.animateCells(dt)
    this.sky.position.copy(this.camera.position)
  }

  private setBounds(size: number): void {
    if (size === this.boxSize) return
    this.boxSize = size
    this.controls.target.set(0, 0, 0)
    this.camera.position.set(1, 0.6, 1).normalize().multiplyScalar(size * 3.1)
    if (this.box) { this.scene.remove(this.box); this.box.geometry.dispose() }
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(size * 2, size * 2, size * 2))
    this.box = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: this.boundsColor }))
    this.scene.add(this.box)
    this.rebuildGrid()
  }

  private rebuildGrid(): void {
    if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose() }
    this.grid = null
    if (!this.gridWanted || !this.boxSize) return
    this.grid = new THREE.GridHelper(this.boxSize * 2, 12, this.boundsColor, this.boundsColor)
    this.grid.position.y = -this.boxSize
    ;(this.grid.material as THREE.Material).opacity = 0.5
    ;(this.grid.material as THREE.Material).transparent = true
    this.scene.add(this.grid)
  }

  /** Apply the scene's `world` block. Anything missing or invalid falls back to the default. */
  setWorld(w: WorldLook | undefined): void {
    const sky = w?.sky
    if (typeof sky === 'string') {
      this.skyUniforms.top.value = parseColor(sky, DEFAULTS.top)
      this.skyUniforms.horizon.value = parseColor(sky, DEFAULTS.horizon)
    } else if (sky && typeof sky === 'object') {
      const o = sky as { top?: unknown; horizon?: unknown }
      this.skyUniforms.top.value = parseColor(o.top, DEFAULTS.top)
      this.skyUniforms.horizon.value = parseColor(o.horizon, DEFAULTS.horizon)
    } else {
      this.skyUniforms.top.value = new THREE.Color(DEFAULTS.top)
      this.skyUniforms.horizon.value = new THREE.Color(DEFAULTS.horizon)
    }
    this.gridWanted = w?.grid !== false
    this.boundsColor = parseColor(w?.boundsColor, DEFAULTS.bounds)
    if (this.box) (this.box.material as THREE.LineBasicMaterial).color.copy(this.boundsColor)
    this.rebuildGrid()
    this.shadowsWanted = typeof w?.shadows === 'boolean' ? w.shadows : undefined
    this.applyShadows()
    this.fixedColor = typeof w?.agentColor === 'string' && w.agentColor !== 'heading' ? parseColor(w.agentColor, '#ffffff') : null
  }

  /** Shadows default on for physics scenes (there is a ground to catch them) and off elsewhere. */
  private applyShadows(): void {
    const on = this.shadowsWanted ?? this.isBodies
    if (on === this.shadowsOn) return
    this.shadowsOn = on
    this.renderer.shadowMap.enabled = on
    this.sun.castShadow = on
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined
      if (m) m.needsUpdate = true
    })
    this.rigid.setShadows(on)
  }

  /** Aim the sun so its shadow map covers the whole arena. */
  private fitShadow(half: number): void {
    if (half === this.shadowSize) return
    this.shadowSize = half
    const cam = this.sun.shadow.camera
    const r = half * 1.15
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r
    cam.near = 1
    cam.far = half * 6
    cam.updateProjectionMatrix()
    this.sun.position.set(0.55, 1, 0.35).normalize().multiplyScalar(half * 2.5)
    this.sun.target.position.set(0, 0, 0)
  }

  update(f: WorldFrame): void {
    // physics scenes draw their own ground: hide the bounds box and floor grid the other kinds use
    const bodies = f.kind === 'bodies'
    this.isBodies = bodies
    this.applyShadows()
    this.rigid.setVisible(bodies)
    if (this.box) this.box.visible = !bodies
    if (this.grid) this.grid.visible = !bodies
    if (bodies) {
      this.mesh.visible = false
      this.cubes.visible = false
      if (f.rigid) this.rigid.update(f.rigid, f.size)
      this.fitShadow(f.size)
      return
    }
    this.setBounds(f.size)
    const lattice = f.kind === 'lattice'
    this.mesh.visible = !lattice
    this.cubes.visible = lattice
    if (lattice && f.lattice) { this.ensureCubes(f.lattice.show.length); this.cubes.visible = true; this.setCells({ ...f, lattice: f.lattice }) }
    else if (f.vel) this.updateAgents(f.count, f.pos, f.vel)
  }

  /** Take a new lattice frame: set where each cell is heading; animateCells does the easing. */
  private setCells(f: { unit: number; attr: Float32Array | null; rate?: number; lattice: { dims: [number, number, number]; spacing: number; show: Uint8Array; fade: number } }): void {
    const { dims, spacing, show, fade } = f.lattice
    const n = show.length
    let c = this.cells
    if (!c || c.scale.length !== n || c.dims.some((d, i) => d !== dims[i])) {
      c = this.cells = { dims, spacing, unit: f.unit, tau: 0.1, scale: Float32Array.from(show), target: new Uint8Array(n), color: new Float32Array(n), animating: true }
    }
    c.spacing = spacing
    c.unit = f.unit
    // `fade` is the fraction of a tick over which cells ease in and out; 0 snaps them instantly
    c.tau = fade > 0 ? fade / (3 * (f.rate ?? 8)) : 0
    c.target.set(show)
    if (fade <= 0) c.scale.set(show)
    for (let i = 0; i < n; i++) if (show[i] && f.attr) c.color[i] = f.attr[i]
    c.animating = true
  }

  private animateCells(dt: number): void {
    const c = this.cells
    if (!c || !this.cubes.visible || !c.animating) return
    const [nx, ny, nz] = c.dims
    const k = c.tau > 0 ? 1 - Math.exp(-dt / c.tau) : 1
    const colors = this.cubes.instanceColor!
    const fixed = this.fixedColor
    let moving = false
    let w = 0
    this.tmpQ.identity()
    for (let i = 0; i < c.scale.length && w < this.cubeCapacity; i++) {
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
      this.tmpP.set(
        ((i % nx) - (nx - 1) / 2) * c.spacing,
        ((Math.floor(i / nx) % ny) - (ny - 1) / 2) * c.spacing,
        (Math.floor(i / (nx * ny)) - (nz - 1) / 2) * c.spacing,
      )
      this.tmpD.set(u, u, u)
      this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpD)
      this.cubes.setMatrixAt(w, this.tmpM)
      if (fixed) this.tmpC.copy(fixed)
      else this.tmpC.setRGB(1 - c.color[i], c.color[i], 0.05) // young cells red, old cells green
      colors.setXYZ(w, this.tmpC.r, this.tmpC.g, this.tmpC.b)
      w++
    }
    this.cubes.count = w
    this.cubes.instanceMatrix.needsUpdate = true
    colors.needsUpdate = true
    c.animating = moving
  }

  private updateAgents(count: number, pos: Float32Array, vel: Float32Array): void {
    const n = Math.min(count, MAX_INSTANCES)
    this.mesh.count = n
    const colors = this.mesh.instanceColor!
    for (let i = 0; i < n; i++) {
      this.tmpP.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
      this.tmpD.set(vel[i * 3], vel[i * 3 + 1], vel[i * 3 + 2])
      const len = this.tmpD.length()
      if (len > 1e-6) this.tmpD.multiplyScalar(1 / len)
      else this.tmpD.copy(this.fwd)
      this.tmpQ.setFromUnitVectors(this.fwd, this.tmpD)
      this.tmpM.compose(this.tmpP, this.tmpQ, this.one)
      this.mesh.setMatrixAt(i, this.tmpM)
      // heading as colour: boids flying the same way share a colour
      if (this.fixedColor) this.tmpC.copy(this.fixedColor)
      else this.tmpC.setRGB(0.35 + 0.65 * (this.tmpD.x * 0.5 + 0.5), 0.35 + 0.65 * (this.tmpD.y * 0.5 + 0.5), 0.35 + 0.65 * (this.tmpD.z * 0.5 + 0.5))
      colors.setXYZ(i, this.tmpC.r, this.tmpC.g, this.tmpC.b)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    colors.needsUpdate = true
  }
}
