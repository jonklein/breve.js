import * as THREE from 'three'
import type { RigidFrame } from '@breve/core'
import { RigidView } from './rigid-view'
import { AgentLayer, CellLayer, GraphLayer } from './layers'
import { resolveLook, sunDirection, type LookInput, type ResolvedLook } from './look'
import { buildTexture } from './textures'

/** What the view needs from a simulation frame. */
export interface WorldFrame {
  rigid?: RigidFrame
  kind: 'agents' | 'lattice' | 'bodies' | 'graph'
  count: number
  size: number
  unit: number
  pos: Float32Array
  vel: Float32Array | null
  /** What the script's `display` said per agent or node: red, green, blue (0 to 255), 1 to draw, opacity (0 to 255), size multiplier. */
  look?: { rgb: Uint8Array | null; visible: Uint8Array | null; alpha: Uint8Array | null; scale: Float32Array | null }
  lattice?: { dims: [number, number, number]; spacing: number; show: Uint8Array; fade: number; thickness?: number; rgb?: Uint8Array; alpha?: Uint8Array; sizes?: Float32Array }
  graph?: { edges: Uint32Array; version: number; nodeSize: number }
  /** Per-set color for free agents. */
  color?: string
  scale?: number
  style?: { shape?: string; material?: { roughness?: number; metalness?: number; glow?: number; opacity?: number } }
  rate?: number
}

