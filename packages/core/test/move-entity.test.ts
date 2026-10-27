import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Sim, parseScene, type ScriptModule } from '../src/index'

const quiet: ScriptModule = { default: { act: () => ({}) } }
const make = async (entities: object[], terrain?: object) => {
  const r = parseScene(JSON.stringify({ seed: 1, params: {}, entities, metrics: [], ...(terrain ? { terrain } : {}) }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  return Sim.create(r.ok ? r.scene : (null as never), quiet)
}

test('moveEntity puts a free agent where it is dragged and it stays there', async () => {
  const sim = await make([{ name: 'a', count: 3 }])
  sim.moveEntity(0, 1, 4.5, -2.5)
  const c = sim.table.cols as unknown as Record<string, Float32Array>
  assert.deepEqual([c.px[1], c.pz[1]], [4.5, -2.5])
  sim.step()
  assert.ok(Math.abs(c.px[1] - 4.5) < 1, 'it carries on from there')
})

test('moveEntity stands a creature at the spot facing the way it faced, and refuses what cannot be moved', async () => {
  const body = { parts: [{ name: 'box', shape: 'box', size: [1, 0.4, 0.5], mass: 2, position: [0, 0.5, 0] }], sensors: [{ type: 'pose' }] }
  const sim = await make([{ name: 'c', count: 2, body }], { size: 40, resolution: 16, amplitude: 0 })
  for (let t = 0; t < 30; t++) sim.step()
  const handles = (sim.worlds[0] as unknown as { handles: { x: number; z: number; yaw: number }[] }).handles
  const yaw = handles[1].yaw
  sim.moveEntity(0, 1, 6, 3)
  assert.ok(Math.abs(handles[1].x - 6) < 0.01 && Math.abs(handles[1].z - 3) < 0.01, `now at ${handles[1].x}, ${handles[1].z}`)
  for (let t = 0; t < 30; t++) sim.step()
  assert.ok(Math.abs(handles[1].x - 6) < 1 && Math.abs(handles[1].yaw - yaw) < 0.2, `still near the spot, facing ${handles[1].yaw} (was ${yaw})`)
  assert.throws(() => sim.moveEntity(0, 9, 0, 0), /cannot be moved/)
  assert.deepEqual(sim.takeErrors(), [])
  sim.dispose()
})

test('a lattice has nothing to move', async () => {
  const sim = await make([{ name: 'g', lattice: { size: [4, 4, 1] } }])
  assert.throws(() => sim.moveEntity(0, 0, 1, 1), /cannot be moved/)
})
