import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { WorldView, type WorldLook, type WorldFrame } from './world-view'

export type { WorldLook }

/** One big view of one world, with an orbit camera. */
export class Viewport {
  private renderer = new THREE.WebGLRenderer({ antialias: true })
  readonly view: WorldView
  private controls: OrbitControls
  private lastTime = performance.now()

  /** Called with the entity under a click, or null for a click on nothing. */
  onPick: (sel: { set: number; row: number } | null) => void = () => {}

  constructor(private container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)
    container.tabIndex = 0 // click the view to give it the keyboard
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000)
    this.controls = new OrbitControls(camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.view = new WorldView(this.renderer, camera, this.controls)
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
    new ResizeObserver(() => this.resize()).observe(container)
    this.resize()
    const loop = () => {
      const now = performance.now()
      this.view.tick(Math.min(0.1, (now - this.lastTime) / 1000))
      this.lastTime = now
      this.controls.update()
      if (this.container.clientWidth) this.renderer.render(this.view.scene, this.view.camera)
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

  setWorld(w: WorldLook | undefined): void { this.view.setWorld(w) }
  update(frames: WorldFrame[]): void { this.view.update(frames) }
}
