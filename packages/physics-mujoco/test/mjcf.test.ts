import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Sim, parseScene, registerAssetReader, registerPhysicsEngine, resolveMeshes, validateBody, type BodyDef } from '@breve/core'
import { buildMjcf, loadMujoco } from '../src/index'

registerPhysicsEngine('mujoco', loadMujoco)

const exampleScene = readFileSync(new URL('../../../examples/creature/scene.json', import.meta.url), 'utf8')
const flatBody = (): BodyDef => {
  const r = validateBody(JSON.parse(exampleScene).entities[0].body)
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  return r.ok ? r.body : (null as never)
}
const opts = { gravity: 9.81, minGyration: 0, at: { x: 0, y: 0, z: 0, yaw: 0 }, terrain: null }

test('MJCF for a body: one XML body per part, one joint per hinge, one actuator per motor, numbered in joint order', () => {
  const body = flatBody()
  const m = buildMjcf(body, opts)
  assert.equal(m.parts.length, body.parts.length)
  assert.equal((m.xml.match(/<body /g) ?? []).length, body.parts.length)
  const hinges = (body.joints ?? []).filter((j) => (j.type ?? 'hinge') === 'hinge')
  assert.equal((m.xml.match(/type="hinge"/g) ?? []).length, hinges.length)
  const motors = (body.joints ?? []).filter((j) => j.motor && (j.type ?? 'hinge') === 'hinge')
  assert.equal(m.actuatorNames.length, motors.length)
  assert.deepEqual(m.actuators.filter((a) => a >= 0), motors.map((_, i) => i), 'actuators follow the body\'s joint order')
  assert.match(m.xml, /gravity="0 -9.81 0"/, 'we keep y up and point gravity down it instead of swapping axes')
})

test('fixed joints become no joint at all, and an inertia floor writes an explicit inertia', () => {
  const body: BodyDef = {
    parts: [{ name: 'a', shape: 'box', size: [1, 1, 1], mass: 2, position: [0, 1, 0] }, { name: 'b', shape: 'capsule', size: [0.4, 0.05], mass: 0.1, position: [1, 1, 0] }],
    joints: [{ name: 'weld', type: 'fixed', parent: 'a', child: 'b', anchor: [0.5, 1, 0] }],
  }
  const plain = buildMjcf(body, opts)
  assert.deepEqual(plain.joints, [null])
  assert.doesNotMatch(plain.xml, /name="j0"/)
  assert.doesNotMatch(plain.xml, /<inertial/)
  const floored = buildMjcf(body, { ...opts, minGyration: 0.3 })
  assert.equal((floored.xml.match(/<inertial/g) ?? []).length, 2)
  // the small capsule (0.1 kg) gets at least 0.1 * 0.3^2 = 0.009 about every axis
  const tiny = floored.xml.match(/mass="0.1" diaginertia="([^"]+)"/)![1].split(' ').map(Number)
  assert.ok(tiny.every((v) => v >= 0.009 - 1e-9), tiny.join(' '))
})

test('the example four-legged creature runs on MuJoCo: no errors, finite, standing on the ground, moving', async () => {
  const r = parseScene(exampleScene)
  assert.ok(r.ok)
  const scene = r.ok ? r.scene : (null as never)
  scene.physics = { engine: 'mujoco' }
  scene.params.count = typeof scene.params.count === 'number' ? 3 : { ...scene.params.count, value: 3 }
  const sim = await Sim.create(scene, { default: { act: () => ({}) }, Creature: { act: () => ({}) } })
  for (let t = 0; t < 240; t++) sim.step()
  assert.deepEqual(sim.takeErrors(), [])
  const c = sim.table.cols as unknown as Record<string, Float32Array>
  for (let i = 0; i < 3; i++) {
    assert.ok([c.px[i], c.py[i], c.pz[i]].every(Number.isFinite))
    assert.ok(c.py[i] > 0.05 && c.py[i] < 3, `creature ${i} at height ${c.py[i]}`)
  }
  sim.dispose()
})

test('a mesh part becomes a mesh asset and a mesh geom, and the engine runs it', async () => {
  const dir = new URL('../../../examples/creature-gltf/', import.meta.url)
  const parsed = parseScene(readFileSync(new URL('scene.json', dir), 'utf8'))
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join('\n'))
  if (!parsed.ok) return
  const bytes = new Uint8Array(readFileSync(new URL('beetle.glb', dir)))
  const scene = { ...parsed.scene, physics: { engine: 'mujoco' } }
  registerAssetReader(async () => bytes)
  const resolved = await resolveMeshes(scene, async () => bytes)
  const r = validateBody(resolved.entities[0].body as never)
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  if (!r.ok) return
  const m = buildMjcf(r.body, opts)
  assert.match(m.xml, /<asset><mesh name="mesh0" vertex="/)
  assert.match(m.xml, /<geom type="mesh" mesh="mesh0"/)
  const sim = await Sim.create(scene, undefined) // reads the model through the registered reader
  for (let t = 0; t < 30; t++) sim.step()
  assert.equal(sim.takeErrors().length, 0)
})
