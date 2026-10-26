import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Sim, parseScene } from '../src/index'

test('a string state field called "controller" picks each agent\'s behavior', () => {
  const r = parseScene(JSON.stringify({
    seed: 4, params: {}, bounds: { size: 50 },
    entities: [{ name: 'a', count: 4 }], metrics: [],
  }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  const init = () => ({ controller: '', ran: '' })
  const mark = (name: string) => ({ act: () => ({ state: { ran: name } }) })
  const sim = new Sim(r.scene, { default: { ...mark('default'), init }, flee: mark('flee'), chase: mark('chase') })
  const cols = sim.worlds[0].table.cols as unknown as Record<string, string[]>
  cols.controller[1] = 'flee'
  cols.controller[2] = 'chase'
  sim.step()
  assert.equal(sim.takeErrors().length, 0)
  assert.deepEqual(cols.ran.slice(0, 4), ['default', 'flee', 'chase', 'default'])

  // an agent can switch itself by returning the field, and a fork keeps the choice
  const sim2 = new Sim(r.scene, { default: { init, act: ({ self }) => ((self as unknown as { ran: string }).ran === '' ? { state: { ran: 'x', controller: 'flee' } } : { state: { ran: 'y' } }) }, flee: mark('flee') })
  sim2.step(); sim2.step()
  const cols2 = sim2.worlds[0].table.cols as unknown as Record<string, string[]>
  assert.deepEqual(cols2.ran.slice(0, 4), ['flee', 'flee', 'flee', 'flee'])
  const f = sim2.fork()
  assert.equal(f.hash(), sim2.hash())

  // naming an export the script lacks is reported once, not silently ignored
  cols.controller[0] = 'missing'
  sim.step(); sim.step()
  assert.equal(sim.takeErrors().filter((e) => /no export named "missing"/.test(e)).length, 1)
})
