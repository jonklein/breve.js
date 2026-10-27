import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PRESETS, resolveLook, sunDirection } from '../src/look'

test('no world block gives the default look; a world block without a preset keeps the plain look', () => {
  assert.equal(resolveLook(undefined).preset, 'dusk')
  const plain = resolveLook({ sky: { top: '#112233', horizon: '#445566' } })
  assert.equal(plain.preset, 'plain')
  assert.equal(plain.sky.top, '#112233')
  assert.equal(plain.sky.horizon, '#445566')
  assert.match(plain.sky.ground, /^#[0-9a-f]{6}$/, 'a ground is made up when the scene gives none')
  assert.equal(plain.fog.kind, 'none')
  assert.equal(plain.toneMapping, 'none')
})

test('a preset alone gives a complete look, and fields override it', () => {
  for (const name of Object.keys(PRESETS)) {
    const l = resolveLook({ preset: name }, 30)
    assert.equal(l.preset, name)
    assert.ok(l.sun.intensity >= 0 && l.exposure > 0 && l.reflections >= 0)
  }
  const day = resolveLook({ preset: 'day' }, 30)
  assert.equal(day.fog.kind, 'linear')
  assert.equal(day.fog.near, PRESETS.day.fog && 1.6 * 30)
  const custom = resolveLook({ preset: 'day', light: { sun: { intensity: 5, elevation: 10 }, toneMapping: 'none' }, reflections: 0 })
  assert.equal(custom.sun.intensity, 5)
  assert.equal(custom.sun.elevation, 10)
  assert.equal(custom.toneMapping, 'none')
  assert.equal(custom.reflections, 0)
  assert.equal(custom.sun.color, PRESETS.day.sun.color, 'fields left out keep the preset')
})

test('fog: off, the preset, explicit distances, or density; colors default to the horizon', () => {
  assert.equal(resolveLook({ preset: 'day', fog: false }).fog.kind, 'none')
  const on = resolveLook({ preset: 'studio', fog: true }, 10)
  assert.equal(on.fog.kind, 'linear')
  assert.match(on.fog.color, /^#[0-9a-f]{6}$/)
  assert.notEqual(on.fog.color, PRESETS.studio.sky.horizon, 'the haze sits between horizon and ground')
  assert.equal(on.fog.far, 70)
  const lin = resolveLook({ preset: 'plain', fog: { near: 5, far: 50, color: '#ffffff' } })
  assert.deepEqual([lin.fog.kind, lin.fog.near, lin.fog.far, lin.fog.color], ['linear', 5, 50, '#ffffff'])
  const exp = resolveLook({ preset: 'plain', fog: { density: 0.02 } })
  assert.deepEqual([exp.fog.kind, exp.fog.density], ['exp', 0.02])
  assert.ok(resolveLook({ fog: { near: 20, far: 5 } }).fog.far > 20, 'far is kept beyond near')
})

test('bad values fall back instead of breaking the view', () => {
  const l = resolveLook({ preset: 'nope', sky: 'not a color', light: { sun: { intensity: -3, elevation: 400 }, exposure: 'x' }, shadows: { resolution: 999, softness: 99 } })
  assert.equal(l.preset, 'plain')
  assert.equal(l.sun.intensity, 0)
  assert.equal(l.sun.elevation, 90)
  assert.equal(l.exposure, 1)
  assert.equal(l.shadows.resolution, 2048)
  assert.equal(l.shadows.softness, 4)
})

test('shadows: unset leaves it to the scene kind; true, false and settings turn it on or off', () => {
  assert.equal(resolveLook({}).shadows.enabled, undefined)
  assert.equal(resolveLook({ shadows: false }).shadows.enabled, false)
  assert.equal(resolveLook({ shadows: true }).shadows.enabled, true)
  const s = resolveLook({ shadows: { softness: 3, resolution: 4096, bias: -0.001 } }).shadows
  assert.deepEqual([s.enabled, s.softness, s.resolution, s.bias], [true, 3, 4096, -0.001])
})

test('sunDirection is a unit vector; azimuth 0 points along +x and elevation 90 straight up', () => {
  const d = sunDirection(0, 0)
  assert.deepEqual(d.map((v) => Math.round(v * 1e6) / 1e6), [1, 0, 0])
  const up = sunDirection(123, 90)
  assert.ok(Math.abs(up[1] - 1) < 1e-9)
  const any = sunDirection(200, 33)
  assert.ok(Math.abs(Math.hypot(...any) - 1) < 1e-9)
})

test('floor: none unless asked, with the texture normalized and size and height following the world by default', () => {
  assert.equal(resolveLook({}).floor, null)
  assert.equal(resolveLook({ floor: false }).floor, null)
  const f = resolveLook({ floor: { texture: 'grass', y: -1, roughness: 0.5 } }).floor!
  assert.equal(f.texture!.kind, 'grass')
  assert.deepEqual([f.y, f.size, f.roughness, f.metalness], [-1, null, 0.5, 0])
  const plain = resolveLook({ floor: {} }).floor!
  assert.deepEqual([plain.texture, plain.y, plain.color], [null, null, '#ffffff'])
})
