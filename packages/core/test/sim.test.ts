import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Sim, Table, parseScene, type ScriptModule } from '../src/index'

const dir = new URL('../../../examples/boids/', import.meta.url)

async function load() {
  const parsed = parseScene(readFileSync(new URL('scene.json', dir), 'utf8'))
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join('\n'))
  const script = (await import(pathToFileURL(new URL('flock.js', dir).pathname).href)) as ScriptModule
  return { scene: parsed.ok ? parsed.scene : (null as never), script }
}

test('same scene and seed give identical state after N ticks', async () => {
  const { scene, script } = await load()
  const a = new Sim(scene, script)
  const b = new Sim(scene, script)
  for (let i = 0; i < 200; i++) { a.step(); b.step() }
  assert.equal(a.hash(), b.hash())
  assert.equal(a.takeErrors().length, 0)
})

test('a different seed gives different state', async () => {
  const { scene, script } = await load()
  const a = new Sim(scene, script)
  const b = new Sim({ ...scene, seed: scene.seed + 1 }, script)
  for (let i = 0; i < 20; i++) { a.step(); b.step() }
  assert.notEqual(a.hash(), b.hash())
})

test('boids flock: polarization rises from the random start', async () => {
  const { scene, script } = await load()
  const s = new Sim(scene, script)
  const start = s.metrics().polarization
  for (let i = 0; i < 600; i++) s.step()
  // flocks flicker between tighter and looser, so look at the average over the next stretch rather than one instant
  const later: number[] = []
  for (let i = 0; i < 600; i++) { s.step(); if (i % 50 === 0) later.push(s.metrics().polarization) }
  const mean = later.reduce((a, b) => a + b, 0) / later.length
  assert.ok(mean > start + 0.1, `${start} -> ${mean}`)
})

test('live edits: count changes spawn and despawn without a reset', async () => {
  const { scene, script } = await load()
  const s = new Sim(scene, script)
  for (let i = 0; i < 10; i++) s.step()
  const edited = structuredClone(scene)
  edited.params.count = { value: 50 }
  s.setScene(edited)
  assert.equal(s.table.size, 50)
  s.step()
  assert.equal(s.tick, 11)
})

test('a throwing script is reported and the sim keeps running', async () => {
  const { scene } = await load()
  const bad: ScriptModule = { default: { act() { throw new Error('boom') } } }
  const s = new Sim(scene, bad)
  s.step(); s.step()
  assert.equal(s.tick, 2)
  assert.match(s.takeErrors()[0], /boom/)
})

test('stale entity ids never address a recycled row', () => {
  const t = new Table({ x: 'f32' })
  const a = t.spawn()
  t.despawn(a)
  const b = t.spawn()
  assert.equal(t.has(a), false)
  assert.equal(t.has(b), true)
  assert.notEqual(a, b)
})

test('invalid scenes produce readable errors', () => {
  const r = parseScene('{"seed": 1, "bounds": {"size": 5}, "params": {}, "entities": [{"name":"a","count":"$nope","controller":"x.js"}]}')
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.errors.join('\n'), /unknown param "\$nope"/)
  assert.equal(parseScene('{ nope').ok, false)
})

test('world settings validate, and bad colors get a readable error', async () => {
  const { scene } = await load()
  assert.ok(scene.world?.preset, 'example scene picks a look')
  const bad = JSON.stringify({ ...scene, world: { sky: { top: 'blue', horizon: '#123' } } })
  const r = parseScene(bad)
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.errors.join('\n'), /world\.sky/)
  assert.ok(parseScene(JSON.stringify({ ...scene, world: undefined })).ok, 'world is optional')
})

