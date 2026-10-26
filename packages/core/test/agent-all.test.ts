import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Sim, parseScene, type ScriptModule } from '../src/index'

const scene = (count = 60) => {
  const r = parseScene(JSON.stringify({
    seed: 9, params: {}, bounds: { size: 20, mode: 'clamp' },
    entities: [{ name: 'a', count, motion: { maxSpeed: 4, plane: 'xz' }, sensors: [{ type: 'neighbors', radius: 8 }] }], metrics: [],
  }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  return r.ok ? r.scene : (null as never)
}

// cohesion: steer toward the middle of the neighbors you can see
const each: ScriptModule = {
  default: {
    init: () => ({ seen: 0 }),
    act: ({ self, neighbors }) => {
      if (!neighbors.length) return { state: { seen: 0 } }
      const k = 1 / neighbors.length
      let x = 0, z = 0
      for (const n of neighbors) { x += n.x; z += n.z }
      return { steer: [(x * k - self.x) * 0.5, 0, (z * k - self.z) * 0.5], state: { seen: neighbors.length } }
    },
  },
}
const all: ScriptModule = {
  default: {
    init: () => ({ seen: 0 }),
    actAll: ({ px, pz }) => {
      const count = px.neighborCount()
      const ax = px.neighborAverage().sub(px).mul(0.5), az = pz.neighborAverage().sub(pz).mul(0.5)
      return { steer: { x: count.gt(0).mul(ax), y: ax.mul(0), z: count.gt(0).mul(az) }, seen: count }
    },
  },
}

test('actAll sees neighbors within the sensor radius and steers like the per-agent rule', () => {
  const a = new Sim(scene(), each)
  const b = new Sim(scene(), all)
  for (let t = 0; t < 40; t++) {
    a.step(); b.step()
    assert.equal(b.takeErrors().join('\n'), '')
  }
  const ca = a.table.cols as Record<string, Float32Array>, cb = b.table.cols as Record<string, Float32Array>
  for (let i = 0; i < 60; i++) assert.ok(Math.abs(ca.px[i] - cb.px[i]) < 1e-2 && Math.abs(ca.pz[i] - cb.pz[i]) < 1e-2, `agent ${i} differs`)
})

test('initAll and displayAll work for free agents; the look reaches the frame', () => {
  const sim = new Sim(scene(5), {
    default: {
      initAll: ({ count }) => ({ hot: Float32Array.from({ length: count }, (_, i) => i % 2), position: { x: Float32Array.from({ length: count }, (_, i) => i), y: new Float32Array(count), z: new Float32Array(count) } }),
      displayAll: ({ hot }, _p, ctx) => ({ visible: hot.add(0), color: ctx.colors.rampField(['#000000', '#ff0000'], hot), opacity: hot.mul(0.5).add(0.25), scale: hot.add(1) }),
    },
  })
  const c = sim.table.cols as Record<string, Float32Array>
  assert.deepEqual(Array.from(c.px.slice(0, 5)), [0, 1, 2, 3, 4])
  const look = sim.frames()[0].look!
  assert.deepEqual(Array.from(look.visible!), [0, 1, 0, 1, 0])
  assert.deepEqual(Array.from(look.alpha!), [64, 191, 64, 191, 64])
  assert.deepEqual(Array.from(look.scale!), [1, 2, 1, 2, 1])
  assert.deepEqual(Array.from(look.rgb!.slice(3, 6)), [255, 0, 0])
  assert.equal(sim.takeErrors().length, 0, sim.takeErrors().join('\n'))
})
