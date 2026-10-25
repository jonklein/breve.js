import * as THREE from 'three'
import { WorldView, type WorldFrame, type WorldLook } from './world-view'

export interface Tile extends WorldFrame {
  name: string
  value: number
  metrics: Record<string, number> | null
}

interface Slot {
  view: WorldView
  el: HTMLElement
  title: HTMLElement
  reading: HTMLElement
  spark: HTMLCanvasElement
  history: number[]
  base: THREE.Vector3 | null
  placed: THREE.Vector3
  rect: { x: number; y: number; w: number; h: number }
  camera: () => THREE.PerspectiveCamera
}

const HISTORY = 160

/**
 * Many worlds in one canvas: a shared renderer draws each world into its own rectangle, and a thin layer of
 * DOM on top labels each tile with its param value and a live line for one metric. Click a tile to pick it.
 */
export class TileGrid {
  private renderer = new THREE.WebGLRenderer({ antialias: true })
  private slots = new Map<string, Slot>()
  private metric = ''
  private look: WorldLook | undefined
  private visible = false
  private param = ''

  constructor(private container: HTMLElement, private onPick: (name: string) => void) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.setScissorTest(true)
    container.appendChild(this.renderer.domElement)
    new ResizeObserver(() => this.layout()).observe(container)
    const loop = (now: number) => {
      if (this.visible) this.render(now / 1000)
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  setVisible(on: boolean): void {
    this.visible = on
    this.container.classList.toggle('hidden', !on)
    if (on) this.layout()
  }

  /** Which metric the tiles chart. */
  setMetric(name: string): void {
    this.metric = name
  }

  setWorld(look: WorldLook | undefined): void {
    this.look = look
    for (const s of this.slots.values()) s.view.setWorld(look)
  }

  clear(): void {
    for (const s of this.slots.values()) s.el.remove()
    this.slots.clear()
    this.param = ''
  }

  /** Forget metric history (after a reset) but keep the tiles. */
  resetHistory(): void {
    for (const s of this.slots.values()) s.history = []
  }

  update(tiles: Tile[], param: string): void {
    this.param = param
    const live = new Set(tiles.map((t) => t.name))
    for (const [name, s] of this.slots) if (!live.has(name)) { s.el.remove(); this.slots.delete(name) }
    let added = false
    for (const t of tiles) {
      let s = this.slots.get(t.name)
      if (!s) { s = this.makeSlot(t); this.slots.set(t.name, s); added = true }
      s.view.update(t)
      if (!s.base || !s.camera().position.equals(s.placed)) s.base = s.camera().position.clone() // the world moved the camera (new size): re-aim
      const v = this.metric ? t.metrics?.[this.metric] : undefined
      if (v !== undefined) {
        s.history.push(v)
        if (s.history.length > HISTORY) s.history.shift()
        s.reading.textContent = `${this.metric} ${Number.isInteger(v) ? v : v.toFixed(2)}`
      }
    }
    if (added) this.layout()
    this.drawSparks()
  }

  private makeSlot(t: Tile): Slot {
    const el = document.createElement('button')
    el.className = 'tile'
    el.title = 'Click to continue from here as a single run'
    const title = document.createElement('span')
    title.className = 'tile-title mono'
    const reading = document.createElement('span')
    reading.className = 'tile-reading mono muted'
    const spark = document.createElement('canvas')
    spark.className = 'tile-spark'
    el.append(title, reading, spark)
    el.addEventListener('click', () => this.onPick(t.name))
    this.container.appendChild(el)
    const view = new WorldView(this.renderer)
    view.setWorld(this.look)
    return { view, el, title, reading, spark, history: [], base: null, placed: new THREE.Vector3(NaN), rect: { x: 0, y: 0, w: 0, h: 0 }, camera: () => view.camera }
  }

  /** Divide the container into a grid that suits the number of tiles and its shape. */
  private layout(): void {
    const W = this.container.clientWidth, H = this.container.clientHeight
    const n = this.slots.size
    if (!W || !H || !n) return
    this.renderer.setSize(W, H, false)
    let cols = 1, best = Infinity
    for (let c = 1; c <= n; c++) {
      const rows = Math.ceil(n / c)
      const cell = Math.abs(Math.log((W / c) / (H / rows) / 1.3)) + (c * rows - n) * 0.15 // roughly 4:3 tiles, few empty cells
      if (cell < best) { best = cell; cols = c }
    }
    const rows = Math.ceil(n / cols)
    const gap = 4
    const w = (W - gap * (cols + 1)) / cols, h = (H - gap * (rows + 1)) / rows
    let i = 0
    for (const s of this.slots.values()) {
      const col = i % cols, row = Math.floor(i / cols)
      s.rect = { x: gap + col * (w + gap), y: gap + row * (h + gap), w, h }
      Object.assign(s.el.style, { left: `${s.rect.x}px`, top: `${s.rect.y}px`, width: `${w}px`, height: `${h}px` })
      s.spark.width = Math.max(10, Math.floor(w - 16))
      s.spark.height = 28
      s.view.setAspect(w / h)
      i++
    }
    this.drawSparks()
  }

  private drawSparks(): void {
    let lo = Infinity, hi = -Infinity
    for (const s of this.slots.values()) for (const v of s.history) { lo = Math.min(lo, v); hi = Math.max(hi, v) }
    if (!(hi > lo)) { hi = lo + 1 }
    for (const s of this.slots.values()) {
      s.title.textContent = ''
      const [name] = [...this.slots].find(([, v]) => v === s)!
      s.title.textContent = name.replace('=', ' = ')
      const g = s.spark.getContext('2d')!
      g.clearRect(0, 0, s.spark.width, s.spark.height)
      if (s.history.length < 2) continue
      g.strokeStyle = '#7fb8ff'
      g.lineWidth = 1.5
      g.beginPath()
      s.history.forEach((v, k) => {
        const x = (k / (HISTORY - 1)) * s.spark.width
        const y = s.spark.height - 2 - ((v - lo) / (hi - lo)) * (s.spark.height - 4)
        if (k === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      })
      g.stroke()
    }
  }

  private render(t: number): void {
    const H = this.container.clientHeight
    if (!H) return
    this.renderer.setScissorTest(false)
    this.renderer.setClearColor(0x0b0e14, 1)
    this.renderer.clear()
    this.renderer.setScissorTest(true)
    for (const s of this.slots.values()) {
      const { x, y, w, h } = s.rect
      if (w <= 0) continue
      // drift slowly around the world so each tile shows more than one side
      if (s.base) {
        const a = t * 0.12
        const c = Math.cos(a), sn = Math.sin(a)
        s.placed.set(s.base.x * c + s.base.z * sn, s.base.y, -s.base.x * sn + s.base.z * c)
        s.view.camera.position.copy(s.placed)
        s.view.camera.lookAt(s.view.controls.target)
      }
      s.view.tick(1 / 60)
      this.renderer.setViewport(x, H - y - h, w, h)
      this.renderer.setScissor(x, H - y - h, w, h)
      this.renderer.render(s.view.scene, s.view.camera)
    }
  }
}
