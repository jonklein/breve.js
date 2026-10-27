import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { WorldView, type WorldLook, type WorldFrame } from '@breve/view'

export type { WorldLook }

/** One big view of one world, with an orbit camera. */
export class Viewport {
  private renderer = new THREE.WebGLRenderer({ antialias: true })
  readonly view: WorldView
  private controls: OrbitControls
  private lastTime = performance.now()

  /** Called with the entity under a click, or null for a click on nothing. */
  onPick: (sel: { set: number; row: number } | null) => void = () => {}

  /** Called when the person zooms or pans a lattice that is drawn as a picture: which part of the grid to draw, and in how many pixels. */
  onFieldView: (set: number, window: [number, number, number, number], width: number, height: number) => void = () => {}
  /** The picture lattice on show (set number, grid size, cell width) and the part of it in view. */
  private field: { set: number; dims: [number, number]; spacing: number; window: [number, number, number, number] } | null = null

  constructor(private container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)
    container.tabIndex = 0 // click the view to give it the keyboard
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000)
    this.controls = new OrbitControls(camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.view = new WorldView(this.renderer, camera, this.controls)
    // screen effects (ambient occlusion, bloom, grading); `?quality=low|medium|high` picks the starting level, and it steps down if frames run long
    const asked = new URLSearchParams(location.search).get('quality')
    this.view.quality = asked === 'low' || asked === 'medium' || asked === 'high' ? asked : 'high'
    // a click (press and release without dragging) picks the entity under the pointer
    const canvas = this.renderer.domElement
    let down: { x: number; y: number } | null = null
    canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY } })
    canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return
      const r = canvas.getBoundingClientRect()
      const ray = new THREE.Raycaster()
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)), this.view.camera)
      this.onPick(this.view.pick(ray))
    })
    this.listenForFieldView(canvas)
    new ResizeObserver(() => this.resize()).observe(container)
    this.resize()
    const loop = () => {
      const now = performance.now()
      this.view.tick(Math.min(0.1, (now - this.lastTime) / 1000))
      this.lastTime = now
      this.controls.update()
      if (this.container.clientWidth) this.view.render()
      requestAnimationFrame(loop)
    }
    loop()
  }

  /** Show or hide the whole view (the sweep tiles take its place). */
  setVisible(on: boolean): void {
    this.container.classList.toggle('hidden', !on)
  }

  private resize(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.view.setAspect(w / h)
  }

  /** The point of the grid, in cells, under a screen position (the picture lies flat in front of the camera). */
  private cellAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const f = this.field
    if (!f) return null
    const r = this.renderer.domElement.getBoundingClientRect()
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1)), this.view.camera)
    const at = new THREE.Vector3()
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), at)) return null
    // the picture is the whole grid, so a point on it is a fraction of the window
    const [x0, y0, x1, y1] = f.window
    return { x: x0 + (at.x / (f.dims[0] * f.spacing) + 0.5) * (x1 - x0), y: y0 + (at.y / (f.dims[1] * f.spacing) + 0.5) * (y1 - y0) }
  }

  /** Ask for a different window, kept inside the grid and no smaller than a few cells. */
  private moveWindow(x0: number, y0: number, w: number, h: number): void {
    const f = this.field!
    const [nx, ny] = f.dims
    w = Math.min(nx, Math.max(8, w))
    h = Math.min(ny, Math.max(8 * (ny / nx), h))
    x0 = Math.min(nx - w, Math.max(0, x0))
    y0 = Math.min(ny - h, Math.max(0, y0))
    f.window = [x0, y0, x0 + w, y0 + h]
    const px = Math.max(256, Math.min(2048, Math.round(Math.min(this.container.clientWidth, this.container.clientHeight) * Math.min(window.devicePixelRatio, 2))))
    this.onFieldView(f.set, f.window, px, Math.max(1, Math.round((px * ny) / nx)))
  }

  /** Wheel zooms toward the pointer; dragging pans. A picture lattice is flat, so the orbit controls give way to these. */
  private listenForFieldView(canvas: HTMLElement): void {
    let drag: { x: number; y: number; cell: { x: number; y: number } } | null = null
    canvas.addEventListener('wheel', (e) => {
      const f = this.field, c = this.cellAt(e.clientX, e.clientY)
      if (!f || !c) return
      e.preventDefault()
      const k = Math.exp(e.deltaY * 0.0015) // scrolling up zooms in
      const [x0, y0, x1, y1] = f.window
      const w = (x1 - x0) * k, h = (y1 - y0) * k
      // keep the cell under the pointer where it is
      this.moveWindow(c.x - ((c.x - x0) / (x1 - x0)) * w, c.y - ((c.y - y0) / (y1 - y0)) * h, w, h)
    }, { passive: false })
    canvas.addEventListener('pointerdown', (e) => { const c = this.cellAt(e.clientX, e.clientY); if (this.field && c) drag = { x: e.clientX, y: e.clientY, cell: c } })
    canvas.addEventListener('pointermove', (e) => {
      if (!drag || !this.field || !(e.buttons & 1)) return
      const c = this.cellAt(e.clientX, e.clientY)
      if (!c) return
      const [x0, y0, x1, y1] = this.field.window
      // move the window so the cell that was grabbed is under the pointer again
      this.moveWindow(x0 + (drag.cell.x - c.x), y0 + (drag.cell.y - c.y), x1 - x0, y1 - y0)
    })
    canvas.addEventListener('pointerup', () => { drag = null })
  }

  setWorld(w: WorldLook | undefined): void { this.view.setWorld(w) }
  update(frames: WorldFrame[]): void {
    this.view.update(frames) // (this frames the camera for ordinary worlds)
    const i = frames.findIndex((f) => f.kind === 'field' && f.field)
    const f = i >= 0 ? frames[i].field! : null
    if (f && (!this.field || this.field.set !== i || this.field.dims[0] !== f.dims[0] || this.field.dims[1] !== f.dims[1])) {
      // a picture lattice has just appeared: face it from straight ahead, whole grid in view, and let these controls zoom and pan it
      this.field = { set: i, dims: f.dims, spacing: f.spacing, window: [0, 0, f.dims[0], f.dims[1]] }
      const cam = this.view.camera, fov = (cam.fov * Math.PI) / 360
      const dist = Math.max((f.dims[1] * f.spacing) / 2 / Math.tan(fov), (f.dims[0] * f.spacing) / 2 / (Math.tan(fov) * cam.aspect)) * 1.06
      cam.position.set(0, 0, dist)
      cam.far = Math.max(cam.far, dist * 3) // a big grid is far away: do not clip it
      cam.updateProjectionMatrix()
      this.controls.target.set(0, 0, 0)
      this.controls.enableRotate = this.controls.enablePan = this.controls.enableZoom = false
    } else if (!f && this.field) {
      this.field = null
      this.controls.enableRotate = this.controls.enablePan = this.controls.enableZoom = true
    }
  }
}
