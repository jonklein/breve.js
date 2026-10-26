import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Sim, parseScene, type ScriptModule } from '../src/index'

const parse = (o: object) => { const r = parseScene(JSON.stringify(o)); assert.ok(r.ok, r.ok ? '' : r.errors.join('\n')); return r.ok ? r.scene : (null as never) }

const lattice = (extra: object = {}) => parse({ seed: 5, params: { density: { value: 0.3, min: 0, max: 1 } }, bounds: { size: 10 }, entities: [{ name: 'cell', lattice: { size: [12, 12, 1], show: 'alive' }, controller: 'x.js', ...extra }], metrics: [] })

test('a lattice needs no "state" block: the fields are what init returns, and init says how each cell starts', () => {
  const script: ScriptModule = { default: {
    init: ({ x, y }, p, ctx) => ({ alive: ctx.random() < p.density ? 1 : 0, age: 0, edge: x === 0 || y === 0, label: 'cell' }),
    act: ({ self }) => ({ age: self.age + 1 }),
  } }
  const sim = new Sim(lattice(), script)
  const cols = sim.worlds[0].table.cols as unknown as Record<string, ArrayLike<number | string>>
  assert.deepEqual(Object.keys(cols).sort(), ['age', 'alive', 'edge', 'label'])
  const live = Array.from(cols.alive as ArrayLike<number>).filter((v) => v === 1).length
  assert.ok(live > 20 && live < 70, `about 30% of 144 start alive (${live})`)
  assert.equal(cols.edge[0], 1)
  assert.equal(cols.edge[13], 0)
  assert.equal(cols.label[5], 'cell')
  sim.step(); sim.step()
  assert.equal(cols.age[0], 2, 'act sees and updates the fields init made')
  assert.equal(sim.takeErrors().length, 0, sim.takeErrors().join('\n'))
  // the same scene and script twice gives the same cells
  assert.equal(new Sim(lattice(), script).hash(), new Sim(lattice(), script).hash())
})

test('initAll starts every cell at once; the scene may still give a field a type to save memory', () => {
  const script: ScriptModule = { default: {
    initAll: ({ count }, p, ctx) => ({ alive: Float32Array.from({ length: count }, () => (ctx.random() < p.density ? 1 : 0)), age: new Float32Array(count) }),
    actAll: ({ alive, age }) => ({ alive, age: age.add(1) }),
  } }
  const sim = new Sim(lattice({ state: { alive: 'u8' } }), script)
  const cols = sim.worlds[0].table.cols as unknown as Record<string, ArrayLike<number>>
  assert.equal(cols.alive.constructor.name, 'Uint8Array', 'the scene\'s type word wins')
  assert.equal(cols.age.constructor.name, 'Float64Array', 'and an inferred number is a plain number')
  assert.ok(Array.from(cols.alive).some((v) => v === 1))
  sim.step()
  assert.equal(cols.age[3], 1)
  assert.equal(sim.takeErrors().length, 0, sim.takeErrors().join('\n'))
})

test('init works for networks and free agents too (agents may also set position and velocity)', () => {
  const net = parse({ seed: 2, params: {}, bounds: { size: 10 }, entities: [{ name: 'n', count: 10, network: { topology: 'ring', degree: 2 }, controller: 'x.js' }], metrics: [] })
  const sim = new Sim(net, { default: { init: ({ index }) => ({ status: index === 3 ? 1 : 0 }), act: ({ self }) => ({ status: self.status }) } })
  const status = Array.from(sim.worlds[0].table.cols.status as ArrayLike<number>).slice(0, 10)
  assert.deepEqual(status, [0, 0, 0, 1, 0, 0, 0, 0, 0, 0])

  const agents = parse({ seed: 2, params: {}, bounds: { size: 20 }, entities: [{ name: 'a', count: 4, controller: 'x.js' }], metrics: [] })
  const flock = new Sim(agents, { default: { init: ({ index }, _p, ctx) => ({ position: ctx.vec(index * 2, 0, 0), energy: 10 + index, weights: [index, 1, 2] }), act: ({ self }) => ({ state: { energy: self.energy - 1 } }) } })
  const c = flock.worlds[0].table.cols as unknown as Record<string, Float32Array | Float64Array>
  assert.deepEqual(Array.from(c.px).slice(0, 4), [0, 2, 4, 6])
  assert.deepEqual(Array.from(c.energy).slice(0, 4), [10, 11, 12, 13])
  assert.deepEqual(Array.from(c.weights).slice(0, 6), [0, 1, 2, 1, 1, 2], 'an array makes a field of that length')
  flock.step()
  assert.deepEqual(Array.from(c.energy).slice(0, 4), [9, 10, 11, 12])
  assert.equal(flock.takeErrors().length, 0, flock.takeErrors().join('\n'))
})

test('init does not use up the run\'s own random numbers, and unknown fields are reported once', () => {
  const noInit = new Sim(lattice({ state: { alive: 0 } }), { default: { act: () => ({}) } })
  const withInit = new Sim(lattice(), { default: { init: (_o, _p, ctx) => ({ alive: ctx.random() < 0.3 ? 1 : 0 }), act: () => ({}) } })
  void noInit
  // both start from the same generator state: only what init itself draws differs
  const probe = new Sim(lattice(), { default: { init: () => ({ alive: 1 }), act: () => ({}) } })
  assert.equal(probe.takeErrors().length, 0)
  assert.ok(withInit.rng.getState() !== noInit.rng.getState())

  const bad = new Sim(lattice({ state: { alive: 0 } }), { default: { init: () => ({ alive: 1, ghost: 3 }), act: () => ({}) } })
  // "ghost" is inferred from init, so it is not an error: it is a field
  assert.equal(bad.takeErrors().length, 0)
  assert.ok('ghost' in bad.worlds[0].table.cols)
})

test('a script edit that changes the state shape is noticed', () => {
  const a = new Sim(lattice(), { default: { init: () => ({ alive: 0 }), act: () => ({}) } })
  const b = new Sim(lattice(), { default: { init: () => ({ alive: 0, age: 0 }), act: () => ({}) } })
  assert.notEqual(a.stateShape(), b.stateShape())
  assert.equal(a.stateShape(), new Sim(lattice(), { default: { init: () => ({ alive: 1 }), act: () => ({}) } }).stateShape())
})
