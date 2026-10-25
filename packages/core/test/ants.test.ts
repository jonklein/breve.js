import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Sim, parseScene, type ScriptModule } from '../src/index'

const dir = new URL('../../../examples/ants/', import.meta.url)
const load = async () => {
  const p = parseScene(readFileSync(new URL('scene.json', dir), 'utf8'))
  assert.ok(p.ok, p.ok ? '' : p.errors.join('\n'))
  const script = (await import(pathToFileURL(new URL('ants.js', dir).pathname).href)) as ScriptModule
  return { scene: p.ok ? p.scene : (null as never), script }
}

test('ants find food and bring it home, and the run is repeatable', async () => {
  const { scene, script } = await load()
  const a = new Sim(scene, script)
  const b = new Sim(scene, script)
  for (let i = 0; i < 1500; i++) { a.step(); b.step() }
  assert.equal(a.takeErrors().length, 0, a.takeErrors().join('\n'))
  assert.equal(a.hash(), b.hash())
  assert.ok(a.metrics().delivered > 0, `delivered ${a.metrics().delivered}`)
})

test('a trail forms: scent builds up on the ground', async () => {
  const { scene, script } = await load()
  const s = new Sim(scene, script)
  for (let i = 0; i < 1200; i++) s.step()
  const scent = s.tableOf('ground').cols.scent as Float32Array
  assert.ok(Math.max(...scent) > 1, 'some cell has a strong trail')
})

test('a fork of a two-set sim carries both sets and pending deposits', async () => {
  const { scene, script } = await load()
  const a = new Sim(scene, script)
  for (let i = 0; i < 301; i++) a.step() // odd tick: the ground has deposits waiting
  const b = a.fork()
  assert.equal(a.hash(), b.hash())
  for (let i = 0; i < 100; i++) { a.step(); b.step() }
  assert.equal(a.hash(), b.hash())
})

test('every: n runs a set on every n-th tick only', async () => {
  const { scene, script } = await load()
  const s = new Sim(scene, script)
  const scent = s.tableOf('ground').cols.scent as Float32Array
  scent[500] = 8
  s.step() // tick 0: the ground runs, so the scent shrinks
  const afterFirst = scent[500]
  assert.ok(afterFirst < 8)
  s.step() // tick 1: the ground sits out
  assert.equal(scent[500], afterFirst)
})

test('scenes reject a duplicate set name and an unknown type at run time', async () => {
  const { scene, script } = await load()
  const dup = structuredClone(scene)
  dup.entities[1].name = 'ants'
  const r = parseScene(JSON.stringify(dup))
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.errors.join('\n'), /another set is already called "ants"/)

  const wrong = structuredClone(scene)
  wrong.entities[0].type = 'Spider'
  const s = new Sim(wrong, script)
  s.step()
  assert.match(s.takeErrors().join('\n'), /no export named "Spider"/)
})

test('agent groups answer questions about declared state, like cells do', async () => {
  const { scene, script } = await load()
  const s = new Sim(scene, script)
  for (let i = 0; i < 600; i++) s.step()
  const m = s.metrics()
  assert.ok(Number.isFinite(m.carrying), 'carrying is a number')
  assert.ok(m.carrying > 0 && m.carrying <= 70)
})
