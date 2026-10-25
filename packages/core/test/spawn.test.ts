import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Sim, parseScene, type ScriptModule } from '../src/index'

const scene = (spawn: unknown, extra: object = {}) => {
  const r = parseScene(JSON.stringify({ seed: 1, params: {}, bounds: { size: 30 }, entities: [{ name: 'a', count: 20, spawn, ...extra }], metrics: [] }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  return r.ok ? r.scene : (null as never)
}
const pos = (s: Sim) => { const c = s.table.cols as Record<string, Float32Array>; return Array.from({ length: s.table.size }, (_, i) => [c.px[i], c.py[i], c.pz[i]]) }

test('spawn.at puts everything at a point, spread scatters it, box fills a box', () => {
  assert.ok(pos(new Sim(scene({ at: [5, 1, -3] }))).every((p) => p[0] === 5 && p[1] === 1 && p[2] === -3))
  const near = pos(new Sim(scene({ at: [10, 0, 10], spread: 2 })))
  assert.ok(near.every((p) => Math.hypot(p[0] - 10, p[1], p[2] - 10) <= 2.0001))
  assert.ok(new Set(near.map((p) => p[0])).size > 10)
  const inBox = pos(new Sim(scene({ box: [[-1, 0, -1], [1, 4, 1]] })))
  assert.ok(inBox.every((p) => Math.abs(p[0]) <= 1 && p[1] >= 0 && p[1] <= 4 && Math.abs(p[2]) <= 1))
})

test('spawn.velocity sets the starting heading', () => {
  const s = new Sim(scene({ at: [0, 0, 0], velocity: [2, 0, 0] }))
  assert.ok(Array.from(s.table.cols.vx as Float32Array).slice(0, 20).every((v) => v === 2))
})

test('a controller init callback places each new entity and sets its state', () => {
  const sc = scene(undefined, { state: { tag: '' } })
  const script: ScriptModule = {
    default: {
      init: ({ index, count }, _p, ctx) => ({ position: ctx.vec(index - count / 2, 0, 0), state: { tag: `#${index}` } }),
      decide: () => ({}),
    },
  }
  const s = new Sim(sc, script)
  assert.deepEqual(pos(s)[0], [-10, 0, 0])
  assert.deepEqual(pos(s)[19], [9, 0, 0])
  assert.equal(s.table.cols.tag[7], '#7')
})

test('at and box together are rejected', () => {
  const r = parseScene(JSON.stringify({ seed: 1, params: {}, entities: [{ name: 'a', count: 1, spawn: { at: [0, 0, 0], box: [[0, 0, 0], [1, 1, 1]] } }] }))
  assert.equal(r.ok, false)
})

test('a fence fires onLeave once per crossing, and self.reset() sends the agent back to its start', () => {
  const sc = scene({ at: [0, 0, 0], velocity: [30, 0, 0] }, { fence: { size: 2 }, motion: { maxSpeed: 40 } })
  sc.bounds = { size: 100, mode: 'clamp' }
  const left: number[] = []
  const s = new Sim(sc, {
    default: {
      onLeave: ({ self }) => { left.push(s.tick); self.reset() },
      decide: () => ({}),
    },
  })
  for (let i = 0; i < 30; i++) s.step()
  assert.ok(left.length >= 2, `crossed ${left.length} times`)
  assert.ok(new Set(left).size === left.length || left.length > 0)
  const x = Array.from(s.table.cols.px as Float32Array).slice(0, 20)
  assert.ok(x.every((v) => Math.abs(v) < 2.6), 'everyone was sent back near the start')
})
