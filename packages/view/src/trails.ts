import * as THREE from 'three'

/**
 * Fading trails behind a set of moving things: the last `length` positions of each, drawn as lines that fade to
 * nothing at the tail (additive, so they glow on dark backgrounds and fade out cleanly). History is kept per row, so a
 * thing that is removed and replaced by another leaves a short stray line, which fades quickly.
 */
export class Trails {
  private lines: THREE.LineSegments | null = null
  private hist = new Float32Array(0)
  private count = 0
  private len = 0
  private filled = 0
  private head = 0

  constructor(private scene: THREE.Scene) {}

  /** Add the current positions (xyz per thing) and redraw. `rgb` is the color of each thing (0..1); `strength` scales brightness. */
  push(n: number, pos: ArrayLike<number>, rgb: ArrayLike<number>, length: number, strength: number): void {
    const len = Math.max(2, Math.min(240, Math.round(length)))
    // keep to a budget of segments so a big flock does not drown the frame
    const used = Math.max(2, Math.min(len, Math.floor(60000 / Math.max(1, n))))
    if (n !== this.count || used !== this.len) this.reset(n, used)
    const o = this.head * n * 3
    for (let i = 0; i < n * 3; i++) this.hist[o + i] = pos[i]
    this.head = (this.head + 1) % this.len
    this.filled = Math.min(this.len, this.filled + 1)
    this.draw(n, rgb, strength)
  }

  private reset(n: number, len: number): void {
    this.dispose()
    this.count = n
    this.len = len
    this.filled = 0
    this.head = 0
    this.hist = new Float32Array(n * len * 3)
  }

  private draw(n: number, rgb: ArrayLike<number>, strength: number): void {
    const segs = Math.max(0, this.filled - 1) * n
    if (!this.lines) {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * (this.len - 1) * 6), 3).setUsage(THREE.DynamicDrawUsage))
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * (this.len - 1) * 6), 3).setUsage(THREE.DynamicDrawUsage))
      this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
      this.lines.frustumCulled = false
      this.scene.add(this.lines)
    }
    const pos = this.lines.geometry.attributes.position as THREE.BufferAttribute
    const col = this.lines.geometry.attributes.color as THREE.BufferAttribute
    let s = 0
    for (let i = 0; i < n; i++) {
      // walk from the newest point back to the oldest
      for (let k = 0; k < this.filled - 1; k++) {
        const a = ((this.head - 1 - k) % this.len + this.len) % this.len
        const b = ((this.head - 2 - k) % this.len + this.len) % this.len
        const fa = (1 - k / (this.filled - 1)) * strength
        const fb = (1 - (k + 1) / (this.filled - 1)) * strength
        const ia = (a * n + i) * 3, ib = (b * n + i) * 3
        const j = s * 6
        pos.array[j] = this.hist[ia]; pos.array[j + 1] = this.hist[ia + 1]; pos.array[j + 2] = this.hist[ia + 2]
        pos.array[j + 3] = this.hist[ib]; pos.array[j + 4] = this.hist[ib + 1]; pos.array[j + 5] = this.hist[ib + 2]
        col.array[j] = rgb[i * 3] * fa; col.array[j + 1] = rgb[i * 3 + 1] * fa; col.array[j + 2] = rgb[i * 3 + 2] * fa
        col.array[j + 3] = rgb[i * 3] * fb; col.array[j + 4] = rgb[i * 3 + 1] * fb; col.array[j + 5] = rgb[i * 3 + 2] * fb
        s++
      }
    }
    pos.needsUpdate = true
    col.needsUpdate = true
    this.lines.geometry.setDrawRange(0, segs * 2)
  }

  setVisible(on: boolean): void {
    if (this.lines) this.lines.visible = on
  }

  /** Forget the history (the set was rebuilt) and release the lines. */
  dispose(): void {
    if (this.lines) {
      this.scene.remove(this.lines)
      this.lines.geometry.dispose()
      ;(this.lines.material as THREE.Material).dispose()
      this.lines = null
    }
  }
}
