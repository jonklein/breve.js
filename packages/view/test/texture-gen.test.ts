import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KIND_DEFAULTS, generateTexture, normalMapFrom, normalizeTexture, type TextureKind } from '../src/texture-gen'

const kinds = Object.keys(KIND_DEFAULTS) as Exclude<TextureKind, 'url'>[]

test('every kind makes a varied, deterministic picture, and a new seed changes it', () => {
  for (const kind of kinds) {
    const a = generateTexture({ kind, seed: 3 }, 64)
    const b = generateTexture({ kind, seed: 3 }, 64)
    assert.deepEqual(a.rgba, b.rgba, `${kind} is the same every time`)
    assert.equal(a.rgba.length, 64 * 64 * 4)
    const distinct = new Set(Array.from({ length: 64 * 64 }, (_, i) => a.rgba[i * 4] * 65536 + a.rgba[i * 4 + 1] * 256 + a.rgba[i * 4 + 2]))
    assert.ok(distinct.size > 8, `${kind} is not a flat color (${distinct.size} colors)`)
    if (!['checker', 'stripes', 'grid', 'dots', 'bricks'].includes(kind)) {
      const c = generateTexture({ kind, seed: 4 }, 64)
      assert.notDeepEqual(a.rgba, c.rgba, `${kind} changes with the seed`)
    }
  }
})

test('textures tile: the step across the wrap is no bigger than a step inside', () => {
  for (const kind of ['noise', 'fbm', 'marble', 'grass', 'sand', 'water'] as const) {
    const t = generateTexture({ kind }, 128)
    const lum = (x: number, y: number) => t.height[y * 128 + x]
    let inside = 0, across = 0
    for (let y = 0; y < 128; y++) {
      inside += Math.abs(lum(64, y) - lum(65, y))
      across += Math.abs(lum(127, y) - lum(0, y))
    }
    assert.ok(across < inside * 3 + 3, `${kind}: wrap ${across.toFixed(2)} vs inside ${inside.toFixed(2)}`)
  }
})

test('colors, contrast and scale are honored', () => {
  const t = generateTexture({ kind: 'checker', colors: ['#ff0000', '#0000ff'], scale: 2 }, 32)
  const px = (x: number, y: number) => [...t.rgba.slice((y * 32 + x) * 4, (y * 32 + x) * 4 + 3)].map((v) => Math.round(v / 10))
  assert.deepEqual(px(2, 2).map((v) => v > 20 ? 'hi' : 'lo'), ['hi', 'lo', 'lo'], 'the first cell takes the first color')
  assert.deepEqual(px(20, 2).map((v) => v > 20 ? 'hi' : 'lo'), ['lo', 'lo', 'hi'], 'the next cell the second')
  const flat = generateTexture({ kind: 'fbm', contrast: 0 }, 32)
  const spread = (g: typeof flat) => { const v = Array.from({ length: 32 * 32 }, (_, i) => g.rgba[i * 4]); return Math.max(...v) - Math.min(...v) }
  assert.ok(spread(flat) < spread(generateTexture({ kind: 'fbm', contrast: 1.5 }, 32)))
})

test('normal maps point up where the surface is flat and lean with the slope', () => {
  const size = 16
  const flat = normalMapFrom(new Float32Array(size * size), size, 1)
  assert.deepEqual([...flat.slice(0, 4)].map((v) => Math.round(v)), [128, 128, 255, 255])
  const ramp = new Float32Array(size * size).map((_, i) => (i % size) / size)
  const lean = normalMapFrom(ramp, size, 1)
  assert.ok(lean[(8 * size + 8) * 4] < 120, 'a slope rising to the right leans the normal left')
})

test('normalizeTexture fills in every field, from a name or an object', () => {
  const g = normalizeTexture('grass')!
  assert.equal(g.kind, 'grass')
  assert.deepEqual(g.colors, KIND_DEFAULTS.grass.colors)
  assert.equal(g.tile, 10)
  const u = normalizeTexture({ url: 'x.png' })!
  assert.equal(u.kind, 'url')
  assert.equal(normalizeTexture({ kind: 'bricks', bump: 0, tile: 4 })!.bump, 0)
  assert.equal(normalizeTexture('nonsense')!.kind, 'noise')
})
