import { Rng } from './rng'

/** Gradient (Perlin) noise in 2D. The permutation comes from the seed, so the same seed gives the same landscape. */
export class Perlin2 {
  private perm = new Uint8Array(512)

  constructor(seed: number) {
    const rng = new Rng(seed ^ 0x9e3779b9)
    const p = Array.from({ length: 256 }, (_, i) => i)
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1))
      ;[p[i], p[j]] = [p[j], p[i]]
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]
  }

  /** Smooth noise in roughly [-1, 1]; zero at every integer lattice point. */
  noise(x: number, y: number): number {
    const xi = Math.floor(x), yi = Math.floor(y)
    const xf = x - xi, yf = y - yi
    const X = xi & 255, Y = yi & 255
    const u = fade(xf), v = fade(yf)
    const a = this.perm[X] + Y, b = this.perm[X + 1] + Y
    const n00 = grad(this.perm[a], xf, yf)
    const n10 = grad(this.perm[b], xf - 1, yf)
    const n01 = grad(this.perm[a + 1], xf, yf - 1)
    const n11 = grad(this.perm[b + 1], xf - 1, yf - 1)
    // unit-length diagonal gradients peak at about 0.7, so scale to fill [-1, 1]
    return (lerp(lerp(n00, n10, u), lerp(n01, n11, u), v)) * 1.4142
  }

  /** Several layers of noise, each twice as fine and half as strong. Still roughly in [-1, 1]. */
  fbm(x: number, y: number, octaves: number): number {
    let sum = 0, amp = 1, freq = 1, norm = 0
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * freq + o * 17.3, y * freq - o * 9.1)
      norm += amp
      amp *= 0.5
      freq *= 2
    }
    return sum / norm
  }
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
// eight gradient directions are enough for 2D and keep the table-free code short
function grad(h: number, x: number, y: number): number {
  const k = h & 7
  const s = Math.SQRT1_2
  switch (k) {
    case 0: return x
    case 1: return -x
    case 2: return y
    case 3: return -y
    case 4: return (x + y) * s
    case 5: return (x - y) * s
    case 6: return (-x + y) * s
    default: return (-x - y) * s
  }
}
