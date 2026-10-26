import * as THREE from 'three'
import type { RigidFrame } from '@breve/core'
import { RigidView } from './rigid-view'
import { AgentLayer, CellLayer, GraphLayer } from './layers'

/** What the view needs from a simulation frame. */
export interface WorldFrame {
  rigid?: RigidFrame
  kind: 'agents' | 'lattice' | 'bodies' | 'graph'
  count: number
  size: number
  unit: number
  pos: Float32Array
  vel: Float32Array | null
  attr: Float32Array | null
  lattice?: { dims: [number, number, number]; spacing: number; show: Uint8Array; fade: number; palette?: string[]; thickness?: number }
  graph?: { edges: Uint32Array; version: number; palette?: string[]; nodeSize: number }
  /** Per-set color for free agents. */
  color?: string
  scale?: number
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
  /** One layer per entity set, in scene order. */
  private layers: (AgentLayer | CellLayer | GraphLayer | null)[] = []
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

  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  /** Advance animations by `dt` seconds and keep the sky around the camera. */
  tick(dt: number): void {
    for (const l of this.layers) if (l instanceof CellLayer) l.animate(dt)
    this.sky.position.copy(this.camera.position)
  }

  private setBounds(size: number): void {
    if (size === this.boxSize) return
    this.boxSize = size
    this.controls.target.set(0, 0, 0)
    this.camera.position.set(1, 0.6, 1).normalize().multiplyScalar(size * 2.5)
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

  /** Where relative model paths (a part's `visual.gltf`) start: a URL ending in `/`. */
  setAssetBase(base: string): void {
    this.rigid.assetBase = base
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

  /** The agent layer drawing entity set `i`, if it is one (the inspector picks from its mesh). */
  agentLayer(i: number): AgentLayer | null {
    const l = this.layers[i]
    return l instanceof AgentLayer ? l : null
  }

  /** The entity under a ray, if any: which set (scene order) and which row. */
  pick(ray: THREE.Raycaster): { set: number; row: number } | null {
    const found: { set: number; row: number; distance: number }[] = []
    this.layers.forEach((l, set) => { const hit = l?.pick(ray); if (hit) found.push({ set, ...hit }) })
    if (this.isBodies) { const hit = this.rigid.pick(ray); if (hit) found.push({ set: 0, ...hit }) }
    found.sort((a, b) => a.distance - b.distance)
    return found[0] ? { set: found[0].set, row: found[0].row } : null
  }

  /** Mark the agent being inspected (or none). */
  select(sel: { set: number; row: number } | null): void {
    this.layers.forEach((l, i) => { if (l instanceof AgentLayer || l instanceof GraphLayer) l.selected = sel && sel.set === i ? sel.row : -1 })
  }

  update(frames: WorldFrame[]): void {
    // physics scenes draw their own ground: hide the bounds box and floor grid the other kinds use
    const rigidFrame = frames.find((f) => f.kind === 'bodies')
    const bodies = !!rigidFrame
    this.isBodies = bodies
    this.applyShadows()
    this.rigid.setVisible(bodies)
    if (this.box) this.box.visible = !bodies
    if (this.grid) this.grid.visible = !bodies
    if (rigidFrame) {
      for (const l of this.layers) l?.setVisible(false)
      if (rigidFrame.rigid) this.rigid.update(rigidFrame.rigid, rigidFrame.size)
      this.fitShadow(rigidFrame.size)
      return
    }
    this.setBounds(Math.max(...frames.map((f) => f.size)))
    frames.forEach((f, i) => {
      const want = f.kind === 'lattice' ? CellLayer : f.kind === 'graph' ? GraphLayer : AgentLayer
      let layer = this.layers[i]
      if (!layer || !(layer instanceof want)) {
        layer?.dispose()
        layer = this.layers[i] = new want(this.scene)
      }
      if (layer instanceof CellLayer) layer.set(f, this.fixedColor)
      else layer.update(f, this.fixedColor)
    })
    for (let i = frames.length; i < this.layers.length; i++) { this.layers[i]?.dispose(); this.layers[i] = null }
  }
}
