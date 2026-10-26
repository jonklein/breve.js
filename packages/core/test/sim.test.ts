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
  assert.ok(s.metrics().polarization > start + 0.2, `${start} -> ${s.metrics().polarization}`)
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
  assert.ok(scene.world?.sky, 'example scene declares a sky')
  const bad = JSON.stringify({ ...scene, world: { sky: { top: 'blue', horizon: '#123' } } })
  const r = parseScene(bad)
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.errors.join('\n'), /world\.sky/)
  assert.ok(parseScene(JSON.stringify({ ...scene, world: undefined })).ok, 'world is optional')
})
