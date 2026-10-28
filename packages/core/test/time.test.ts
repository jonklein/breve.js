import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Sim, parseScene, type ScriptModule } from '../src/index'

const make = (time: object | undefined, script: ScriptModule = { default: { act: () => ({ steer: [1, 0, 0] }) } }) => {
  const r = parseScene(JSON.stringify({ seed: 1, ...(time ? { time } : {}), params: {}, entities: [{ name: 'a', count: 1, spawn: { at: [0, 0, 0], velocity: [0, 0, 0] } }], metrics: [] }))
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'))
  return new Sim(r.ok ? r.scene : (null as never), script)
}

test('time is validated: step and pace are positive, pace may be "max", unknown fields are named', () => {
  for (const ok of [{ step: 0.025, pace: 10, fps: 60, unit: 's' }, { step: 1, pace: 'max' }, {}]) assert.ok(parseScene(JSON.stringify({ seed: 1, time: ok, params: {}, entities: [{ name: 'a', count: 1 }], metrics: [] })).ok, JSON.stringify(ok))
  for (const bad of [{ step: 0 }, { pace: -1 }, { pace: 'fast' }, { fps: 500 }, { rate: 5 }]) {
    const r = parseScene(JSON.stringify({ seed: 1, time: bad, params: {}, entities: [{ name: 'a', count: 1 }], metrics: [] }))
    assert.equal(r.ok, false, JSON.stringify(bad))
    assert.match(r.ok ? '' : r.errors.join('\n'), /time/)
  }
})

test('the clock: ctx.dt is the step, ctx.time is tick times step, and a sim reports its pace, fps and unit', () => {
  const seen: { dt: number; time: number; tick: number }[] = []
  const sim = make({ step: 0.025, pace: 10, fps: 30, unit: 'days' }, { default: { act: (_o, _p, ctx) => { seen.push({ dt: ctx.dt, time: ctx.time, tick: ctx.tick }); return {} } } })
  for (let t = 0; t < 40; t++) sim.step()
  assert.equal(seen[0].dt, 0.025)
  assert.ok(Math.abs(seen[39].time - 39 * 0.025) < 1e-9)
  assert.equal(sim.time, 40 * 0.025)
  assert.deepEqual([sim.pace, sim.fps, sim.unit], [10, 30, 'days'])
  const d = make(undefined)
  assert.deepEqual([d.stepTime, d.pace, d.fps, d.unit], [1 / 60, 'max', 60, 's'])
})

test('the step is the integration step: the same push for the same number of steps moves an agent twice as far with twice the step', () => {
  const run = (step: number) => {
    const sim = make({ step })
    for (let t = 0; t < 30; t++) sim.step()
    return (sim.table.cols as unknown as Record<string, Float32Array>).px[0]
  }
  const one = run(1 / 60), two = run(2 / 60)
  assert.ok(two > one * 3.5 && two < one * 4.5, `distance goes with step squared: ${one} then ${two}`)
})
