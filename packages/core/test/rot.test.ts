import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromEuler, toEuler, fromRpy, apply, mul, transpose, quatFromEuler } from '../src/rot'
import { buildBody } from '../src/body'

const near = (a: readonly number[], b: readonly number[], eps = 1e-9) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, `${a} != ${b}`))

test('euler angles round-trip through a matrix, and a quarter turn does what it says', () => {
  for (const e of [[0.3, -0.7, 1.1], [1.5, 0.2, -2.4], [0, 0, 0], [-0.4, 1.2, 0.9]] as [number, number, number][]) near(toEuler(fromEuler(e)), e, 1e-9)
  near(apply(fromEuler([0, Math.PI / 2, 0]), [1, 0, 0]), [0, 0, -1]) // x toward -z as yaw grows, like the physics engine
  near(apply(fromRpy([0, 0, Math.PI / 2]), [1, 0, 0]), [0, 1, 0])
  near(apply(mul(fromEuler([0.4, 0.5, 0.6]), transpose(fromEuler([0.4, 0.5, 0.6]))), [1, 2, 3]), [1, 2, 3])
  const [x, y, z, w] = quatFromEuler([0.3, 0.2, 0.1])
  assert.ok(Math.abs(x * x + y * y + z * z + w * w - 1) < 1e-12)
})

test('a part may be rotated, and an attach with a yaw turns it too', () => {
  const body = {
    templates: { leg: { parts: [{ name: 'foot', shape: 'box', size: [0.2, 0.1, 0.4], mass: 1, position: [0, 0, 0.5], rotation: [0, 0.5, 0] }], joints: [{ name: 'hip', type: 'fixed', parent: '^', child: 'foot', anchor: [0, 0, 0] }] } },
    parts: [{ name: 'torso', shape: 'box', size: [1, 0.3, 0.6], mass: 4, position: [0, 1, 0], rotation: ['$tilt', 0, 0] }],
    attach: [{ name: 'L', template: 'leg', yaw: 0.25 }],
  }
  const r = buildBody(body as never, { tilt: 0.1 }, 'body', new Set(['tilt']))
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.body.parts[0].rotation, [0.1, 0, 0])
  near(r.body.parts[1].rotation!, [0, 0.75, 0], 1e-4) // yaw 0.25 on top of 0.5 about the same axis
})

test('physics: a long box turned a quarter turn rests on its short side', async () => {
  const { Sim, parseScene } = await import('../src/index')
  const r = parseScene(JSON.stringify({
    seed: 1, params: {}, bounds: { size: 20 }, terrain: { size: 20, amplitude: 0 },
    entities: [{ name: 'c', count: 1, body: { parts: [{ name: 'log', shape: 'box', size: [1, 0.2, 0.2], mass: 1, position: [0, 0.6, 0], rotation: [0, 0, Math.PI / 2] }] } }], metrics: [],
  }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  const sim = await Sim.create(r.scene, { default: { act: () => ({}) } })
  for (let i = 0; i < 120; i++) sim.step()
  assert.equal(sim.takeErrors().length, 0)
  const py = (sim.table.cols as unknown as Record<string, Float64Array>).py[0]
  assert.ok(Math.abs(py - 0.5) < 0.05, `standing on end: center at ${py.toFixed(3)}, not 0.1`)
  sim.dispose()
})

test('a part may name a glTF model to draw (the physics still uses its primitive shape), and the frame carries it to the view', async () => {
  const { validateBody, Sim, parseScene } = await import('../src/index')
  const part = { name: 'torso', shape: 'box', size: [1, 0.3, 0.6], mass: 4, position: [0, 1, 0] }
  const ok = validateBody({ parts: [{ ...part, visual: { gltf: 'beetle.glb', scale: 1.2, rotation: [0, 1, 0], offset: [0, 0.05, 0] } }] })
  assert.ok(ok.ok, ok.ok ? '' : ok.errors.join('\n'))
  for (const bad of [{ gltf: '' }, { scale: 2 }, { gltf: 'a.glb', scale: [1, 2] }, { gltf: 'a.glb', extra: 1 }, { gltf: 'a.glb', scale: 0 }])
    assert.ok(!validateBody({ parts: [{ ...part, visual: bad }] }).ok, JSON.stringify(bad))
  const r = parseScene(JSON.stringify({ seed: 1, params: {}, bounds: { size: 20 }, terrain: { size: 20, amplitude: 0 }, entities: [{ name: 'c', count: 1, body: { parts: [{ ...part, visual: { gltf: 'beetle.glb' } }] } }], metrics: [] }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  const sim = await Sim.create(r.scene, { default: { act: () => ({}) } })
  sim.step()
  const rigid = sim.frames()[0].rigid
  assert.deepEqual(rigid?.model?.parts[0].visual, { gltf: 'beetle.glb' })
  sim.dispose()
})
