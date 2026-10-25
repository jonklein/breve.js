import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Terrain, Perlin2 } from '../src/index'

const bytes = (t: Terrain) => Buffer.from(t.heights.buffer).toString('hex')

test('the same seed gives byte-identical terrain, a different seed gives different terrain', () => {
  const def = { size: 40, resolution: 32, amplitude: 1.5 }
  assert.equal(bytes(new Terrain(def, 5)), bytes(new Terrain(def, 5)))
  assert.notEqual(bytes(new Terrain(def, 5)), bytes(new Terrain(def, 6)))
})

test('noise is smooth, zero at lattice points and stays inside [-1, 1]', () => {
  const n = new Perlin2(1)
  assert.equal(n.noise(3, 4), 0)
  let lo = Infinity, hi = -Infinity, jump = 0
  for (let i = 0; i < 4000; i++) {
    const x = i * 0.037, y = i * 0.021
    const v = n.fbm(x, y, 3)
    lo = Math.min(lo, v); hi = Math.max(hi, v)
    jump = Math.max(jump, Math.abs(v - n.fbm(x + 0.001, y, 3)))
  }
  assert.ok(lo >= -1 && hi <= 1, `range ${lo} .. ${hi}`)
  assert.ok(hi - lo > 0.5, 'noise should actually vary')
  assert.ok(jump < 0.02, `a step of 0.001 changed the value by ${jump}`)
})

test('the default terrain is gently bumpy: modest height range and shallow slopes', () => {
  const t = new Terrain({ amplitude: 0.6 }, 11)
  let lo = Infinity, hi = -Infinity, slope = 0
  const m = t.n + 1, step = t.size / t.n
  for (let ix = 0; ix < m; ix++)
    for (let iz = 0; iz < m; iz++) {
      const h = t.heights[ix * m + iz]
      lo = Math.min(lo, h); hi = Math.max(hi, h)
      if (ix > 0) slope = Math.max(slope, Math.abs(h - t.heights[(ix - 1) * m + iz]) / step)
      if (iz > 0) slope = Math.max(slope, Math.abs(h - t.heights[ix * m + iz - 1]) / step)
    }
  assert.ok(hi <= 0.6 && lo >= -0.6, `heights ${lo}..${hi}`)
  assert.ok(hi - lo > 0.3, 'there should be real hills')
  assert.ok(slope < 0.4, `steepest step is ${slope} (a 0.4 slope is about 22 degrees)`)
})

test('heightAt returns grid heights at the samples, blends between them, and clamps outside', () => {
  const t = new Terrain({ size: 10, resolution: 5, amplitude: 1 }, 2)
  const m = t.n + 1
  assert.ok(Math.abs(t.heightAt(-5 + 2 * 2, -5 + 3 * 2) - t.heights[2 * m + 3]) < 1e-6)
  const mid = t.heightAt(-5 + 1, -5) // halfway between samples (0,0) and (1,0)
  assert.ok(Math.abs(mid - (t.heights[0] + t.heights[m]) / 2) < 1e-6)
  assert.ok(Math.abs(t.heightAt(100, 100) - t.heights[m * m - 1]) < 1e-6)
})
