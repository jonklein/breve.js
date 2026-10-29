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

  /** Which entity sets can be dragged (free agents and creatures; a lattice or a network cannot). */
  movable: (set: number) => boolean = () => false
  /** Called as the person drags an entity across the ground: where to put it. */
  onMoveEntity: (set: number, row: number, x: number, z: number) => void = () => {}
  /** Called as the person drags a marker (a pole) across the ground, and once more with `done` when they let go. */
  onMoveMarker: (index: number, x: number, z: number, done: boolean) => void = () => {}

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
      // a lattice drawn as a picture has no cubes to hit: the cell under the pointer is worked out from the window being shown
      const f = this.field, cell = f ? this.cellAt(e.clientX, e.clientY) : null
      if (f && cell) {
        const x = Math.floor(cell.x), y = Math.floor(cell.y)
        this.onPick(x >= 0 && y >= 0 && x < f.dims[0] && y < f.dims[1] ? { set: f.set, row: y * f.dims[0] + x } : null)
        return
      }
      this.onPick(this.view.pick(ray))
    })
    this.listenForFieldView(canvas)
    this.listenForDrag(canvas)
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

  /**
   * Grab a marker or an entity and drag it over the ground. The press is noticed before the orbit controls see it (so they stand down
   * for that drag); a press on nothing, or a click without moving, behaves as before.
   */
  private listenForDrag(canvas: HTMLCanvasElement): void {
    type Target = { marker: number } | { set: number; row: number }
    let drag: { target: Target; plane: THREE.Plane; from: { x: number; y: number }; moved: boolean } | null = null
    let want: { x: number; z: number } | null = null
    let scheduled = false
    const rayAt = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      const ray = new THREE.Raycaster()
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)), this.view.camera)
      return ray
    }
    const emit = (done: boolean) => {
      scheduled = false
      if (!drag || !want) return
      const { x, z } = want
      if ('marker' in drag.target) this.onMoveMarker(drag.target.marker, x, z, done)
      else this.onMoveEntity(drag.target.set, drag.target.row, x, z)
    }
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.field) return
      const ray = rayAt(e)
      const marker = this.view.markerAt(ray)
      const hit = this.view.pickHit(ray)
      const entity = hit && this.movable(hit.set) ? hit : null
      const near = marker && (!entity || marker.distance <= entity.distance) ? marker : entity
      if (!near) return
      const point = ray.ray.at(near.distance, new THREE.Vector3())
      drag = { target: near === marker ? { marker: marker!.index } : { set: entity!.set, row: entity!.row }, plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -point.y), from: { x: e.clientX, y: e.clientY }, moved: false }
      this.controls.enabled = false // the orbit controls look at this when they get the same press
      canvas.setPointerCapture(e.pointerId)
    }, true)
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return
      if (!drag.moved && Math.hypot(e.clientX - drag.from.x, e.clientY - drag.from.y) < 4) return
      drag.moved = true
      canvas.style.cursor = 'grabbing'
      const at = rayAt(e).ray.intersectPlane(drag.plane, new THREE.Vector3())
      if (!at) return
      want = { x: at.x, z: at.z }
      if (!scheduled) { scheduled = true; requestAnimationFrame(() => emit(false)) } // at most once a frame, however fast the pointer moves
    })
    const end = (e: PointerEvent) => {
      if (!drag) return
      if (drag.moved) emit(true)
      drag = null
      want = null
      this.controls.enabled = true
      canvas.style.cursor = ''
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    }
    canvas.addEventListener('pointerup', end)
    canvas.addEventListener('pointercancel', end)
  }

  /** Where on the page (client pixels) the top of marker `index` is drawn; for automated checks. */
  markerScreen(index: number): { x: number; y: number } | null {
    const p = this.view.markerPosition(index)
    if (!p) return null
    const r = this.renderer.domElement.getBoundingClientRect()
    p.project(this.view.camera)
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height }
  }

  setWorld(w: WorldLook | undefined): void { this.view.setWorld(w) }
  update(frames: WorldFrame[]): void {
    if (frames.length) this.container.classList.add('drawn')
    this.view.update(frames) // (this frames the camera for ordinary worlds)
    // `camera.mode: "plane"` in the scene: face a flat grid straight on, no rotation, wheel zooms, drag pans. Nothing here depends on how the grid is computed.
    const plane = this.view.cameraMode === 'plane'
    const i = frames.findIndex((f) => f.kind === 'field' && f.field)
    const f = plane && i >= 0 ? frames[i].field! : null
    const flat = plane && frames.length > 0
    if (f && (!this.field || this.field.set !== i || this.field.dims[0] !== f.dims[0] || this.field.dims[1] !== f.dims[1])) {
      // a picture lattice has just appeared: whole grid in view, and our own controls zoom and pan the part drawn
      this.field = { set: i, dims: f.dims, spacing: f.spacing, window: [0, 0, f.dims[0], f.dims[1]] }
      this.faceFlat((f.dims[0] * f.spacing) / 2, (f.dims[1] * f.spacing) / 2)
      this.controls.enableRotate = this.controls.enablePan = this.controls.enableZoom = false
      this.facing = true
    } else if (!f && this.field) {
      this.field = null
      this.facing = false
      this.controls.enableRotate = this.controls.enablePan = this.controls.enableZoom = true
    }
    if (!this.field && flat && !this.facing) {
      // any other flat world in plane mode: face it, and let the ordinary controls zoom and pan
      const half = Math.max(...frames.map((fr) => fr.size))
      this.faceFlat(half, half)
      this.controls.enableRotate = false
      this.facing = true
    } else if (!this.field && !flat && this.facing) {
      this.facing = false
      this.controls.enableRotate = true
    }
  }

  private facing = false

  /** Put the camera straight in front of a flat grid, `halfW` and `halfH` being half its width and height, so all of it is in view. */
  private faceFlat(halfW: number, halfH: number): void {
    const cam = this.view.camera, fov = (cam.fov * Math.PI) / 360
    const dist = Math.max(halfH / Math.tan(fov), halfW / (Math.tan(fov) * cam.aspect)) * 1.06
    cam.position.set(0, 0, dist)
    cam.far = Math.max(cam.far, dist * 3) // a big grid is far away: do not clip it
    cam.updateProjectionMatrix()
    this.controls.target.set(0, 0, 0)
  }
}
