import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Sim, parseScene, type ScriptModule } from '../src/index'

const parse = (o: object) => { const r = parseScene(JSON.stringify(o)); assert.ok(r.ok, r.ok ? '' : r.errors.join('\n')); return r.ok ? r.scene : (null as never) }
const grid = () => parse({ seed: 1, params: {}, bounds: { size: 10 }, entities: [{ name: 'cell', lattice: { size: [4, 4, 1] }, controller: 'x.js' }], metrics: [] })

const init = ({ x }: { x?: number }) => ({ alive: (x ?? 0) % 2, age: x ?? 0 })

test('display colors and hides cells; with no show field in the scene every cell is drawn unless display says not', () => {
  const plain = new Sim(grid(), { default: { init, act: () => ({}) } })
  const f0 = plain.frames()[0]
  assert.equal(f0.lattice!.show.filter((v) => v).length, 16, 'no show field and no display: everything is drawn')
  assert.equal(f0.lattice!.rgb, undefined)

  const sim = new Sim(grid(), { default: {
    init, act: () => ({}),
    display: ({ self }, _p, ctx) => ({ visible: self.alive, color: ctx.colors.ramp(['#000000', '#ffffff'], self.age / 3) }),
  } })
  const { lattice } = sim.frames()[0]
  assert.equal(lattice!.show.filter((v) => v).length, 8, 'only live cells are drawn')
  assert.deepEqual(Array.from(lattice!.rgb!.slice(3, 6)), [85, 85, 85], 'cell 1 is at age 1 of 3 along black to white')
  assert.deepEqual(Array.from(lattice!.rgb!.slice(9, 12)), [255, 255, 255])
  assert.equal(sim.takeErrors().length, 0, sim.takeErrors().join('\n'))
  // it only reads: the simulation is unchanged by drawing
  const h = sim.hash(); sim.frames(); assert.equal(sim.hash(), h)
})

test('displayAll gives the same picture as display, from whole fields', () => {
  const stops = ['#102030', '#a0b0c0', '#ff8000']
  const each = new Sim(grid(), { default: { init, act: () => ({}), display: ({ self }, _p, ctx) => ({ visible: self.alive, color: ctx.colors.ramp(stops, self.age / 3) }) } })
  const all = new Sim(grid(), { default: { init, act: () => ({}), displayAll: ({ alive, age }, _p, ctx) => ({ visible: alive, color: ctx.colors.rampField(stops, age.div(3)) }) } })
  const a = each.frames()[0].lattice!, b = all.frames()[0].lattice!
  assert.deepEqual(Array.from(b.show), Array.from(a.show))
  for (let i = 0; i < a.rgb!.length; i++) assert.ok(Math.abs(a.rgb![i] - b.rgb![i]) <= 1, `byte ${i}: ${a.rgb![i]} vs ${b.rgb![i]}`)
  assert.equal(each.takeErrors().length + all.takeErrors().length, 0)
})

test('free agents and network nodes get colors from display', () => {
  const agents = parse({ seed: 1, params: {}, bounds: { size: 20 }, entities: [{ name: 'a', count: 3, controller: 'x.js' }], metrics: [] })
  const sim = new Sim(agents, { default: { init: ({ index }) => ({ hot: index === 1 }), act: () => ({}), display: ({ self }) => ({ color: self.hot ? '#ff0000' : '#0000ff' }) } })
  const c = sim.frames()[0].colors!
  assert.deepEqual(Array.from(c), [0, 0, 255, 255, 0, 0, 0, 0, 255])

  const net = parse({ seed: 1, params: {}, bounds: { size: 20 }, entities: [{ name: 'n', count: 4, network: { topology: 'ring', degree: 2 }, controller: 'x.js' }], metrics: [] })
  const ns = new Sim(net, { default: { init: ({ index }) => ({ sick: index === 2 ? 1 : 0 }), act: () => ({}), displayAll: ({ sick }, _p, ctx) => ({ color: ctx.colors.rampField(['#00ff00', '#ff0000'], sick) }) } })
  const nc = ns.frames()[0].colors!
  assert.deepEqual(Array.from(nc.slice(6, 9)), [255, 0, 0])
  assert.deepEqual(Array.from(nc.slice(0, 3)), [0, 255, 0])
})

test('a display that throws is reported once, not once per entity, and the scene looks apply', () => {
  const sim = new Sim(grid(), { default: { init, act: () => ({}), display: () => { throw new Error('oops') } } })
  const f = sim.frames()[0]
  assert.equal(f.lattice!.rgb, undefined)
  assert.equal(sim.takeErrors().filter((e) => /oops/.test(e)).length, 1)
  const bad = new Sim(grid(), { default: { init, act: () => ({}), displayAll: () => ({ visible: new Float32Array(3) }) } })
  bad.frames()
  assert.match(bad.takeErrors().join(), /one value per entity \(16\), got 3/)
})
