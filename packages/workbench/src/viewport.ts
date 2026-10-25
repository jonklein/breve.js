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

  constructor(private container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000)
    this.controls = new OrbitControls(camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.view = new WorldView(this.renderer, camera, this.controls)
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