/** The scene's `world` block, as the view receives it (see WorldDef in the core; checked there). */
export type WorldLook = LookInput

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
  private skyUniforms = { top: { value: new THREE.Color('#0b1226') }, horizon: { value: new THREE.Color('#2a4a7a') }, ground: { value: new THREE.Color('#122034') } }
  private grid: THREE.GridHelper | null = null
  private boundsColor = new THREE.Color('#3a4658')
  private fixedColor: THREE.Color | null = null
  private sun = new THREE.DirectionalLight(0xffffff, 1.6)
  private ambient = new THREE.AmbientLight(0xffffff, 0.9)
  private hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0)
  /** Catches shadows on scenes that have no ground of their own. */
  private catcher: THREE.Mesh
  private floor: THREE.Mesh | null = null
  private floorKey = ''
  private assetBase = ''
  private shadowsOn = false
  private shadowSize = 0
  private isBodies = false
  private world: LookInput | undefined
  private look: ResolvedLook = resolveLook(undefined)
  private envKey = ''
  private envTarget: THREE.WebGLRenderTarget | null = null

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
        fragmentShader: 'uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vDir; void main() { float t = vDir.y; vec3 c = t >= 0.0 ? mix(horizon, top, pow(t, 0.6)) : mix(horizon, ground, smoothstep(0.0, 0.45, -t)); gl_FragColor = vec4(c, 1.0);\n#include <colorspace_fragment>\n}',
      }),
    )
    this.sky.renderOrder = -1
    this.sky.frustumCulled = false
    this.scene.add(this.sky)
    this.camera.position.set(55, 35, 55)

    this.sun.shadow.normalBias = 0.06
    this.scene.add(this.ambient, this.hemi, this.sun, this.sun.target)
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.catcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.4 }))
    this.catcher.rotation.x = -Math.PI / 2
    this.catcher.receiveShadow = true
    this.catcher.visible = false
    this.scene.add(this.catcher)
    this.rigid = new RigidView(this.scene, this.camera, this.controls)
    this.applyLook()

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
    this.placeCamera(size)
    if (this.box) { this.scene.remove(this.box); this.box.geometry.dispose() }
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(size * 2, size * 2, size * 2))
    this.box = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: this.boundsColor }))
    this.scene.add(this.box)
    this.rebuildGrid()
    this.applyLook() // fog distances scale with the size of the world
    this.fitShadow(size)
  }

  /** Put the camera where the scene's `camera` setting says (or the default three-quarter view) for a world of this size. */
  private placeCamera(size: number): void {
    const c = this.look.camera
    const el = (c.elevation * Math.PI) / 180, az = (c.azimuth * Math.PI) / 180
    const d = size * c.distance
    this.camera.position.set(Math.cos(el) * Math.cos(az) * d, Math.sin(el) * d, Math.cos(el) * Math.sin(az) * d)
    if (this.camera.fov !== c.fov) { this.camera.fov = c.fov; this.camera.updateProjectionMatrix() }
  }

  private rebuildGrid(): void {
    if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose() }
    this.grid = null
    if (!this.look.grid || !this.boxSize) return
    this.grid = new THREE.GridHelper(this.boxSize * 2, 12, this.boundsColor, this.boundsColor)
    this.grid.position.y = -this.boxSize
    ;(this.grid.material as THREE.Material).opacity = 0.5
    ;(this.grid.material as THREE.Material).transparent = true
    this.scene.add(this.grid)
  }

  /** Apply the scene's `world` block. Anything missing or invalid falls back to the default. */
  setWorld(w: WorldLook | undefined): void {
    this.world = w
    this.applyLook()
  }

  /** Work out the look from the world block and the size of the world, and set up sky, fog, lights, shadows and reflections. */
  private applyLook(): void {
    const l = (this.look = resolveLook(this.world, this.boxSize || 30))
    this.skyUniforms.top.value = new THREE.Color(l.sky.top)
    this.skyUniforms.horizon.value = new THREE.Color(l.sky.horizon)
    this.skyUniforms.ground.value = new THREE.Color(l.sky.ground)
    this.boundsColor = new THREE.Color(l.boundsColor)
    if (this.box) (this.box.material as THREE.LineBasicMaterial).color.copy(this.boundsColor)
    this.rebuildGrid()
    this.fixedColor = l.agentColor ? new THREE.Color(l.agentColor) : null

    this.scene.fog = l.fog.kind === 'linear' ? new THREE.Fog(l.fog.color, l.fog.near, l.fog.far)
      : l.fog.kind === 'exp' ? new THREE.FogExp2(l.fog.color, l.fog.density) : null
    // the sky takes the fog's color at the horizon, so distant things melt into it
    this.sun.color.set(l.sun.color)
    this.sun.intensity = l.sun.intensity
    this.ambient.color.set(l.ambient.color)
    this.ambient.intensity = l.ambient.intensity
    this.hemi.color.set(l.hemisphere.sky)
    this.hemi.groundColor.set(l.hemisphere.ground)
    this.hemi.intensity = l.hemisphere.intensity
    this.aimSun()

    this.sun.shadow.bias = l.shadows.bias
    this.sun.shadow.radius = l.shadows.softness
    if (this.sun.shadow.mapSize.x !== l.shadows.resolution) {
      this.sun.shadow.mapSize.set(l.shadows.resolution, l.shadows.resolution)
      this.sun.shadow.map?.dispose()
      this.sun.shadow.map = null
    }
    this.applyFloor()
    this.applyShadows()
    this.applyEnvironment()
  }

  /** The ground plane, when the scene asks for one (and there is no terrain). It sits at the bottom of the world box unless `y` says otherwise. */
  private applyFloor(): void {
    const f = this.look.floor
    const half = this.boxSize || 30
    const want = f && !this.isBodies ? f : null
    const key = JSON.stringify([want, half, this.assetBase])
    if (key === this.floorKey) return
    this.floorKey = key
    if (this.floor) {
      this.scene.remove(this.floor)
      this.floor.geometry.dispose()
      ;(this.floor.material as THREE.Material).dispose()
      this.floor = null
    }
    if (!want) return
    const size = want.size ?? half * 12
    const mat = new THREE.MeshStandardMaterial({ color: want.color, roughness: want.roughness, metalness: want.metalness })
    if (want.texture) {
      const tex = buildTexture(want.texture, { assetBase: this.assetBase, changed: () => { this.floorKey = ''; this.applyFloor() } })
      const repeat = size / Math.max(0.1, want.texture.tile)
      for (const t of [tex.map, tex.normalMap]) if (t) t.repeat.set(repeat, repeat)
      mat.map = tex.map
      if (tex.normalMap) mat.normalMap = tex.normalMap
    }
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat)
    this.floor.rotation.x = -Math.PI / 2
    this.floor.position.y = want.y ?? -half
    this.floor.receiveShadow = true
    this.scene.add(this.floor)
  }

  /** Mirror the sky on shiny surfaces: the sky gradient and the sun, blurred into an environment map. */
  private applyEnvironment(): void {
    const l = this.look
    const key = `${l.reflections > 0}|${l.sky.top}|${l.sky.horizon}|${l.sun.color}|${l.sun.azimuth}|${l.sun.elevation}`
    if (key === this.envKey) { this.scene.environmentIntensity = l.reflections; return }
    this.envKey = key
    this.envTarget?.dispose()
    this.envTarget = null
    this.scene.environment = null
    this.scene.environmentIntensity = l.reflections
    if (l.reflections <= 0) return
    const env = new THREE.Scene()
    const skyMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color(l.sky.top) }, horizon: { value: new THREE.Color(l.sky.horizon) }, ground: { value: new THREE.Color(l.sky.ground) } },
      side: THREE.BackSide,
      vertexShader: (this.sky.material as THREE.ShaderMaterial).vertexShader,
      fragmentShader: (this.sky.material as THREE.ShaderMaterial).fragmentShader,
    })
    env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 24, 16), skyMat))
    const d = sunDirection(l.sun.azimuth, l.sun.elevation)
    const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(l.sun.color).multiplyScalar(6) }))
    sunDisc.position.set(d[0] * 45, d[1] * 45, d[2] * 45)
    env.add(sunDisc)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.envTarget = pmrem.fromScene(env, 0.04)
    pmrem.dispose()
    this.scene.environment = this.envTarget.texture
    env.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose() })
  }

  /** Shadows default on for physics scenes (there is a ground to catch them) and off elsewhere. */
  private applyShadows(): void {
    const on = this.look.shadows.enabled ?? this.isBodies
    this.catcher.visible = on && !this.isBodies && !this.floor // a floor catches shadows itself
    if (on === this.shadowsOn) return
    this.shadowsOn = on
    this.renderer.shadowMap.enabled = on
    this.sun.castShadow = on
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined
      if (m) m.needsUpdate = true
    })
    this.rigid.setShadows(on)
    for (const l of this.layers) l?.setShadows(on)
  }

  /** Where relative model paths (a part's `visual.gltf`) start: a URL ending in `/`. */
  setAssetBase(base: string): void {
    this.rigid.assetBase = base
    this.assetBase = base
    this.floorKey = '' // a floor texture may now resolve somewhere else
    this.applyFloor()
  }

  private aimSun(): void {
    const d = sunDirection(this.look.sun.azimuth, this.look.sun.elevation)
    const reach = Math.max(10, this.shadowSize || this.boxSize || 30) * 2.5
    this.sun.position.set(d[0] * reach, d[1] * reach, d[2] * reach)
    this.sun.target.position.set(0, 0, 0)
  }

  /** Aim the sun so its shadow map covers the whole arena. */
  private fitShadow(half: number): void {
    if (half === this.shadowSize) return
    this.shadowSize = half
    const cam = this.sun.shadow.camera
    const r = half * 1.5
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r
    cam.near = 1
    cam.far = half * 8
    cam.updateProjectionMatrix()
    this.aimSun()
    // the shadow-catching floor sits where the grid does, at the bottom of the box
    this.catcher.scale.set(half * 6, half * 6, 1)
    this.catcher.position.y = -half
  }

  /** Draw this world with its own tone mapping and exposure. Views sharing a renderer call this instead of `renderer.render`. */
  render(): void {
    const r = this.renderer
    r.toneMapping = this.look.toneMapping === 'aces' ? THREE.ACESFilmicToneMapping : this.look.toneMapping === 'neutral' ? THREE.NeutralToneMapping : THREE.NoToneMapping
    r.toneMappingExposure = this.look.exposure
    if (r.shadowMap.enabled !== this.shadowsOn) r.shadowMap.enabled = this.shadowsOn
    r.render(this.scene, this.camera)
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
    this.applyFloor()
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
        layer.setShadows(this.shadowsOn)
      }
      if (layer instanceof CellLayer) layer.set(f, this.fixedColor)
      else layer.update(f, this.fixedColor)
    })
    for (let i = frames.length; i < this.layers.length; i++) { this.layers[i]?.dispose(); this.layers[i] = null }
  }
}
