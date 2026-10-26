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
  const sc = scene(undefined)
  const script: ScriptModule = {
    default: {
      init: ({ index, count }, _p, ctx) => ({ position: ctx.vec(index - count / 2, 0, 0), tag: `#${index}` }),
      act: () => ({}),
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

test('self.place() moves an agent (and gives it a new velocity) at the end of the tick, and keeps its state', () => {
  const sc = scene({ at: [0, 0, 0], velocity: [30, 0, 0] }, { motion: { maxSpeed: 40 } })
  sc.bounds = { size: 100, mode: 'clamp' }
  const s = new Sim(sc, {
    default: {
      init: () => ({ sent: 0 }),
      // the script is the fence: past x = 2 it sends the agent back to the start, counting how often
      act: ({ self }) => (self.x > 2 ? (self.place({ position: [0, 0, 0], velocity: [30, 0, 0] }), { state: { sent: self.sent + 1 } }) : {}),
    },
  })
  for (let i = 0; i < 30; i++) s.step()
  const sent = Array.from(s.table.cols.sent as Float64Array).slice(0, 20)
  assert.ok(sent.every((n) => n >= 2), `each agent was sent back ${sent.join(',')} times`)
  const x = Array.from(s.table.cols.px as Float32Array).slice(0, 20)
  assert.ok(x.every((v) => Math.abs(v) < 2.6), 'everyone was sent back near the start')
})

test('ctx.blend adds steering and amounts, and merges state', () => {
  const sc = scene(undefined)
  let got: unknown
  const s = new Sim(sc, { default: { act: ({ self }, _p, ctx) => {
    if (self.row === 0) got = ctx.blend({ steer: [1, 0, 0], add: { x: 1, deep: { y: 2 } }, state: { a: 1 } }, null, { steer: [0, 2, 0], add: { x: 2, deep: { y: 3 } }, state: { b: 5 } })
    return {}
  } } })
  s.step()
  const g = got as { steer: { toArray(): number[] }; add: { x: number; deep: { y: number } }; state: object }
  assert.deepEqual(g.steer.toArray(), [1, 2, 0])
  assert.deepEqual(g.add, { x: 3, deep: { y: 5 } })
  assert.deepEqual(g.state, { a: 1, b: 5 })
})

test('keys held by a person reach ctx.input, are logged, and a controller can say it is not deterministic', () => {
  const sc = scene(undefined, {})
  const seen: boolean[] = []
  const s = new Sim(sc, { default: { spec: { nondeterministic: true }, act: ({ self }, _p, ctx) => { if (self.row === 0) seen.push(ctx.input.pressed('W')) } } })
  s.step()
  s.setInput(['w'])
  s.step(); s.step()
  s.setInput([])
  s.step()
  assert.deepEqual(seen, [false, true, true, false])
  assert.deepEqual(s.inputLog, [{ tick: 1, keys: ['w'] }, { tick: 3, keys: [] }])
  assert.deepEqual(s.nondeterministic(), ['a'])
})

test('inspect shows one entity with typed fields; poke edits it; controllerNames lists the script exports', () => {
  const sc = scene({ at: [1, 2, 3] })
  const s = new Sim(sc, { default: { init: () => ({ energy: 5, awake: true, name: 'x', w: [0.5, 0.5, 0.5] }), act: () => ({}) }, Other: { act: () => ({}) }, metrics: {} })
  const i = s.inspect(0, 2)!
  assert.equal(i.set, 'a')
  assert.equal(i.kind, 'agent')
  assert.deepEqual([i.fields.px, i.fields.py, i.fields.pz], [1, 2, 3])
  assert.deepEqual([i.fields.energy, i.fields.awake, i.fields.name, i.fields.w], [5, false || true, 'x', [0.5, 0.5, 0.5]])
  s.poke(0, 2, 'energy', 9); s.poke(0, 2, 'awake', false); s.poke(0, 2, 'name', 'z'); s.poke(0, 2, 'w', 7, 1)
  const j = s.inspect(0, 2)!
  assert.deepEqual([j.fields.energy, j.fields.awake, j.fields.name, j.fields.w], [9, false, 'z', [0.5, 7, 0.5]])
  assert.equal(s.inspect(0, 99), null)
  assert.throws(() => s.poke(0, 2, 'nope', 1), /no field/)
  assert.deepEqual(s.controllerNames(), ['default', 'Other'])
})

test('changing a set\'s type swaps its controller on a running sim, with no other scene edit', () => {
  const sc = scene({ at: [0, 0, 0] }, { type: 'Left', motion: { maxSpeed: 50, plane: 'xz' } })
  const script: ScriptModule = {
    Left: { act: () => ({ steer: [-10, 0, 0] }) },
    Right: { act: () => ({ steer: [10, 0, 0] }) },
  }
  const s = new Sim(sc, script)
  for (let i = 0; i < 30; i++) s.step()
  const vx = () => (s.table.cols.vx as Float32Array)[0]
  assert.ok(vx() < 0, 'running Left')
  const next = structuredClone(sc)
  next.entities[0].type = 'Right'
  s.setScene(next)
  for (let i = 0; i < 90; i++) s.step()
  assert.ok(vx() > 0, 'now running Right')
})