test('the look settings (preset, fog, light, shadows, reflections, terrain shading) validate with readable errors', async () => {
  const { scene } = await load()
  const world = { preset: 'dusk', fog: { near: 10, far: 90, color: '#334455' }, light: { sun: { azimuth: 200, elevation: 20, intensity: 2 }, hemisphere: { intensity: 0.5 }, exposure: 1.2, toneMapping: 'aces' }, shadows: { softness: 2, resolution: 1024 }, reflections: 0.8 }
  assert.ok(parseScene(JSON.stringify({ ...scene, world })).ok)
  const bad = (w: object) => { const r = parseScene(JSON.stringify({ ...scene, world: w })); return r.ok ? '' : r.errors.join('\n') }
  assert.match(bad({ preset: 'sunny' }), /world\.preset/)
  assert.match(bad({ light: { toneMapping: 'filmic' } }), /world\.light\.toneMapping/)
  assert.match(bad({ light: { sun: { elevation: 120 } } }), /world\.light\.sun\.elevation/)
  assert.match(bad({ fog: { colour: '#fff' } }), /world\.fog/)
  assert.match(bad({ shadows: { resolution: 999 } }), /world\.shadows/)
  assert.match(bad({ reflections: 5 }), /world\.reflections/)
  const withStyle = (style: object) => { const e = structuredClone(scene.entities); e[0].style = style as never; const r = parseScene(JSON.stringify({ ...scene, entities: e })); return r.ok ? '' : r.errors.join('\n') }
  assert.equal(withStyle({ shape: 'capsule', material: { roughness: 0.4, metalness: 0.1, glow: 1.5, opacity: 0.8 }, trail: { length: 30, strength: 0.5 } }), '')
  assert.match(withStyle({ shape: 'blob' }), /style\.shape/)
  assert.match(withStyle({ material: { roughness: 2 } }), /style\.material\.roughness/)
  assert.match(withStyle({ trail: 999 }), /style\.trail/)
  assert.equal(withStyle({ sprite: { image: 'ant.svg', turn: true } }), '')
  assert.equal(withStyle({ sprite: { image: 'ant.svg', facing: 'ground' } }), '')
  assert.match(withStyle({ sprite: { image: 'ant.svg', facing: 'wall' } }), /sprite/)
  assert.match(withStyle({ sprite: {} }), /sprite/)
  assert.match(withStyle({ sprite: { image: 'a.png', size: 3 } }), /sprite/)
  const withWorld = (w: object) => { const r = parseScene(JSON.stringify({ ...scene, world: w })); return r.ok ? '' : r.errors.join('\n') }
  assert.equal(withWorld({ preset: 'night', effects: { bloom: { strength: 0.6 }, ao: true, vignette: 0.3 }, floor: { texture: { kind: 'grass', tile: 6 }, y: -1 }, camera: { distance: 2, elevation: 20 }, frame: false, sky: { top: '#000000', horizon: '#223344', stars: 1, clouds: 0.2 } }), '')
  assert.match(withWorld({ floor: { texture: 'lava' } }), /world\.floor/)
  assert.match(withWorld({ effects: { vignette: 5 } }), /world\.effects/)
  assert.match(withWorld({ camera: { fov: 5 } }), /world\.camera\.fov/)
  assert.ok(parseScene(JSON.stringify({ ...scene, terrain: { shading: 'flat' } })).ok)
  assert.match(String((parseScene(JSON.stringify({ ...scene, terrain: { shading: 'lumpy' } })) as { errors?: string[] }).errors), /terrain\.shading/)
})

test('world markers and follow validate', async () => {
  const { scene } = await load()
  assert.ok(parseScene(JSON.stringify({ ...scene, world: { markers: [{ at: [0, 0], height: 2, color: '#ff8a3d' }], follow: true } })).ok)
  for (const markers of [[{ at: [0] }], [{ at: [0, 0], height: -1 }], [{ height: 2 }]]) {
    const r = parseScene(JSON.stringify({ ...scene, world: { markers } }))
    assert.equal(r.ok, false)
    assert.match(r.ok ? '' : r.errors.join('\n'), /world\.markers/)
  }
})
